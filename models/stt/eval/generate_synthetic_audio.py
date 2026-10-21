"""Synthesise the kirana evaluation set with offline Hindi TTS voices.

The output is SYNTHETIC speech. It is useful as a reproducible smoke-test and
for comparing runtime settings, but it is NOT a substitute for recordings of
real shopkeepers (see models/docs/STT_EVALUATION.md, "Real-speech protocol").

Usage:
    python generate_synthetic_audio.py --tts-dir <dir with vits-piper-hi_IN-*> --out <dir>

Conditions produced per (command, voice):
    clean        16 kHz mono, TTS speed 1.0
    fast         TTS speed 1.25 (hurried speech)
    white_10db   clean + white noise at 10 dB SNR
    babble_5db   clean + three other utterances mixed underneath at 5 dB SNR
"""

import argparse
import json
import random
from pathlib import Path

import numpy as np
import sherpa_onnx
import soundfile as sf

TARGET_SR = 16000
VOICES = ["rohan", "priyamvada", "pratham"]
HERE = Path(__file__).resolve().parent


def load_tts(tts_dir: Path, voice: str) -> sherpa_onnx.OfflineTts:
    d = tts_dir / f"vits-piper-hi_IN-{voice}-medium"
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(d / f"hi_IN-{voice}-medium.onnx"),
                tokens=str(d / "tokens.txt"),
                data_dir=str(d / "espeak-ng-data"),
            ),
            num_threads=4,
        ),
    )
    return sherpa_onnx.OfflineTts(cfg)


def resample(x: np.ndarray, sr: int) -> np.ndarray:
    if sr == TARGET_SR:
        return x
    n = int(round(len(x) * TARGET_SR / sr))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def mix_at_snr(clean: np.ndarray, noise: np.ndarray, snr_db: float) -> np.ndarray:
    p_s = np.mean(clean**2) + 1e-12
    p_n = np.mean(noise**2) + 1e-12
    noise = noise * np.sqrt(p_s / (p_n * 10 ** (snr_db / 10)))
    out = clean + noise
    peak = np.max(np.abs(out))
    return (out / peak * 0.95 if peak > 0.99 else out).astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tts-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=1234)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    pyrng = random.Random(args.seed)
    commands = json.loads((HERE / "kirana_commands.json").read_text(encoding="utf-8"))["commands"]
    args.out.mkdir(parents=True, exist_ok=True)

    clean: dict[tuple[str, str], np.ndarray] = {}
    manifest = []
    for voice in VOICES:
        tts = load_tts(args.tts_dir, voice)
        for cmd in commands:
            for cond, speed in (("clean", 1.0), ("fast", 1.25)):
                audio = tts.generate(cmd["tts_text"], sid=0, speed=speed)
                x = resample(np.asarray(audio.samples, dtype=np.float32), audio.sample_rate)
                # 300 ms of leading/trailing silence, like a push-to-talk clip
                pad = np.zeros(int(0.3 * TARGET_SR), dtype=np.float32)
                x = np.concatenate([pad, x, pad])
                if cond == "clean":
                    clean[(cmd["id"], voice)] = x
                name = f"{cmd['id']}_{voice}_{cond}.wav"
                sf.write(args.out / name, x, TARGET_SR, subtype="PCM_16")
                manifest.append({"file": name, "id": cmd["id"], "voice": voice, "condition": cond,
                                 "duration_s": round(len(x) / TARGET_SR, 3)})

    keys = list(clean.keys())
    for (cid, voice), x in clean.items():
        white = rng.standard_normal(len(x)).astype(np.float32)
        y = mix_at_snr(x, white, 10)
        name = f"{cid}_{voice}_white_10db.wav"
        sf.write(args.out / name, y, TARGET_SR, subtype="PCM_16")
        manifest.append({"file": name, "id": cid, "voice": voice, "condition": "white_10db",
                         "duration_s": round(len(y) / TARGET_SR, 3)})

        others = [k for k in keys if k[0] != cid]
        babble = np.zeros_like(x)
        for k in pyrng.sample(others, 3):
            o = clean[k]
            o = np.tile(o, int(np.ceil(len(x) / len(o))))[: len(x)]
            babble += o
        y = mix_at_snr(x, babble, 5)
        name = f"{cid}_{voice}_babble_5db.wav"
        sf.write(args.out / name, y, TARGET_SR, subtype="PCM_16")
        manifest.append({"file": name, "id": cid, "voice": voice, "condition": "babble_5db",
                         "duration_s": round(len(y) / TARGET_SR, 3)})

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"wrote {len(manifest)} clips to {args.out}")


if __name__ == "__main__":
    main()
