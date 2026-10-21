/**
 * MOCKED NATIVE INFERENCE. The sherpa-onnx engine is replaced by a fake so these
 * tests check the provider's contract (validation, errors, concurrency, cleanup),
 * not recognition quality. Real inference is measured in STT_EVALUATION.md and
 * STT_DEVICE_TESTING.md.
 */
jest.mock('expo-file-system', () => {
  const f = jest.requireActual('./fakeFileSystem');
  return { File: f.FakeFile, Directory: f.FakeDirectory, Paths: f.FakePaths };
});

import type { ModelManager } from '../modelManager';
import { HINGLISH_SWIFT } from '../modelSpec';
import { SherpaWhisperProvider, type NativeSttEngine } from '../sherpaWhisperProvider';
import { STTError } from '../types';
import { encodeWavPcm16 } from '../wav';
import { tone } from './wav.test';

const SPEECH = encodeWavPcm16(tone(2), 16000);
const SILENCE = encodeWavPcm16(new Int16Array(32000), 16000);

function fakeManager(installed = true): ModelManager {
  return {
    spec: HINGLISH_SWIFT,
    isInstalled: jest.fn(() => installed),
    pathOf: (f: { name: string }) => `/data/models/${f.name}`,
  } as unknown as ModelManager;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(opts: { installed?: boolean; text?: string; files?: Record<string, Uint8Array> } = {}) {
  const engine: jest.Mocked<NativeSttEngine> = {
    transcribeFile: jest.fn(async (_path: string) => ({ text: opts.text ?? ' Maggi ke das packet add karo. ' })),
    destroy: jest.fn(async () => undefined),
  };
  const createEngine = jest.fn(async (_config: Record<string, unknown>) => engine);
  const files: Record<string, Uint8Array> = { 'file:///cache/a.wav': SPEECH, ...opts.files };
  const provider = new SherpaWhisperProvider({
    manager: fakeManager(opts.installed ?? true),
    createEngine,
    readFile: async (uri) => {
      if (!files[uri]) throw new STTError('INVALID_AUDIO', 'not found');
      return files[uri];
    },
  });
  return { provider, engine, createEngine };
}

const code = (p: Promise<unknown>) => p.then(() => 'resolved', (e) => (e instanceof STTError ? e.code : `other:${e}`));

test('[mocked] initialize builds one Whisper recognizer from the installed files', async () => {
  const { provider, createEngine } = setup();
  await provider.initialize();
  await provider.initialize();
  expect(createEngine).toHaveBeenCalledTimes(1);
  expect(createEngine.mock.calls[0][0]).toMatchObject({
    modelConfig: {
      whisper: { encoder: '/data/models/encoder.int8.onnx', decoder: '/data/models/decoder.int8.onnx', language: 'hi', task: 'transcribe' },
      tokens: '/data/models/tokens.txt',
      numThreads: 2,
    },
  });
  expect(await provider.getStatus()).toEqual({ initialized: true, modelInstalled: true, offlineCapable: true });
});

test('[mocked] missing model files -> MODEL_NOT_INSTALLED, engine never created', async () => {
  const { provider, createEngine } = setup({ installed: false });
  expect(await code(provider.initialize())).toBe('MODEL_NOT_INSTALLED');
  expect(await code(provider.transcribe('file:///cache/a.wav'))).toBe('MODEL_NOT_INSTALLED');
  expect(createEngine).not.toHaveBeenCalled();
  expect(await provider.getStatus()).toMatchObject({ initialized: false, modelInstalled: false, offlineCapable: false });
});

test('[mocked] native init failure -> MODEL_INIT_FAILED and status carries the error', async () => {
  const { provider, createEngine } = setup();
  createEngine.mockRejectedValueOnce(new Error('Native model loading returned null'));
  expect(await code(provider.initialize())).toBe('MODEL_INIT_FAILED');
  expect((await provider.getStatus()).error).toMatch(/Native model loading/);
  // a later attempt can still succeed
  await provider.initialize();
  expect((await provider.getStatus()).initialized).toBe(true);
});

test('[mocked] native allocation failure is classified as RESOURCE_EXHAUSTED', async () => {
  const { provider, createEngine } = setup();
  createEngine.mockRejectedValueOnce(new Error('std::bad_alloc'));
  expect(await code(provider.initialize())).toBe('RESOURCE_EXHAUSTED');
});

test('[mocked] valid audio -> trimmed transcript, file path without file://', async () => {
  const { provider, engine } = setup();
  const r = await provider.transcribe('file:///cache/a.wav');
  expect(r).toMatchObject({ transcript: 'Maggi ke das packet add karo.', durationMs: 2000, modelId: 'hi-hinglish-swift' });
  expect(engine.transcribeFile).toHaveBeenCalledWith('/cache/a.wav');
});

test('[mocked] the transcript is not corrected or rewritten', async () => {
  const { provider } = setup({ text: 'Meggi ke dus pakit' });
  expect((await provider.transcribe('file:///cache/a.wav')).transcript).toBe('Meggi ke dus pakit');
});

test('[mocked] silent audio is rejected before inference', async () => {
  const { provider, engine } = setup({ files: { 'file:///cache/s.wav': SILENCE } });
  expect(await code(provider.transcribe('file:///cache/s.wav'))).toBe('SILENT_AUDIO');
  expect(engine.transcribeFile).not.toHaveBeenCalled();
});

test('[mocked] empty, truncated, missing, too short and too long audio -> INVALID_AUDIO', async () => {
  const { provider, engine } = setup({
    files: {
      'file:///cache/empty.wav': new Uint8Array(0),
      'file:///cache/junk.wav': new Uint8Array(200).fill(7),
      'file:///cache/short.wav': encodeWavPcm16(tone(0.1), 16000),
      'file:///cache/long.wav': encodeWavPcm16(tone(31), 16000),
    },
  });
  for (const f of ['empty', 'junk', 'short', 'long', 'missing']) {
    expect(await code(provider.transcribe(`file:///cache/${f}.wav`))).toBe('INVALID_AUDIO');
  }
  expect(engine.transcribeFile).not.toHaveBeenCalled();
});

test('[mocked] empty model output -> EMPTY_TRANSCRIPT', async () => {
  const { provider } = setup({ text: '   ' });
  expect(await code(provider.transcribe('file:///cache/a.wav'))).toBe('EMPTY_TRANSCRIPT');
});

test('[mocked] native decode error -> INFERENCE_FAILED, provider stays usable', async () => {
  const { provider, engine } = setup();
  engine.transcribeFile.mockRejectedValueOnce(new Error('onnxruntime: Run failed'));
  expect(await code(provider.transcribe('file:///cache/a.wav'))).toBe('INFERENCE_FAILED');
  expect((await provider.transcribe('file:///cache/a.wav')).transcript).toBeTruthy();
});

test('[mocked] cancellation before and during native decode -> CANCELLED', async () => {
  const { provider, engine } = setup();
  const pre = new AbortController();
  pre.abort();
  expect(await code(provider.transcribe('file:///cache/a.wav', { signal: pre.signal }))).toBe('CANCELLED');
  expect(engine.transcribeFile).not.toHaveBeenCalled();

  const gate = deferred<{ text: string }>();
  engine.transcribeFile.mockReturnValueOnce(gate.promise);
  const during = new AbortController();
  const p = provider.transcribe('file:///cache/a.wav', { signal: during.signal });
  await new Promise((r) => setTimeout(r, 0));
  during.abort();
  gate.resolve({ text: 'late result' });
  expect(await code(p)).toBe('CANCELLED');
});

test('[mocked] repeated requests reuse one engine; overlapping request -> BUSY', async () => {
  const { provider, engine, createEngine } = setup();
  for (let i = 0; i < 5; i++) await provider.transcribe('file:///cache/a.wav');
  expect(createEngine).toHaveBeenCalledTimes(1);
  expect(engine.transcribeFile).toHaveBeenCalledTimes(5);

  const gate = deferred<{ text: string }>();
  engine.transcribeFile.mockReturnValueOnce(gate.promise);
  const first = provider.transcribe('file:///cache/a.wav');
  expect(await code(provider.transcribe('file:///cache/a.wav'))).toBe('BUSY');
  gate.resolve({ text: 'ok' });
  expect((await first).transcript).toBe('ok');
});

test('[mocked] release waits for in-flight inference, frees the engine, and re-inits lazily', async () => {
  const { provider, engine, createEngine } = setup();
  const gate = deferred<{ text: string }>();
  engine.transcribeFile.mockReturnValueOnce(gate.promise);
  const p = provider.transcribe('file:///cache/a.wav');
  await new Promise((r) => setTimeout(r, 0));
  const released = provider.release();
  expect(engine.destroy).not.toHaveBeenCalled();
  gate.resolve({ text: 'done' });
  await p;
  await released;
  expect(engine.destroy).toHaveBeenCalledTimes(1);
  expect((await provider.getStatus()).initialized).toBe(false);

  await provider.transcribe('file:///cache/a.wav');
  expect(createEngine).toHaveBeenCalledTimes(2);
  await provider.release();
  await provider.release();
  expect(engine.destroy).toHaveBeenCalledTimes(2);
});

test('[mocked] offline after install: transcription makes no network requests', async () => {
  const fetchSpy = jest.fn(() => Promise.reject(new Error('network disabled')));
  const original = global.fetch;
  global.fetch = fetchSpy as never;
  try {
    const { provider } = setup();
    expect((await provider.transcribe('file:///cache/a.wav')).transcript).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    global.fetch = original;
  }
});
