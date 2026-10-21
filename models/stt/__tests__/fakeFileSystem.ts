/**
 * In-memory stand-in for the parts of expo-file-system the STT layer uses.
 * Test helper only (not a test file). Mirrors the SDK 58 class API shape.
 */
import { createHash } from 'crypto';

export const disk = {
  files: new Map<string, Uint8Array>(),
  dirs: new Set<string>(),
  /** Bytes served by the fake network, keyed by URL. */
  remote: new Map<string, Uint8Array>(),
  /** URLs whose next download fails with a network error. */
  failNext: new Set<string>(),
  downloads: [] as string[],
  availableDiskSpace: 10 * 2 ** 30,
  reset() {
    this.files.clear();
    this.dirs.clear();
    this.remote.clear();
    this.failNext.clear();
    this.downloads = [];
    this.availableDiskSpace = 10 * 2 ** 30;
  },
};

type Part = string | FakeFile | FakeDirectory;
const join = (parts: Part[]) => {
  const path = parts
    .map((p) => (typeof p === 'string' ? p : p.uri))
    .join('/')
    .replace(/^file:\/*/, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
  return `file://${path}`;
};
const parentOf = (uri: string) => uri.slice(0, uri.lastIndexOf('/'));

export class FakeDirectory {
  readonly uri: string;
  constructor(...parts: Part[]) {
    this.uri = join(parts);
  }
  get exists() {
    return disk.dirs.has(this.uri);
  }
  get name() {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }
  create(opts: { intermediates?: boolean; idempotent?: boolean } = {}) {
    if (this.exists && !opts.idempotent) throw new Error('exists');
    let p = this.uri;
    while (p.includes('/') && p !== 'file://') {
      disk.dirs.add(p);
      if (!opts.intermediates) break;
      p = parentOf(p);
    }
  }
  delete() {
    for (const k of [...disk.files.keys()]) if (k.startsWith(this.uri + '/')) disk.files.delete(k);
    for (const k of [...disk.dirs]) if (k === this.uri || k.startsWith(this.uri + '/')) disk.dirs.delete(k);
  }
  rename(newName: string) {
    const to = parentOf(this.uri) + '/' + newName;
    for (const [k, v] of [...disk.files]) {
      if (k.startsWith(this.uri + '/')) {
        disk.files.delete(k);
        disk.files.set(to + k.slice(this.uri.length), v);
      }
    }
    for (const k of [...disk.dirs]) {
      if (k === this.uri || k.startsWith(this.uri + '/')) {
        disk.dirs.delete(k);
        disk.dirs.add(to + k.slice(this.uri.length));
      }
    }
  }
}

export class FakeFile {
  readonly uri: string;
  constructor(...parts: Part[]) {
    this.uri = join(parts);
  }
  get exists() {
    return disk.files.has(this.uri);
  }
  get size() {
    return disk.files.get(this.uri)?.length ?? 0;
  }
  get name() {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }
  textSync() {
    const b = disk.files.get(this.uri);
    if (!b) throw new Error('ENOENT');
    return Buffer.from(b).toString('utf8');
  }
  async bytes() {
    const b = disk.files.get(this.uri);
    if (!b) throw new Error('ENOENT');
    return b;
  }
  async write(content: string | Uint8Array) {
    disk.files.set(this.uri, typeof content === 'string' ? new Uint8Array(Buffer.from(content, 'utf8')) : content);
  }
  delete() {
    if (!disk.files.delete(this.uri)) throw new Error('ENOENT');
  }
  rename(newName: string) {
    const b = disk.files.get(this.uri);
    if (!b) throw new Error('ENOENT');
    disk.files.delete(this.uri);
    disk.files.set(parentOf(this.uri) + '/' + newName, b);
  }
  async digest(alg: string) {
    if (alg !== 'SHA-256') throw new Error('unsupported');
    const b = disk.files.get(this.uri);
    if (!b) throw new Error('ENOENT');
    return createHash('sha256').update(b).digest('hex');
  }

  static createDownloadTask(
    url: string,
    dest: FakeFile,
    opts: { signal?: AbortSignal; onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void } = {},
  ) {
    return {
      async downloadAsync() {
        disk.downloads.push(url);
        if (opts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (disk.failNext.delete(url)) {
          disk.files.set(dest.uri, new Uint8Array(3)); // partial bytes left behind, like a dropped connection
          throw new Error('Network request failed');
        }
        const body = disk.remote.get(url);
        if (!body) throw new Error('404');
        if (!disk.dirs.has(parentOf(dest.uri))) throw new Error('parent missing');
        opts.onProgress?.({ bytesWritten: body.length, totalBytes: body.length });
        disk.files.set(dest.uri, body);
        return dest;
      },
    };
  }
}

export const FakePaths = {
  document: new FakeDirectory('file:///data/doc'),
  cache: new FakeDirectory('file:///data/cache'),
  get availableDiskSpace() {
    return disk.availableDiskSpace;
  },
};

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
