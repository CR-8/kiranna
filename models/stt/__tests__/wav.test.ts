import { analyzePcm16, assertSupportedFormat, encodeWavPcm16, isSilent, parseWavHeader, WavFormatError } from '../wav';

export function tone(seconds: number, amp = 0.3, sr = 16000): Int16Array {
  const n = Math.round(seconds * sr);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sr) * amp * 32767);
  return out;
}

test('parses a 16 kHz mono PCM header', () => {
  const wav = encodeWavPcm16(tone(1.5), 16000);
  const info = parseWavHeader(wav, wav.length);
  expect(info).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, audioFormat: 1, dataOffset: 44 });
  expect(info.durationMs).toBeCloseTo(1500);
  expect(() => assertSupportedFormat(info)).not.toThrow();
});

test('falls back to file size when a streaming writer left the data size at 0', () => {
  const wav = encodeWavPcm16(tone(1), 16000);
  new DataView(wav.buffer).setUint32(40, 0, true);
  expect(parseWavHeader(wav, wav.length).durationMs).toBeCloseTo(1000);
});

test('rejects non-WAV and unsupported formats', () => {
  expect(() => parseWavHeader(new Uint8Array(10))).toThrow(WavFormatError);
  expect(() => parseWavHeader(new Uint8Array(100))).toThrow('Not a RIFF/WAVE file');
  const stereo = encodeWavPcm16(tone(1), 16000);
  new DataView(stereo.buffer).setUint16(22, 2, true);
  expect(() => assertSupportedFormat(parseWavHeader(stereo, stereo.length))).toThrow('mono');
});

test('silence gate: digital silence and faint noise are silent, a tone is not', () => {
  const silent = encodeWavPcm16(new Int16Array(32000), 16000);
  expect(isSilent(analyzePcm16(silent.subarray(44), 16000))).toBe(true);

  const faint = new Int16Array(32000).map(() => Math.round((Math.random() - 0.5) * 0.004 * 32767));
  expect(isSilent(analyzePcm16(encodeWavPcm16(faint, 16000).subarray(44), 16000))).toBe(true);

  const speechLike = encodeWavPcm16(tone(1), 16000);
  const stats = analyzePcm16(speechLike.subarray(44), 16000);
  expect(isSilent(stats)).toBe(false);
  expect(stats.voicedMs).toBeGreaterThanOrEqual(900);
});
