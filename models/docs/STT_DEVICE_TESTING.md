# STT device testing

**Status: not yet executed.** A local Gradle build was started and deliberately stopped (the
team builds with Expo/EAS), and the emulator did not stay online. Nothing in this file has been
measured on a phone yet; fill in the tables below when it has.

## 1. Development build (once, or after native dependency changes)

Expo Go cannot load `expo-sherpa-onnx`. Use an EAS development build:

```bash
npx eas-cli@latest build --profile development --platform android
```

If `eas.json` does not exist yet, `npx eas-cli@latest build:configure` creates it (keep the
`development` profile with `"developmentClient": true`; add `expo-dev-client` via
`npx expo install expo-dev-client` if the CLI asks). Install the APK, then:

```bash
npx expo start
```

Local alternative (needs Android SDK + JDK 17+): `npx expo run:android`.

Prebuilt sherpa-onnx libraries ship for `arm64-v8a`, `armeabi-v7a`, `x86_64` (no 32-bit x86).
Uncompressed `.so` sizes in the package: sherpa-onnx JNI 21 MB (arm64) / 15 MB (armv7) /
24 MB (x86_64), plus libarchive 8.2 / 6.4 / 8.3 MB. **Actual APK/AAB growth is unmeasured** —
record it by comparing `eas build` artifact sizes before/after this branch, and consider
`sherpaOnnxDisableLibarchive=true` in `gradle.properties` (via a config plugin) since archive
extraction is unused.

## 2. Functional checklist

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Fresh install → New bill | mic shows VOICE UNAVAILABLE; tapping explains model download | |
| 2 | Settings → Voice model → Download (153 MB) on Wi-Fi | progress %, then CHECKING FILES, then DOWNLOADED | |
| 3 | Kill app mid-download, reopen, retry | finished files kept, partial one restarted, ends verified | |
| 4 | Deny mic permission | "Microphone is not allowed…"; ADD ITEM / SCAN still work | |
| 5 | Allow, say "Maggi ke dus packet add karo", tap again | LISTENING → PROCESSING → transcript in "What I heard"; bill unchanged | |
| 6 | Tap, stay silent, tap | "No speech heard" (silence gate), no hallucinated text | |
| 7 | Cancel while listening / while processing | Cancelled; no transcript | |
| 8 | 20 transcriptions in a row | no crash, latency stable, RSS stable (see §4) | |
| 9 | Record, press Home, return | capture cancelled, recognizer released, next attempt re-loads | |
| 10 | **Airplane mode**, force-stop app, reopen, transcribe | works identically (offline acceptance test) | |
| 11 | Settings → Remove voice model | back to step 1 state; bills/products untouched | |

## 3. On-device benchmark (`/stt-bench`, dev builds only)

```bash
# 1. generate clips on a PC (see STT_EVALUATION.md) or record real ones (16 kHz mono 16-bit WAV)
adb push models/stt/eval/audio/. /data/local/tmp/stt-bench/
adb shell run-as com.anonymous.kiranapos mkdir -p files/stt-bench
adb shell "run-as com.anonymous.kiranapos sh -c 'cp /data/local/tmp/stt-bench/*.wav files/stt-bench/'"
# 2. open kiranapos://stt-bench in the dev build, tap RUN (1 PASS) or RUN (5 PASSES)
adb shell am start -a android.intent.action.VIEW -d "kiranapos://stt-bench"
# 3. pull results
adb shell run-as com.anonymous.kiranapos cat files/stt-bench/results.json > results-device.json
```

Memory/CPU while it runs:

```bash
adb shell dumpsys meminfo com.anonymous.kiranapos | grep -E "TOTAL PSS|Native Heap"
adb shell top -b -n 1 | grep kiranapos
adb shell dumpsys battery ; adb shell dumpsys thermalservice | grep -i status
```

## 4. Results (to fill in)

Device: _model, SoC, RAM, Android version_

| Measure | Value |
|---|---|
| Download size / on-disk model | 160.7 MB / 160.7 MB (+ install.json) |
| APK/AAB size delta | |
| Cold init (`coldInitMs`) | |
| Re-init (`warmInitMs`) | |
| Latency 2 s / 5 s / 10 s utterance | |
| Total PSS idle → after init → peak during decode | |
| PSS after 5-pass soak | |
| CPU % during decode | |
| Battery / thermal after 50 decodes | |
| After cancel | |
| After background → foreground | |
| Airplane-mode transcription | pass / fail |

Do not claim offline inference has passed until row 10 / "Airplane-mode" is filled from a real run.
