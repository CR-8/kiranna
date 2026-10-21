import { Directory, File, Paths } from 'expo-file-system';

import { HINGLISH_SWIFT, modelFiles, type ModelFileSpec, type ModelSpec } from './modelSpec';

/**
 * Installs the STT model into persistent app storage and verifies it.
 *
 * Layout (all under <document>/stt-models/, nothing else is ever touched):
 *   .staging-<id>/            downloads in progress; `<name>.part` while transferring
 *   <id>/                     active model, only ever created by renaming a fully verified staging dir
 *   <id>/install.json         written last; its presence + matching file sizes = "installed"
 *
 * Downloads only happen when `install()` is called explicitly (a user action).
 */

export type ModelInstallErrorCode = 'NETWORK' | 'CHECKSUM_MISMATCH' | 'INSUFFICIENT_STORAGE' | 'CANCELLED' | 'FILESYSTEM';

export class ModelInstallError extends Error {
  readonly code: ModelInstallErrorCode;
  readonly cause?: unknown;
  constructor(code: ModelInstallErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ModelInstallError';
    this.code = code;
    this.cause = cause;
  }
}

export interface InstallProgress {
  phase: 'checking' | 'downloading' | 'verifying' | 'finalizing';
  file?: string;
  bytesDone: number;
  bytesTotal: number;
}

export interface InstallOptions {
  onProgress?: (p: InstallProgress) => void;
  signal?: AbortSignal;
}

interface InstallManifest {
  modelId: string;
  revision: string;
  installedAt: string;
  files: { name: string; sizeBytes: number; sha256: string }[];
}

const MANIFEST = 'install.json';
/** Headroom kept free on the device beyond the model itself. */
const STORAGE_MARGIN_BYTES = 50 * 1024 * 1024;

/** Converts a `file://` URI into the plain filesystem path the native recognizer expects. */
export function toNativePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e instanceof Error && e.name === 'AbortError');
}

export class ModelManager {
  readonly spec: ModelSpec;
  private rootDir?: Directory;
  private installing: Promise<void> | null = null;

  constructor(spec: ModelSpec = HINGLISH_SWIFT, root?: Directory) {
    this.spec = spec;
    this.rootDir = root;
  }

  /** Resolved lazily so constructing a manager never touches native storage (e.g. on web). */
  private get root(): Directory {
    return (this.rootDir ??= new Directory(Paths.document, 'stt-models'));
  }

  get modelDir(): Directory {
    return new Directory(this.root, this.spec.id);
  }

  private get stagingDir(): Directory {
    return new Directory(this.root, `.staging-${this.spec.id}`);
  }

  /** Plain filesystem path of an installed model file. */
  pathOf(file: ModelFileSpec): string {
    return toNativePath(new File(this.modelDir, file.name).uri);
  }

  /** Fast check (no hashing): manifest matches the spec and every file has the expected size. */
  isInstalled(): boolean {
    try {
      const manifestFile = new File(this.modelDir, MANIFEST);
      if (!manifestFile.exists) return false;
      const manifest = JSON.parse(manifestFile.textSync()) as InstallManifest;
      if (manifest.modelId !== this.spec.id || manifest.revision !== this.spec.revision) return false;
      return modelFiles(this.spec).every((f) => {
        const file = new File(this.modelDir, f.name);
        return file.exists && file.size === f.sizeBytes;
      });
    } catch {
      return false;
    }
  }

  /** Full check: re-hashes every installed file. Slow (~160 MB of reads); use after suspected corruption. */
  async verifyInstalled(): Promise<boolean> {
    if (!this.isInstalled()) return false;
    for (const f of modelFiles(this.spec)) {
      const digest = await new File(this.modelDir, f.name).digest('SHA-256');
      if (digest !== f.sha256) return false;
    }
    return true;
  }

  install(options: InstallOptions = {}): Promise<void> {
    // Concurrent callers share one install instead of downloading twice.
    if (!this.installing) {
      this.installing = this.doInstall(options).finally(() => {
        this.installing = null;
      });
    }
    return this.installing;
  }

