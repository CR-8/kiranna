# Kirana POS — on-device ML

Offline Hindi / English / Hinglish speech-to-text for voice billing. Speech is captured,
transcribed and kept **on the phone**; after a one-time model download no network is used.

| | |
|---|---|
| Model | `hi-hinglish-swift` — Whisper-base fine-tuned for Hinglish, int8 ONNX |
| Runtime | sherpa-onnx 1.12.29 via [`expo-sherpa-onnx`](https://github.com/tirth0/expo-sherpa-onnx) 0.0.8 |
| Download | 160.7 MB (3 files), verified by SHA-256, installed only when the user taps Download |
| Output | Romanized Hinglish text, shown to the user — never auto-applied to a bill |
| Status | Integrated + 39 unit tests (native mocked) + desktop benchmark. **Not yet run on a phone.** |

Docs: [implementation](docs/STT_IMPLEMENTATION.md) · [evaluation](docs/STT_EVALUATION.md) ·
[device testing](docs/STT_DEVICE_TESTING.md)

## Model

| Property | Value |
|---|---|
| Source | [parismitaglobalsolutions/indicconformer-sherpa-onnx `hi-hinglish-swift/`](https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/tree/main/hi-hinglish-swift), revision `9721eb7` |
| Base | [Oriserve Whisper-Hindi2Hinglish-Swift](https://huggingface.co/Oriserve) ← OpenAI Whisper-base |
| Architecture | Transformer encoder-decoder: 6 encoder + 6 decoder layers, width 512, 8 heads, 80-bin log-mel input, 30 s receptive window, 51 865-token BPE vocabulary, greedy decoding |
| Parameters | 72.6 M |
| Files | `encoder.int8.onnx` 29.1 MB · `decoder.int8.onnx` 130.8 MB · `tokens.txt` 0.8 MB |
| Audio | 16 kHz mono (other rates resampled by the runtime) |
| License | Apache-2.0 |

### How it was trained and converted (upstream, not by us)

1. **Pre-training** — OpenAI Whisper-base, weakly-supervised on ~680 k hours of multilingual web audio.
2. **Fine-tuning** — Oriserve fine-tuned it on ~550 hours of Indian-accented Hindi/Hinglish speech
   with Romanized targets, so it outputs code-switched text like "Maggi ke do packet" instead of Devanagari.
3. **Export** — converted Hugging Face → OpenAI checkpoint format, exported to ONNX with
   sherpa-onnx's `export-onnx-with-attention.py` (keeps cross-attention for token timestamps;
   DTW alignment heads found empirically).
4. **Quantization** — onnxruntime dynamic int8, **MatMul ops only** (full int8/fp16 hurt accuracy
   per the exporter). Non-MatMul weights such as the 51 865 × 512 token embedding are left
   unquantized, which most likely explains why the decoder is ~4× the encoder.

We did no training. Our work is integration, verification and evaluation.

### Published accuracy (model card)

| Benchmark | WER |
|---|---|
| Common Voice | 38.7 % |
| FLEURS | 35.1 % |
| Indic-Voices (noisy, conversational) | **65.2 %** |

The larger `hi-hinglish-apex` (Whisper Large-V3 Turbo, ~1 GB) scores 47.6 % on Indic-Voices — too
big for low-end phones, kept as the upgrade path.

## Our evaluation (synthetic speech, desktop CPU)

30 kirana commands × 3 offline Hindi TTS voices × 4 conditions = 360 clips. Full method,
caveats and per-clip transcripts in [docs/STT_EVALUATION.md](docs/STT_EVALUATION.md).

| Condition | WER | WER (spelling-normalised) | Quantity correct | Spurious quantity | Product correct* | Exact command* |
|---|---|---|---|---|---|---|
| Clean | 32.4 % | 26.0 % | 90.7 % | 7.8 % | 54.8 % | 18.9 % |
| Fast speech | 31.4 % | 25.4 % | 90.7 % | 4.4 % | 58.3 % | 16.7 % |
| White noise 10 dB | 43.2 % | 37.7 % | 88.0 % | 8.9 % | 42.9 % | 10.0 % |
| Shop babble 5 dB | 63.1 % | 59.6 % | 60.0 % | 14.4 % | 26.2 % | 2.2 % |
| **Overall** | **42.5 %** | **37.2 %** | **82.3 %** | **8.9 %** | **45.5 %** | **11.9 %** |

\* spelling-normalised. Runtime: sherpa-onnx 1.12.29 (the version the app ships), 2 threads.

| Desktop performance | |
|---|---|
| Model load | ~1.0 s |
| Decode 2 s / 5 s / 10 s audio | 0.37 / 0.74 / 1.33 s |
| Real-time factor | 0.18 |
| Memory: after load / peak | ~236 MB / ~400 MB |

**Synthetic TTS on a desktop is not the field.** Expect real shop audio on a budget phone to be
slower and less accurate. Phone numbers are deliberately left blank until measured
([device testing](docs/STT_DEVICE_TESTING.md)).

**Takeaways**
- Quiet speech: quantities mostly right; **brand names often misspelled** ("Meggi").
- **~8 % of clean clips contain an invented or wrong number** ("pasta" → "Paanch tak", "ek" → "8").
- Background chatter roughly doubles errors.
- Silence makes Whisper hallucinate ("Hai."), so silent recordings are rejected before inference.
- ⇒ Voice is an **assist**: the transcript is shown, the shopkeeper confirms, manual add and
  barcode scan stay primary.

## How it works in the app

```
New bill → START SPEAKING (tap) → LISTENING → tap again → PROCESSING
  expo-audio 16 kHz mono WAV → silence/format check → sherpa-onnx Whisper → text
  → "What I heard" card (bill is NOT changed)
```

- **Settings → Voice model** downloads, verifies (size + SHA-256), and can remove the model.
- Files: `<app documents>/stt-models/hi-hinglish-swift/`; partial downloads stay in a separate
  staging folder; the model counts as installed only after every file verifies.
- One recognizer per app, loaded lazily (warmed while you speak), released when the app goes
  to the background. One transcription at a time.
- Errors are typed (`MODEL_NOT_INSTALLED`, `SILENT_AUDIO`, `INFERENCE_FAILED`, …) and never crash the app.

```ts
import { useVoiceCommand } from '@models/stt';

const voice = useVoiceCommand({ onTranscript: (r) => handle(r.transcript) });
// voice.start(), voice.stop(), voice.cancel(), voice.state.status
```

## Layout

```
models/
  stt/                 provider, model manager, WAV checks, React hooks
    __tests__/         unit tests (native inference mocked)
    eval/              command set, TTS generator, evaluation runner, results/
  docs/                implementation, evaluation, device-testing notes
  .cache/              (git-ignored) local model copy for desktop evaluation
```

## Commands

```bash
npm install
npm test                 # 39 unit tests
npx tsc --noEmit
npx expo lint
npx eas-cli@latest build --profile development --platform android   # native module ⇒ dev build, not Expo Go
npx expo start
```

## Limitations and open items

1. **No phone run yet** — latency, RAM, APK size delta, battery and the airplane-mode test are unmeasured.
2. **No real-speech evaluation** — only synthetic TTS. Record real shopkeepers (protocol in the evaluation doc).
3. Accuracy is modest (see above); product names and spurious numbers need downstream confirmation.
4. Voice text is not yet parsed into bill actions — that belongs to the inventory layer (`src/lib/engine.ts`).
5. `expo-sherpa-onnx` is a 0.0.x work-in-progress package (pinned exactly); it bundles an unused libarchive (~8 MB/ABI).
6. Silence-gate thresholds (−40 dBFS, 200 ms) were checked on synthetic audio only; tune on real mics.
7. Native decode cannot be interrupted; cancelling discards the result after it finishes.
8. Downloads restart a file from zero if interrupted (finished files are kept).
9. Whisper handles ≤ 30 s per clip; recordings auto-stop at 15 s.
10. Android only for now; web shows a "voice works in the Android app" message; iOS untested.

## Credits

Whisper — OpenAI · Hinglish fine-tune — Oriserve · ONNX export/quantization — Parismita Global
Solutions · Runtime — k2-fsa/sherpa-onnx · Expo module — tirth0 · TTS voices for evaluation — Piper hi_IN via sherpa-onnx.
