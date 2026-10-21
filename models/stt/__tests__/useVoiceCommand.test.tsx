/**
 * useVoiceCommand with MOCKED microphone (expo-audio) and MOCKED native inference.
 * Verifies the state machine and that the transcript reaches the app callback.
 */
const mockStream = {
  isStreaming: false,
  start: jest.fn(async () => {
    mockStream.isStreaming = true;
  }),
  stop: jest.fn(() => {
    mockStream.isStreaming = false;
  }),
  startFileRecordingAsync: jest.fn(async () => ({ uri: 'file:///cache/rec.wav' })),
  stopFileRecordingAsync: jest.fn(async () => ({ uri: 'file:///cache/rec.wav', duration: 2, sampleRate: 16000 })),
};
const mockPerms = { granted: true, canAskAgain: true };

jest.mock('expo-audio', () => ({
  useAudioStream: () => ({ stream: mockStream, isStreaming: mockStream.isStreaming }),
  getRecordingPermissionsAsync: jest.fn(async () => mockPerms),
  requestRecordingPermissionsAsync: jest.fn(async () => mockPerms),
  setAudioModeAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-file-system', () => {
  const f = jest.requireActual('./fakeFileSystem');
  return { File: f.FakeFile, Directory: f.FakeDirectory, Paths: f.FakePaths };
});

import { act, renderHook } from '@testing-library/react-native';

import { STTError, type SpeechToTextProvider, type STTResult } from '../types';
import { useVoiceCommand } from '../useVoiceCommand';

const RESULT: STTResult = { transcript: 'Maggi ke do packet', durationMs: 2000, inferenceMs: 400, modelId: 'hi-hinglish-swift' };

function fakeProvider(overrides: Partial<SpeechToTextProvider> = {}): jest.Mocked<SpeechToTextProvider> {
  return {
    initialize: jest.fn(async () => undefined),
    transcribe: jest.fn(async () => RESULT),
    getStatus: jest.fn(async () => ({ initialized: false, modelInstalled: true, offlineCapable: true })),
    release: jest.fn(async () => undefined),
    ...overrides,
  } as jest.Mocked<SpeechToTextProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStream.isStreaming = false;
  mockPerms.granted = true;
});

test('[mocked] start -> listening -> stop -> transcript is passed to the app callback', async () => {
  const provider = fakeProvider();
  const onTranscript = jest.fn();
  const { result } = await renderHook(() => useVoiceCommand({ provider, onTranscript }));

  await act(() => result.current.start());
  expect(result.current.state.status).toBe('listening');
  expect(mockStream.startFileRecordingAsync).toHaveBeenCalledWith({ format: 'wav', directory: 'cache' });

  await act(() => result.current.stop());
  expect(provider.transcribe).toHaveBeenCalledWith('file:///cache/rec.wav', expect.objectContaining({ signal: expect.anything() }));
  expect(onTranscript).toHaveBeenCalledWith(RESULT);
  expect(result.current.state).toEqual({ status: 'transcript', result: RESULT });
  expect(mockStream.stop).toHaveBeenCalled();
});

test('[mocked] model not installed -> model_unavailable, microphone never opened', async () => {
  const provider = fakeProvider({ getStatus: jest.fn(async () => ({ initialized: false, modelInstalled: false, offlineCapable: false })) });
  const onTranscript = jest.fn();
  const { result } = await renderHook(() => useVoiceCommand({ provider, onTranscript }));
  await act(() => result.current.start());
  expect(result.current.state.status).toBe('model_unavailable');
  expect(mockStream.start).not.toHaveBeenCalled();
  expect(onTranscript).not.toHaveBeenCalled();
});

test('[mocked] microphone permission denied -> PERMISSION_DENIED', async () => {
  mockPerms.granted = false;
  const { result } = await renderHook(() => useVoiceCommand({ provider: fakeProvider(), onTranscript: jest.fn() }));
  await act(() => result.current.start());
  expect(result.current.state).toMatchObject({ status: 'error', error: { code: 'PERMISSION_DENIED' } });
  expect(mockStream.start).not.toHaveBeenCalled();
});

test('[mocked] cancel while listening -> cancelled, no transcription', async () => {
  const provider = fakeProvider();
  const { result } = await renderHook(() => useVoiceCommand({ provider, onTranscript: jest.fn() }));
  await act(() => result.current.start());
  await act(async () => result.current.cancel());
  expect(result.current.state.status).toBe('cancelled');
  expect(provider.transcribe).not.toHaveBeenCalled();
  expect(mockStream.stop).toHaveBeenCalled();
});

test('[mocked] recognition failure surfaces a typed error and does not call back', async () => {
  const provider = fakeProvider({ transcribe: jest.fn(async () => Promise.reject(new STTError('SILENT_AUDIO', 'quiet'))) });
  const onTranscript = jest.fn();
  const { result } = await renderHook(() => useVoiceCommand({ provider, onTranscript }));
  await act(() => result.current.start());
  await act(() => result.current.stop());
  expect(result.current.state).toMatchObject({ status: 'error', error: { code: 'SILENT_AUDIO' } });
  expect(onTranscript).not.toHaveBeenCalled();
});

test('[mocked] microphone start failure -> RECORDING_FAILED', async () => {
  mockStream.start.mockRejectedValueOnce(new Error('AudioRecord init failed'));
  const { result } = await renderHook(() => useVoiceCommand({ provider: fakeProvider(), onTranscript: jest.fn() }));
  await act(() => result.current.start());
  expect(result.current.state).toMatchObject({ status: 'error', error: { code: 'RECORDING_FAILED' } });
});
