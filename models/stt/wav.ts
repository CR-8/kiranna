/**
 * Minimal WAV inspection used to reject bad input *before* it reaches the
 * native recognizer. Whisper hallucinates text on silence (desktop baseline:
 * 2 s of digital silence produced "Hai." / "uhh"), so silent clips are
 * rejected here instead of being sent to the model.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** 1 = integer PCM, 3 = IEEE float */
  audioFormat: number;
  dataOffset: number;
  dataBytes: number;
  durationMs: number;
}

export class WavFormatError extends Error {}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

/** Parses the RIFF header. `bytes` must contain at least the header and the start of the data chunk. */
export function parseWavHeader(bytes: Uint8Array, fileSize?: number): WavInfo {
  if (bytes.length < 44) throw new WavFormatError('File is too small to be a WAV file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new WavFormatError('Not a RIFF/WAVE file');
  }

  let off = 12;
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataBytes' | 'durationMs'> | null = null;
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off, 4);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      if (body + 16 > bytes.length) throw new WavFormatError('Truncated fmt chunk');
      fmt = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new WavFormatError('data chunk before fmt chunk');
      // Streaming writers may leave the size as 0 or 0xFFFFFFFF; fall back to the file size.
      let dataBytes = size;
      if (fileSize !== undefined && (size === 0 || size === 0xffffffff || body + size > fileSize)) {
        dataBytes = Math.max(0, fileSize - body);
      }
      const bytesPerFrame = (fmt.bitsPerSample / 8) * fmt.channels;
      if (bytesPerFrame <= 0 || fmt.sampleRate <= 0) throw new WavFormatError('Invalid fmt values');
      return {
        ...fmt,
        dataOffset: body,
        dataBytes,
        durationMs: (dataBytes / bytesPerFrame / fmt.sampleRate) * 1000,
      };
    }
    off = body + size + (size % 2);
  }
  throw new WavFormatError('No data chunk found');
}

/** The sherpa-onnx WaveReader accepts 16-bit integer PCM, mono. Anything else is rejected up front. */
export function assertSupportedFormat(info: WavInfo): void {
  if (info.audioFormat !== 1 && info.audioFormat !== 0xfffe) {
    throw new WavFormatError(`Unsupported WAV encoding (format ${info.audioFormat}); expected 16-bit PCM`);
  }
  if (info.bitsPerSample !== 16) throw new WavFormatError(`Expected 16-bit samples, got ${info.bitsPerSample}`);
  if (info.channels !== 1) throw new WavFormatError(`Expected mono audio, got ${info.channels} channels`);
  if (info.sampleRate < 8000 || info.sampleRate > 48000) {
    throw new WavFormatError(`Unsupported sample rate ${info.sampleRate} Hz`);
  }
}

export interface LevelStats {
  /** Peak absolute sample, dBFS. -Infinity for digital silence. */
  peakDbfs: number;
  /** Total duration of 20 ms frames whose RMS is above `voiceThresholdDbfs`. */
  voicedMs: number;
}

export interface SilenceGate {
  /** Frames louder than this count as voiced. */
  voiceThresholdDbfs: number;
  /** Minimum voiced duration for a clip to be sent to the model. */
  minVoicedMs: number;
}

/**
 * Starting values checked against the synthetic set: every clean/fast TTS clip has >= 1000 ms
 * voiced (>= 540 ms even when attenuated by 20 dB), while digital silence and white noise up
 * to -45 dBFS RMS score 0 ms. Speech attenuated by 30 dB is rejected. These values have NOT
 * been tuned on real phone microphones; see models/docs/STT_DEVICE_TESTING.md.
 */
export const DEFAULT_SILENCE_GATE: SilenceGate = { voiceThresholdDbfs: -40, minVoicedMs: 200 };

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Level statistics over little-endian int16 mono PCM. */
export function analyzePcm16(pcm: Uint8Array, sampleRate: number, gate: SilenceGate = DEFAULT_SILENCE_GATE): LevelStats {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2));
  const n = view.byteLength / 2;
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  const thr = 10 ** (gate.voiceThresholdDbfs / 20);
  let peak = 0;
  let voicedFrames = 0;
  for (let start = 0; start < n; start += frame) {
    const end = Math.min(n, start + frame);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = view.getInt16(i * 2, true) / 32768;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sumSq += v * v;
    }
    if (Math.sqrt(sumSq / (end - start)) >= thr) voicedFrames++;
  }
  return { peakDbfs: toDb(peak), voicedMs: voicedFrames * 20 };
}

export function isSilent(stats: LevelStats, gate: SilenceGate = DEFAULT_SILENCE_GATE): boolean {
  return stats.voicedMs < gate.minVoicedMs;
}

/** Builds a 16-bit PCM mono WAV. Used by tests and device benchmarking tools. */
export function encodeWavPcm16(samples: Int16Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const w = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true);
  return out;
}
