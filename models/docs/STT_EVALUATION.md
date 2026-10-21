# Kirana STT evaluation — hi-hinglish-swift

> **Read this first.** Every number below comes from **synthetic speech** (offline Piper Hindi
> TTS voices) decoded on a **desktop x86-64 CPU**. No real shopkeeper recordings and no phone
> measurements exist yet. Treat this as a reproducible smoke-test and runtime-compatibility
> check, not as expected field accuracy. Real-speech results will most likely be worse,
> particularly in noisy shops (the model card reports 65.2 % WER on Indic-Voices).

## Set

`models/stt/eval/kirana_commands.json`: 30 commands — 20 Hinglish, 7 Hindi, 3 English
(including all nine from the brief, plus brand names, fractions, dozens, hundreds, corrections).
Each has a Romanized reference, the quantities and the product words that must survive.

Audio (`generate_synthetic_audio.py`, seed 1234): 3 voices (`hi_IN-rohan`, `-priyamvada`,
`-pratham`, Piper medium via sherpa-onnx) × 4 conditions = **360 clips**, 16 kHz mono:

| Condition | Meaning |
|---|---|
| clean | TTS at speed 1.0, 300 ms silence padding |
| fast | TTS at speed 1.25 |
| white_10db | clean + white noise, 10 dB SNR |
| babble_5db | clean + three other utterances underneath, 5 dB SNR (shop chatter proxy) |

## Metrics

* **WER raw** — lowercase, punctuation stripped.
* **WER roman-norm** — both sides folded for Romanization spelling variants (`ee→i`, `oo→u`,
  `w→v`, `ph→f`, doubled letters collapsed). Evaluation only; the app never rewrites text.
* **Quantity accuracy** — every spoken quantity recoverable from the transcript by an
  evaluation-only number parser (Hindi/English number words, digits, `sau`, `darjan`, `aadha`, `dhai`).
* **Spurious quantity rate** — the transcript contains a number the speaker did not say.
  (Over-counts slightly: "Surf **ek** sale" for *Surf Excel* is counted, and it is a real hazard.)
* **Product accuracy** — strict (exact words) and roman-norm.
* **Command accuracy** — whole transcript equal to reference after roman-norm. This is a
  *transcription* metric; whether the app can *interpret* a command is a separate question
  for the inventory parser, which is not built yet.

## Results — sherpa-onnx 1.12.29 (version bundled in expo-sherpa-onnx), language `hi`, 2 threads

| Condition | WER raw | WER norm | Quantity acc | Spurious qty | Product strict | Product norm | Command acc |
|---|---|---|---|---|---|---|---|
| clean | 32.4 % | 26.0 % | 90.7 % | 7.8 % | 40.5 % | 54.8 % | 18.9 % |
| fast | 31.4 % | 25.4 % | 90.7 % | 4.4 % | 46.4 % | 58.3 % | 16.7 % |
| white 10 dB | 43.2 % | 37.7 % | 88.0 % | 8.9 % | 31.0 % | 42.9 % | 10.0 % |
| babble 5 dB | 63.1 % | 59.6 % | 60.0 % | 14.4 % | 17.9 % | 26.2 % | 2.2 % |
| **all 360** | **42.5 %** | **37.2 %** | **82.3 %** | **8.9 %** | **33.9 %** | **45.5 %** | **11.9 %** |

By language (all conditions): Hinglish WER-norm 35.2 %, Hindi 36.0 %, English 55.6 %
(English quantity accuracy only 45.8 % — "add ten packets" often became "At 10 package"/"Atten").

sherpa-onnx 1.13.8 gave the same picture (overall WER-norm 37.8 %, clean 25.8 %), confirming
the bundled runtime is not a limiting factor. Language `en` and auto-detect produced
**identical** results to `hi` on the clean set.

Full per-clip transcripts: `models/stt/eval/results/*.csv`.

### What goes wrong (clean speech, real examples)

| Reference | Transcript | Problem |
|---|---|---|
| maggi ke dus packet add karo | Meggi ke das packet add karo. | brand spelling ("Meggi" in most clips) |
| paanch kilo chawal restock karo | Paanch kilo chaaval list talk karo. | action word lost |
| pasta ka stock khatam ho gaya | Paanch tak ka stock khatm ho gaya. | **invented quantity 5** |
| ek kilo aata add karo | 8 kilo aata add karo. | **wrong quantity (1 → 8)** |
| barah ande bech diye | Baarah antibet di. | product lost |
| sell two kilos of rice | Said 2 kilo of fries | action + product wrong |
| surf excel ka stock kitna bacha hai | Surf ek sale ka stock … | brand split, adds "ek" |

### Latency and memory (desktop, not phone)

| Measure | 1.12.29 | 1.13.8 |
|---|---|---|
| Recognizer init (cold in process) | 0.98 s | 1.07 s |
| Decode 2 s utterance (median of 5) | 0.37 s | 0.36 s |
| Decode 5 s | 0.74 s | 0.82 s |
| Decode 10 s | 1.33 s | 2.03 s |
| Median real-time factor (all clips) | 0.18 | 0.19 |
| RSS after init | 236 MB | 238 MB |
| Peak RSS, single recognizer (clean-only runs) | — | 388–403 MB |
| 2 s digital silence | "uhh" | "Hai." (hallucination → silence gate added) |

A low-end phone (Cortex-A53/A55 class) will be several times slower than this desktop. **No
phone latency or RAM numbers are claimed.**

## Verdict

* The model works with the bundled runtime and is fast enough for push-to-talk on desktop.
* Quantities usually survive in quiet conditions (≈ 91 %), but **≈ 8 % of clean clips contain
  a number nobody said**, and noise makes everything markedly worse. Product names are the
  weakest part (strict ≈ 40 % clean).
* Therefore voice must stay an **assist**: show the transcript, let the inventory layer propose
  a match, and require the shopkeeper to confirm. Manual add and barcode scan remain the
  primary path. The current integration does exactly that (transcript displayed only).
* Downstream parsing should be fuzzy on product names (Meggi/Maggi), and should ask for
  confirmation of any quantity — never auto-commit.

## Reproduce

```bash
python -m venv .venv && .venv/Scripts/pip install sherpa-onnx==1.12.29 numpy soundfile psutil
# model files (verified against modelSpec.ts hashes) into models/.cache/hi-hinglish-swift/
# Piper voices: vits-piper-hi_IN-{rohan,priyamvada,pratham}-medium.tar.bz2 from
#   https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
python models/stt/eval/generate_synthetic_audio.py --tts-dir <voices> --out models/stt/eval/audio
python models/stt/eval/run_eval.py --model-dir models/.cache/hi-hinglish-swift \
  --audio models/stt/eval/audio --out models/stt/eval/results/desktop_sherpa-1.12.29_lang-hi.json --latency
```

## Real-speech protocol (still to do)

1. Record ≥ 5 speakers (mixed gender/age/region) × the 30 commands on 2+ low-end phones,
   inside a shop during business hours and in a quiet room. Use the app's own capture path
   (16 kHz WAV) so the audio matches production.
2. Write the reference *before* listening to model output; get consent; store no customer audio.
3. Run `/stt-bench` on the phone (STT_DEVICE_TESTING.md) and score the pulled `results.json`
   with the same metrics (`run_eval.py` scoring functions).
4. Ship voice beyond "assist" only if spurious-quantity rate is near zero after the
   confirmation step and product recall is acceptable to shopkeepers. If not, evaluate
   `hi-hinglish-apex` (Indic-Voices 47.6 % WER, but ~1 GB) or a constrained-vocabulary model.
