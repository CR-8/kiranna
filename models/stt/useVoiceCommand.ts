import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getSharedSttProvider } from './shared';
import { isSTTError, STTError, type SpeechToTextProvider, type STTResult } from './types';

export type VoiceCommandState =
  | { status: 'idle' }
  | { status: 'model_unavailable' }
  | { status: 'listening'; startedAt: number }
  | { status: 'processing' }
  | { status: 'transcript'; result: STTResult }
  | { status: 'error'; error: STTError }
  | { status: 'cancelled' };

export interface UseVoiceCommandOptions {
  /** Receives the raw transcript. The caller (inventory layer) decides what it means. */
  onTranscript: (result: STTResult) => void;
  provider?: SpeechToTextProvider;
  /** Recording auto-stops after this many seconds. Whisper handles at most ~30 s per clip. */
  maxSeconds?: number;
  /** Free the native recognizer when the app is backgrounded (recommended on low-RAM phones). */
  releaseOnBackground?: boolean;
}

/** The model is trained on 16 kHz audio; asking the mic for 16 kHz mono int16 avoids any conversion. */
const STREAM_OPTIONS = { sampleRate: 16000, channels: 1, encoding: 'int16' } as const;

function deleteQuietly(uri: string | null) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Temp files live in the cache dir; the OS may clear them anyway.
  }
}

/**
 * Push-to-talk recording + offline transcription.
 *
 * start() -> listening -> stop() -> processing -> transcript | error
 * cancel() works in both listening and processing.
 */
export function useVoiceCommand({
  onTranscript,
  provider = getSharedSttProvider(),
  maxSeconds = 15,
  releaseOnBackground = true,
}: UseVoiceCommandOptions) {
  const [state, setState] = useState<VoiceCommandState>({ status: 'idle' });
  const { stream } = useAudioStream(STREAM_OPTIONS);

  const stateRef = useRef(state);
  stateRef.current = state;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const fileUri = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const set = useCallback((s: VoiceCommandState) => {
    if (mounted.current) setState(s);
  }, []);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const stopCapture = useCallback(() => {
    clearTimer();
    try {
      if (stream.isStreaming) stream.stop();
    } catch {
      // Stream already stopped natively.
    }
  }, [stream]);

  const stop = useCallback(async () => {
    if (stateRef.current.status !== 'listening') return;
    clearTimer();
    set({ status: 'processing' });
    let uri = fileUri.current;
    try {
      const rec = await stream.stopFileRecordingAsync();
      uri = rec.uri;
    } catch (e) {
      stopCapture();
      deleteQuietly(uri);
      fileUri.current = null;
      set({ status: 'error', error: new STTError('RECORDING_FAILED', 'Could not finish the recording', e) });
      return;
    }
    stopCapture();

    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await provider.transcribe(uri!, { signal: controller.signal });
      if (controller.signal.aborted) return;
      set({ status: 'transcript', result });
      onTranscriptRef.current(result);
    } catch (e) {
      if (isSTTError(e, 'CANCELLED')) set({ status: 'cancelled' });
      else if (isSTTError(e, 'MODEL_NOT_INSTALLED')) set({ status: 'model_unavailable' });
      else set({ status: 'error', error: isSTTError(e) ? e : new STTError('INFERENCE_FAILED', String(e), e) });
    } finally {
      abort.current = null;
      deleteQuietly(uri);
      fileUri.current = null;
    }
  }, [provider, set, stopCapture, stream]);

  const start = useCallback(async () => {
    const s = stateRef.current.status;
    if (s === 'listening' || s === 'processing') return;

    const status = await provider.getStatus();
    if (!status.modelInstalled) {
      set({ status: 'model_unavailable' });
      return;
    }

    let perm = await getRecordingPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      set({ status: 'error', error: new STTError('PERMISSION_DENIED', 'Microphone permission is required for voice input') });
      return;
    }

    try {
      await setAudioModeAsync({ allowsRecording: true });
      await stream.start();
      const { uri } = await stream.startFileRecordingAsync({ format: 'wav', directory: 'cache' });
      fileUri.current = uri;
    } catch (e) {
      stopCapture();
      set({ status: 'error', error: new STTError('RECORDING_FAILED', 'Could not start the microphone', e) });
      return;
    }
    set({ status: 'listening', startedAt: Date.now() });
    timer.current = setTimeout(() => void stop(), maxSeconds * 1000);

    // Warm the recognizer while the user is speaking so the first result is not delayed by model load.
    provider.initialize().catch(() => undefined);
  }, [maxSeconds, provider, set, stop, stopCapture, stream]);

  const cancel = useCallback(() => {
    const s = stateRef.current.status;
    if (s === 'listening') {
      stopCapture();
      deleteQuietly(fileUri.current);
      fileUri.current = null;
      set({ status: 'cancelled' });
    } else if (s === 'processing') {
      abort.current?.abort();
      set({ status: 'cancelled' });
    }
  }, [set, stopCapture]);

  const reset = useCallback(() => {
    const s = stateRef.current.status;
    if (s !== 'listening' && s !== 'processing') set({ status: 'idle' });
  }, [set]);

  // Leaving the foreground cancels capture and (optionally) frees the model's memory.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      cancel();
      if (releaseOnBackground) void provider.release();
    });
    return () => sub.remove();
  }, [cancel, provider, releaseOnBackground]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      abort.current?.abort();
      deleteQuietly(fileUri.current);
    };
  }, []);

  return { state, start, stop, cancel, reset };
}
