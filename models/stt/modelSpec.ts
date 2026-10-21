/**
 * Verified description of the published hi-hinglish-swift model.
 *
 * Source: https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/tree/main/hi-hinglish-swift
 * Pinned to repo revision 9721eb71eea141fae0982cfcdb9dd2e3d4953c4a.
 *
 * sha256 values for the .onnx files are the Git LFS object ids published by
 * Hugging Face. tokens.txt is not stored in LFS; Hugging Face publishes its git
 * blob sha1 (a4edf0b719c10d28cd83f8c294449f99ff5d5dc0). We downloaded it,
 * confirmed that blob sha1, and recorded the file's sha256 here.
 *
 * The repo also contains encoder.weights / decoder.weights. The model card says
 * they are leftovers from an earlier export, and we confirmed that both int8
 * graphs have zero external-data tensors, so they are not downloaded.
 */

export interface ModelFileSpec {
  name: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface ModelSpec {
  id: string;
  displayName: string;
  revision: string;
  license: string;
  sampleRate: number;
  /** Whisper attends over a fixed 30 s window; longer audio is not transcribed in full. */
  maxAudioSeconds: number;
  language: string;
  files: {
    encoder: ModelFileSpec;
    decoder: ModelFileSpec;
    tokens: ModelFileSpec;
  };
}

const REVISION = '9721eb71eea141fae0982cfcdb9dd2e3d4953c4a';
const BASE = `https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/${REVISION}/hi-hinglish-swift`;

export const HINGLISH_SWIFT: ModelSpec = {
  id: 'hi-hinglish-swift',
  displayName: 'Hinglish Swift (Whisper-base, int8)',
  revision: REVISION,
  license: 'Apache-2.0 (Oriserve Whisper-Hindi2Hinglish-Swift; ONNX export by parismitaglobalsolutions)',
  sampleRate: 16000,
  maxAudioSeconds: 28,
  language: 'hi',
  files: {
    encoder: {
      name: 'encoder.int8.onnx',
      url: `${BASE}/encoder.int8.onnx`,
      sizeBytes: 29_122_029,
      sha256: '817f10919051ba8c784935a54da22683fceefd45a8c3547e68369204fc36c5ff',
    },
    decoder: {
      name: 'decoder.int8.onnx',
      url: `${BASE}/decoder.int8.onnx`,
      sizeBytes: 130_781_044,
      sha256: '19e88530a38a00af1744bc2c9340e72d4687f017e19b37b1b6c69c2b5128fc12',
    },
    tokens: {
      name: 'tokens.txt',
      url: `${BASE}/tokens.txt`,
      sizeBytes: 816_730,
      sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
    },
  },
};

export function modelFiles(spec: ModelSpec): ModelFileSpec[] {
  return [spec.files.encoder, spec.files.decoder, spec.files.tokens];
}

export function totalDownloadBytes(spec: ModelSpec): number {
  return modelFiles(spec).reduce((n, f) => n + f.sizeBytes, 0);
}