  /** Removes this model's active and staging directories only. */
  async uninstall(): Promise<void> {
    for (const dir of [this.modelDir, this.stagingDir]) {
      if (dir.exists) dir.delete();
    }
  }

  private async doInstall({ onProgress, signal }: InstallOptions): Promise<void> {
    if (this.isInstalled()) return;
    const files = modelFiles(this.spec);
    const bytesTotal = files.reduce((n, f) => n + f.sizeBytes, 0);
    let bytesDone = 0;
    const report = (p: Omit<InstallProgress, 'bytesTotal'>) => onProgress?.({ ...p, bytesTotal });

    try {
      this.root.create({ intermediates: true, idempotent: true });
      const staging = this.stagingDir;
      staging.create({ intermediates: true, idempotent: true });

      // Keep files that a previous, interrupted install already verified.
      report({ phase: 'checking', bytesDone });
      const pending: ModelFileSpec[] = [];
      for (const f of files) {
        const part = new File(staging, `${f.name}.part`);
        if (part.exists) part.delete();
        const done = new File(staging, f.name);
        if (done.exists && done.size === f.sizeBytes && (await done.digest('SHA-256')) === f.sha256) {
          bytesDone += f.sizeBytes;
        } else {
          if (done.exists) done.delete();
          pending.push(f);
        }
      }

      const needed = pending.reduce((n, f) => n + f.sizeBytes, 0);
      if (needed > 0 && Paths.availableDiskSpace < needed + STORAGE_MARGIN_BYTES) {
        throw new ModelInstallError(
          'INSUFFICIENT_STORAGE',
          `Need ${Math.ceil((needed + STORAGE_MARGIN_BYTES) / 2 ** 20)} MB free, have ${Math.floor(Paths.availableDiskSpace / 2 ** 20)} MB`,
        );
      }

      for (const f of pending) {
        if (signal?.aborted) throw new ModelInstallError('CANCELLED', 'Model download cancelled');
        const part = new File(staging, `${f.name}.part`);
        const base = bytesDone;
        report({ phase: 'downloading', file: f.name, bytesDone });
        try {
          const task = File.createDownloadTask(f.url, part, {
            signal,
            onProgress: ({ bytesWritten }) => report({ phase: 'downloading', file: f.name, bytesDone: base + bytesWritten }),
          });
          const result = await task.downloadAsync();
          if (!result) throw new ModelInstallError('CANCELLED', 'Model download paused');
        } catch (e) {
          if (part.exists) part.delete();
          if (e instanceof ModelInstallError) throw e;
          if (isAbort(e, signal)) throw new ModelInstallError('CANCELLED', 'Model download cancelled', e);
          throw new ModelInstallError('NETWORK', `Download of ${f.name} failed: ${(e as Error)?.message ?? e}`, e);
        }

        report({ phase: 'verifying', file: f.name, bytesDone: base + f.sizeBytes });
        const size = part.size;
        const digest = size === f.sizeBytes ? await part.digest('SHA-256') : null;
        if (digest !== f.sha256) {
          part.delete();
          throw new ModelInstallError(
            'CHECKSUM_MISMATCH',
            size !== f.sizeBytes
              ? `${f.name}: expected ${f.sizeBytes} bytes, got ${size}`
              : `${f.name}: sha256 mismatch (got ${digest})`,
          );
        }
        part.rename(f.name);
        bytesDone = base + f.sizeBytes;
      }

      // Promote: replace any stale/partial active dir for THIS model only, then write the manifest last.
      report({ phase: 'finalizing', bytesDone });
      const active = this.modelDir;
      if (active.exists) active.delete();
      staging.rename(this.spec.id);
      const manifest: InstallManifest = {
        modelId: this.spec.id,
        revision: this.spec.revision,
        installedAt: new Date().toISOString(),
        files: files.map(({ name, sizeBytes, sha256 }) => ({ name, sizeBytes, sha256 })),
      };
      await new File(this.modelDir, MANIFEST).write(JSON.stringify(manifest, null, 2));
    } catch (e) {
      if (e instanceof ModelInstallError) throw e;
      throw new ModelInstallError('FILESYSTEM', `Model install failed: ${(e as Error)?.message ?? e}`, e);
    }
  }
}
