/**
 * ModelManager against an in-memory filesystem + fake network (MOCKED: no real
 * downloads, no real disk). Real downloads are covered in STT_DEVICE_TESTING.md.
 */
import { disk, FakeDirectory, FakeFile, FakePaths, sha256 } from './fakeFileSystem';

jest.mock('expo-file-system', () => {
  const f = jest.requireActual('./fakeFileSystem');
  return { File: f.FakeFile, Directory: f.FakeDirectory, Paths: f.FakePaths };
});

import { ModelInstallError, ModelManager } from '../modelManager';
import type { ModelSpec } from '../modelSpec';

const bytes = (s: string) => new Uint8Array(Buffer.from(s));
const ENC = bytes('encoder-bytes');
const DEC = bytes('decoder-bytes-longer');
const TOK = bytes('tokens');

function spec(overrides: Partial<Record<'encoder' | 'decoder' | 'tokens', string>> = {}): ModelSpec {
  const f = (name: string, b: Uint8Array) => ({
    name,
    url: `https://example.test/${name}`,
    sizeBytes: b.length,
    sha256: overrides[name.split('.')[0] as 'encoder'] ?? sha256(b),
  });
  return {
    id: 'test-model',
    displayName: 'Test',
    revision: 'rev1',
    license: 'test',
    sampleRate: 16000,
    maxAudioSeconds: 28,
    language: 'hi',
    files: { encoder: f('encoder.int8.onnx', ENC), decoder: f('decoder.int8.onnx', DEC), tokens: f('tokens.txt', TOK) },
  };
}

const root = new FakeDirectory(FakePaths.document, 'stt-models');

beforeEach(() => {
  disk.reset();
  disk.remote.set('https://example.test/encoder.int8.onnx', ENC);
  disk.remote.set('https://example.test/decoder.int8.onnx', DEC);
  disk.remote.set('https://example.test/tokens.txt', TOK);
});

test('reports not installed on a fresh device', () => {
  expect(new ModelManager(spec(), root as never).isInstalled()).toBe(false);
});

test('installs, verifies and writes the manifest last', async () => {
  const m = new ModelManager(spec(), root as never);
  const phases: string[] = [];
  await m.install({ onProgress: (p) => phases.push(p.phase) });

  expect(m.isInstalled()).toBe(true);
  expect(await m.verifyInstalled()).toBe(true);
  expect(phases).toContain('downloading');
  expect(phases[phases.length - 1]).toBe('finalizing');
  expect(new FakeFile(root, 'test-model', 'install.json').exists).toBe(true);
  expect(new FakeDirectory(root, '.staging-test-model').exists).toBe(false);
  expect(m.pathOf(m.spec.files.encoder)).toBe('/data/doc/stt-models/test-model/encoder.int8.onnx');
});

test('does not download again once installed', async () => {
  const m = new ModelManager(spec(), root as never);
  await m.install();
  const n = disk.downloads.length;
  await m.install();
  expect(disk.downloads.length).toBe(n);
});

test('concurrent install calls share one download', async () => {
  const m = new ModelManager(spec(), root as never);
  await Promise.all([m.install(), m.install()]);
  expect(disk.downloads.length).toBe(3);
});

test('checksum mismatch: file rejected, model not marked installed', async () => {
  const m = new ModelManager(spec({ decoder: 'f'.repeat(64) }), root as never);
  await expect(m.install()).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
  expect(m.isInstalled()).toBe(false);
  expect(new FakeFile(root, '.staging-test-model', 'decoder.int8.onnx.part').exists).toBe(false);
  expect(new FakeDirectory(root, 'test-model').exists).toBe(false);
});

test('interrupted download: partial file discarded, verified files kept on retry', async () => {
  const m = new ModelManager(spec(), root as never);
  disk.failNext.add('https://example.test/decoder.int8.onnx');
  await expect(m.install()).rejects.toMatchObject({ code: 'NETWORK' });
  expect(m.isInstalled()).toBe(false);
  expect(new FakeFile(root, '.staging-test-model', 'decoder.int8.onnx.part').exists).toBe(false);

  disk.downloads = [];
  await m.install();
  expect(m.isInstalled()).toBe(true);
  // encoder was already verified in staging, so only the remaining files are fetched
  expect(disk.downloads).toEqual(['https://example.test/decoder.int8.onnx', 'https://example.test/tokens.txt']);
});

test('cancellation aborts without marking installed', async () => {
  const m = new ModelManager(spec(), root as never);
  const c = new AbortController();
  c.abort();
  const err = await m.install({ signal: c.signal }).catch((e) => e);
  expect(err).toBeInstanceOf(ModelInstallError);
  expect(err.code).toBe('CANCELLED');
  expect(m.isInstalled()).toBe(false);
});

test('insufficient storage is reported before downloading', async () => {
  disk.availableDiskSpace = 1024;
  const m = new ModelManager(spec(), root as never);
  await expect(m.install()).rejects.toMatchObject({ code: 'INSUFFICIENT_STORAGE' });
  expect(disk.downloads).toEqual([]);
});

test('a missing or truncated installed file means not installed', async () => {
  const m = new ModelManager(spec(), root as never);
  await m.install();
  new FakeFile(root, 'test-model', 'tokens.txt').delete();
  expect(m.isInstalled()).toBe(false);
});

test('a manifest from another revision is not trusted', async () => {
  await new ModelManager(spec(), root as never).install();
  const newer = { ...spec(), revision: 'rev2' };
  expect(new ModelManager(newer, root as never).isInstalled()).toBe(false);
});

test('uninstall removes only this model', async () => {
  const other = new FakeFile(FakePaths.document, 'kirana.db');
  disk.dirs.add(FakePaths.document.uri);
  await other.write('shop data');
  const sibling = new FakeFile(root, 'other-model', 'x.onnx');
  new FakeDirectory(root, 'other-model').create({ intermediates: true });
  await sibling.write('x');

  const m = new ModelManager(spec(), root as never);
  await m.install();
  await m.uninstall();

  expect(m.isInstalled()).toBe(false);
  expect(other.exists).toBe(true);
  expect(sibling.exists).toBe(true);
});
