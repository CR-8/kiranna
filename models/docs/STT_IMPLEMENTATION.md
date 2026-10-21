# Offline Hinglish STT — implementation

Status: integrated and unit-tested (native inference mocked). **Not yet run on a physical
Android device** — see [STT_DEVICE_TESTING.md](STT_DEVICE_TESTING.md).

## Pipeline

```
MicrophoneButton (src/app/sale/[id]/index.tsx)
  └─ useVoiceInput  (src/components/voice.tsx)            app wiring, UI states
       └─ useVoiceCommand (models/stt/useVoiceCommand.ts)  record → transcribe state machine
            ├─ expo-audio AudioStream  16 kHz · mono · int16 → WAV in cache dir
            └─ SherpaWhisperProvider (models/stt/sherpaWhisperProvider.ts)
                 ├─ WAV header check + silence gate (models/stt/wav.ts)
                 └─ expo-sherpa-onnx createSTT → OfflineRecognizer (Whisper) → text
  onTranscript(result) → shown in the "What I heard" card. Nothing is added to the bill.
```

The STT layer returns the model's text verbatim (trimmed). Product matching, quantity
parsing, confirmation and stock changes stay in the inventory layer (`src/lib/engine.ts`),
which does not consume voice yet — that is the next integration step, not part of this work.

## Repository findings (inspection, 2026-10-21)

| Item | Finding |
|---|---|
| Expo SDK | 58 (`expo ~58.0.16`), React Native 0.88, React 19.3, TypeScript 6 |
| Build type | Continuous Native Generation; no `android/`/`ios/` checked in. Native modules ⇒ **development build required** (Expo Go cannot load sherpa-onnx). |
| Existing mic UI | `MicrophoneButton` + `MicState` in `src/components/ui.tsx`, hard-wired to `'unavailable'` on the bill screen with a comment asking for it to be driven by the speech model. |
| Existing audio code | none |
| Transcript interface | none; the bill screen had a placeholder. `onTranscript` callback added. |
| Web | app also runs on web (`storage.web.ts`); voice is disabled there with a message. |

## Model (verified, not assumed)

Source: `parismitaglobalsolutions/indicconformer-sherpa-onnx`, folder `hi-hinglish-swift`,
pinned to revision `9721eb71eea141fae0982cfcdb9dd2e3d4953c4a`.

| Property | Value | How verified |
|---|---|---|
| Architecture | Whisper-base encoder-decoder (6+6 layers, d=512, 8 heads, 80 mel bins, 30 s window, vocab 51 865) | ONNX metadata |
| Origin | Oriserve `Whisper-Hindi2Hinglish-Swift` (72.6 M params, ~550 h Hindi/Hinglish), exported with sherpa-onnx `export-onnx-with-attention.py`, MatMul-only int8 | model card |
| Files used | `encoder.int8.onnx` 29 122 029 B · `decoder.int8.onnx` 130 781 044 B · `tokens.txt` 816 730 B = **160.7 MB (153.3 MiB)** | HF tree API |
| Hashes | encoder `817f1091…c36c5ff`, decoder `19e88530…28fc12` (HF LFS sha256, re-computed locally: match); tokens git-blob sha1 `a4edf0b7…dc0` matched, sha256 `b34b360d…fa126` recorded | sha256sum / sha1 |
| `*.weights` files | not needed: card says leftovers; both int8 graphs have **0 external-data tensors** | `onnx.load(load_external_data=False)` |
| Input | 16 kHz mono float PCM; runtime resamples other rates (48 kHz input → identical text on desktop) | eval harness |
| Output | Romanized Hinglish with punctuation; 0/360 eval outputs contained Devanagari | eval harness |
| Language token | `hi` per model card. `hi`, `en` and auto gave byte-identical WER on the clean set. | eval harness |
| Runtime | sherpa-onnx `OfflineRecognizer` + `OfflineWhisperModelConfig`; **works with 1.12.29**, the version bundled in expo-sherpa-onnx 0.0.8 | desktop run with `sherpa-onnx==1.12.29` |
| License | Apache-2.0 (Oriserve fine-tune and the export). Redistribution allowed with notice; the app downloads from HF rather than re-hosting. | model card |
| Published accuracy | Common Voice 38.7 % / FLEURS 35.1 % / **Indic-Voices 65.2 % WER** | model card |

## Runtime integration

* **expo-sherpa-onnx 0.0.8**, pinned exactly (the README marks it unstable/WIP). Bundles prebuilt
  sherpa-onnx 1.12.29 for `arm64-v8a`, `armeabi-v7a`, `x86_64`; no config plugin required.
  JS API used: `createSTT(config)` → `transcribeFile(path)` / `destroy()`.
