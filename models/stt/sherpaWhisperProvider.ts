import { File } from 'expo-file-system';

import { ModelManager, toNativePath } from './modelManager';
import {
  classifyNativeError,
  STTError,
  type SpeechToTextProvider,
  type STTResult,
  type STTStatus,
  type TranscribeOptions,
} from './types';
import {
  analyzePcm16,
  assertSupportedFormat,
  DEFAULT_SILENCE_GATE,
  isSilent,
  parseWavHeader,
  WavFormatError,
  type SilenceGate,
} from './wav';

/** The subset of expo-sherpa-onnx's OfflineSTTEngine this provider relies on. */
export interface NativeSttEngine {
  transcribeFile(filePath: string): Promise<{ text: string }>;
  destroy(): Promise<void>;
}

export type NativeEngineFactory = (config: Record<string, unknown>) => Promise<NativeSttEngine>;

/** Reads a file into memory. Injected so unit tests can run without a filesystem. */
export type FileReader = (uri: string) => Promise<Uint8Array>;

export interface SherpaWhisperProviderOptions {
  manager?: ModelManager;
  createEngine?: NativeEngineFactory;
  readFile?: FileReader;
  /** 2 threads matches the model card's recommendation and leaves cores free on 4-core phones. */
  numThreads?: number;
  silenceGate?: SilenceGate;
  minDurationMs?: number;
}

/** Recorded command clips are ~1 MB for 30 s; anything far larger is not a voice command. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const defaultCreateEngine: NativeEngineFactory = async (config) => {
  let mod: typeof import('expo-sherpa-onnx');
  try {
    // Loaded lazily: the native module is absent in Expo Go and on web.
    mod = require('expo-sherpa-onnx');
  } catch (e) {
    throw new STTError(
      'MODEL_INIT_FAILED',
      'The sherpa-onnx native module is not available. Run a development build (not Expo Go).',
      e,
    );
  }
  return mod.createSTT(config);
};

const defaultReadFile: FileReader = async (uri) => {
  const file = new File(uri);
  if (!file.exists) throw new STTError('INVALID_AUDIO', `Audio file not found: ${uri}`);
  if (file.size > MAX_FILE_BYTES) throw new STTError('INVALID_AUDIO', `Audio file too large (${file.size} bytes)`);
  return file.bytes();
};

/**
 * Offline Hinglish STT backed by sherpa-onnx's Whisper recognizer.
 *
 * - One native recognizer per provider, created lazily and reused.
 * - One inference at a time; a second concurrent call fails fast with BUSY.
 * - Native decode cannot be interrupted. Cancelling while it runs discards the
 *   result (CANCELLED) once the native call returns.
 * - The transcript is returned exactly as the model produced it (trimmed).
 */
export class SherpaWhisperProvider implements SpeechToTextProvider {
  readonly manager: ModelManager;
  private readonly createEngine: NativeEngineFactory;
  private readonly readFile: FileReader;
  private readonly numThreads: number;
  private readonly gate: SilenceGate;
  private readonly minDurationMs: number;

  private engine: NativeSttEngine | null = null;
  private initializing: Promise<NativeSttEngine> | null = null;
  private inflight: Promise<unknown> | null = null;
  private lastError?: string;

  constructor(options: SherpaWhisperProviderOptions = {}) {
    this.manager = options.manager ?? new ModelManager();
    this.createEngine = options.createEngine ?? defaultCreateEngine;
    this.readFile = options.readFile ?? defaultReadFile;
    this.numThreads = options.numThreads ?? 2;
    this.gate = options.silenceGate ?? DEFAULT_SILENCE_GATE;
    this.minDurationMs = options.minDurationMs ?? 300;
  }

  get modelId(): string {
    return this.manager.spec.id;
  }

  async initialize(): Promise<void> {
    await this.getEngine();
  }

  private getEngine(): Promise<NativeSttEngine> {
    if (this.engine) return Promise.resolve(this.engine);
    if (!this.initializing) {
      this.initializing = this.createEngineChecked().finally(() => {
        this.initializing = null;
      });
    }
    return this.initializing;
  }

