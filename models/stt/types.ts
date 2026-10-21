/**
 * Public contract between the offline STT layer and the rest of the app.
 *
 * The STT layer only turns audio into text. Product matching, quantity
 * parsing, confirmation and stock updates stay in the inventory layer.
 */

export interface STTResult {
  /** Text exactly as the model produced it (trimmed). Never corrected or rewritten. */
  transcript: string;
  /** Duration of the audio that was transcribed. */
  durationMs: number;
  /** Wall-clock time spent inside the native recognizer. */
  inferenceMs: number;
  modelId: string;
}

export interface STTStatus {
  initialized: boolean;
  modelInstalled: boolean;
  /** True once the model files are on disk and verified: no network is needed to transcribe. */
  offlineCapable: boolean;
  error?: string;
}

export interface TranscribeOptions {
  signal?: AbortSignal;
}

export interface SpeechToTextProvider {
  initialize(): Promise<void>;
  /** `audioUri` must point at a 16-bit PCM mono WAV file (`file://` URIs and plain paths are accepted). */
  transcribe(audioUri: string, options?: TranscribeOptions): Promise<STTResult>;
  getStatus(): Promise<STTStatus>;
  release(): Promise<void>;
}

export type STTErrorCode =
  | 'MODEL_NOT_INSTALLED'
  | 'MODEL_INIT_FAILED'
  | 'INVALID_AUDIO'
  | 'SILENT_AUDIO'
  | 'EMPTY_TRANSCRIPT'
  | 'INFERENCE_FAILED'
  | 'CANCELLED'
  | 'BUSY'
  | 'RESOURCE_EXHAUSTED'
  | 'PERMISSION_DENIED'
  | 'RECORDING_FAILED';

export class STTError extends Error {
  readonly code: STTErrorCode;
  readonly cause?: unknown;

  constructor(code: STTErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'STTError';
    this.code = code;
    this.cause = cause;
  }
}

export function isSTTError(e: unknown, code?: STTErrorCode): e is STTError {
  return e instanceof STTError && (code === undefined || e.code === code);
}

/** Heuristic only: native allocation failures surface as generic exceptions with these messages. */
const RESOURCE_PATTERNS = [/out ?of ?memory/i, /bad_alloc/i, /failed to allocate/i, /OOM/];

export function classifyNativeError(e: unknown, fallback: STTErrorCode, message: string): STTError {
  if (e instanceof STTError) return e;
  const text = e instanceof Error ? e.message : String(e);
  if (RESOURCE_PATTERNS.some((p) => p.test(text))) {
    return new STTError('RESOURCE_EXHAUSTED', `${message}: ${text}`, e);
  }
  return new STTError(fallback, `${message}: ${text}`, e);
}