* Its `StreamingPipeline` was evaluated and rejected: it only accepts online (streaming)
  models and requires a punctuation model; Whisper is offline-only. Push-to-talk with offline
  decode is the correct path for this model.
* Its `ModelDownloadManager` was not used (built on `expo-file-system/legacy`); we use the SDK 58
  `File`/`Directory` API instead.
* No custom native code was written.

## Audio input

* `expo-audio` `useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'int16' })` +
  `startFileRecordingAsync({ format: 'wav' })` — mic PCM goes straight to a WAV the native
  `WaveReader` reads. No encode/decode round-trip, no JS-side resampling.
* If the hardware delivers another rate, the WAV header says so and sherpa-onnx resamples.
* Before inference the provider rejects: unreadable/non-RIFF/non-16-bit/non-mono WAV,
  < 300 ms, > 28 s (Whisper's window is 30 s), > 8 MB, and **silent clips** (< 200 ms of
  20 ms frames above −40 dBFS). The gate exists because Whisper hallucinated "Hai." / "uhh"
  on 2 s of silence in the desktop baseline.
* Permission: `getRecordingPermissionsAsync`, then request if askable; denial → typed error,
  manual workflows untouched. `RECORD_AUDIO` comes from the `expo-audio` config plugin.
* Auto-stop after 15 s; cancel in listening/processing; temp WAV deleted after every attempt;
  backgrounding the app cancels capture and releases the recognizer.

## Provider contract (`models/stt/types.ts`)

`initialize()`, `transcribe(uri, { signal })`, `getStatus()`, `release()` returning
`{ transcript, durationMs, inferenceMs, modelId }`. Errors are `STTError` with `code`:
`MODEL_NOT_INSTALLED`, `MODEL_INIT_FAILED`, `INVALID_AUDIO`, `SILENT_AUDIO`,
`EMPTY_TRANSCRIPT`, `INFERENCE_FAILED`, `CANCELLED`, `BUSY`, `RESOURCE_EXHAUSTED`,
`PERMISSION_DENIED`, `RECORDING_FAILED`.

* One recognizer per process (`getSharedSttProvider`), created lazily (warmed when recording
  starts) and reused. Desktop RSS is ≈ 200 MB per loaded recognizer; the benchmark run that also
  created a second instance peaked at ≈ 775 MB vs ≈ 400 MB without it, so duplicates are avoided.
* One inference at a time; overlap → `BUSY`. Native decode cannot be interrupted, so cancelling
  mid-decode discards the result once it returns.
* `RESOURCE_EXHAUSTED` is a message heuristic (`bad_alloc`, "out of memory"). A native OOM
  kill by Android's low-memory killer cannot be caught from JS.
* No confidence scores or language IDs are exposed — the runtime does not produce meaningful ones
  for this model and none are invented.

## Model installation (`models/stt/modelManager.ts`)

* Only on explicit user action: **Settings → Voice model → Download (153 MB)**. Never during billing.
* `<document>/stt-models/.staging-hi-hinglish-swift/<file>.part` while downloading → size + SHA-256
  check → rename. Mismatch deletes the file. Verified files survive an interrupted install and are
  not re-downloaded. Incomplete files are discarded and restarted (the SDK's DownloadTask
  pause/resume is in-session only and was not relied on).
* Free-space check (needed bytes + 50 MB) before downloading.
* Promotion: staging dir renamed to `stt-models/hi-hinglish-swift/`, then `install.json` written
  **last**. "Installed" = manifest with matching model id + revision and every file at its exact size.
  `verifyInstalled()` re-hashes on demand.
* `uninstall()` deletes only this model's two directories.
* URLs are public; no tokens in the app. After install no network is used.

## Files

| Path | Purpose |
|---|---|
| `models/stt/types.ts` | contract + typed errors |
| `models/stt/modelSpec.ts` | pinned URLs, sizes, hashes |
| `models/stt/modelManager.ts` | install / verify / uninstall |
| `models/stt/wav.ts` | WAV parsing, silence gate |
| `models/stt/sherpaWhisperProvider.ts` | provider |
| `models/stt/useVoiceCommand.ts`, `useModelInstall.ts`, `shared.ts` | React layer |
| `src/components/voice.tsx` | app wiring + "What I heard" card |
| `src/app/sale/[id]/index.tsx`, `src/app/settings.tsx`, `src/lib/i18n.ts` | minimal UI changes |
| `src/app/stt-bench.tsx` | `__DEV__`-only on-device benchmark |
| `models/stt/__tests__/` | unit tests (mocked native) |
| `models/stt/eval/` | evaluation set, TTS generator, desktop harness, results |

## Commands

```bash
npm install
npx tsc --noEmit
npx expo lint
npm test
npx expo start            # in a development build (not Expo Go)
```

Development build (needed once, and after native dependency changes) — see STT_DEVICE_TESTING.md.