  private async createEngineChecked(): Promise<NativeSttEngine> {
    if (!this.manager.isInstalled()) {
      this.lastError = 'Model not installed';
      throw new STTError('MODEL_NOT_INSTALLED', `Speech model "${this.modelId}" is not installed`);
    }
    const { encoder, decoder, tokens } = this.manager.spec.files;
    try {
      const engine = await this.createEngine({
        modelConfig: {
          whisper: {
            encoder: this.manager.pathOf(encoder),
            decoder: this.manager.pathOf(decoder),
            language: this.manager.spec.language,
            task: 'transcribe',
          },
          tokens: this.manager.pathOf(tokens),
          numThreads: this.numThreads,
          provider: 'cpu',
          debug: false,
        },
        decodingMethod: 'greedy_search',
      });
      this.engine = engine;
      this.lastError = undefined;
      return engine;
    } catch (e) {
      const err = classifyNativeError(e, 'MODEL_INIT_FAILED', 'Failed to load speech model');
      this.lastError = err.message;
      throw err;
    }
  }

  async transcribe(audioUri: string, options: TranscribeOptions = {}): Promise<STTResult> {
    const { signal } = options;
    if (signal?.aborted) throw new STTError('CANCELLED', 'Transcription cancelled');
    if (this.inflight) throw new STTError('BUSY', 'A transcription is already running');

    const run = this.runTranscription(audioUri, signal);
    this.inflight = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.inflight = null;
    }
  }

  private async runTranscription(audioUri: string, signal?: AbortSignal): Promise<STTResult> {
    let bytes: Uint8Array;
    try {
      bytes = await this.readFile(audioUri);
    } catch (e) {
      throw e instanceof STTError ? e : new STTError('INVALID_AUDIO', `Could not read audio: ${(e as Error)?.message ?? e}`, e);
    }

    let durationMs: number;
    try {
      const info = parseWavHeader(bytes, bytes.length);
      assertSupportedFormat(info);
      durationMs = info.durationMs;
      if (durationMs < this.minDurationMs) {
        throw new STTError('INVALID_AUDIO', `Recording too short (${Math.round(durationMs)} ms)`);
      }
      if (durationMs > this.manager.spec.maxAudioSeconds * 1000) {
        throw new STTError(
          'INVALID_AUDIO',
          `Recording too long (${(durationMs / 1000).toFixed(1)} s); the model handles up to ${this.manager.spec.maxAudioSeconds} s`,
        );
      }
      const stats = analyzePcm16(bytes.subarray(info.dataOffset, info.dataOffset + info.dataBytes), info.sampleRate, this.gate);
      if (isSilent(stats, this.gate)) {
        throw new STTError('SILENT_AUDIO', 'No speech detected in the recording');
      }
    } catch (e) {
      if (e instanceof WavFormatError) throw new STTError('INVALID_AUDIO', e.message, e);
      throw e;
    }

    if (signal?.aborted) throw new STTError('CANCELLED', 'Transcription cancelled');
    const engine = await this.getEngine();
    if (signal?.aborted) throw new STTError('CANCELLED', 'Transcription cancelled');

    const t0 = Date.now();
    let text: string;
    try {
      ({ text } = await engine.transcribeFile(toNativePath(audioUri)));
    } catch (e) {
      throw classifyNativeError(e, 'INFERENCE_FAILED', 'Speech recognition failed');
    }
    const inferenceMs = Date.now() - t0;
    if (signal?.aborted) throw new STTError('CANCELLED', 'Transcription cancelled');

    const transcript = (text ?? '').trim();
    if (!transcript) throw new STTError('EMPTY_TRANSCRIPT', 'The model returned no text');
    return { transcript, durationMs: Math.round(durationMs), inferenceMs, modelId: this.modelId };
  }

  async getStatus(): Promise<STTStatus> {
    const modelInstalled = this.manager.isInstalled();
    return {
      initialized: this.engine !== null,
      modelInstalled,
      offlineCapable: modelInstalled,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  /** Frees the native recognizer (~200 MB on desktop). Waits for a running inference to finish first. */
  async release(): Promise<void> {
    if (this.inflight) await this.inflight;
    if (this.initializing) await this.initializing.catch(() => undefined);
    const engine = this.engine;
    this.engine = null;
    if (engine) {
      try {
        await engine.destroy();
      } catch {
        // Already released natively; nothing else to free.
      }
    }
  }
}
