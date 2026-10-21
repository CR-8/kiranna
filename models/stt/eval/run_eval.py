"""Desktop evaluation of the hi-hinglish-swift model with the sherpa-onnx runtime.

Measures, per clip and aggregated:
  * WER (raw)            lowercase, punctuation stripped, nothing else
  * WER (roman-norm)     both sides passed through `roman_norm` (spelling-variant
                         folding: ee->i, oo->u, doubled letters collapsed, w->v).
                         EVALUATION ONLY - the app never rewrites transcripts.
  * quantity accuracy    every reference quantity is recoverable from the
                         hypothesis by the evaluation-only number parser
  * spurious quantity    hypothesis contains a number the speaker did not say
  * product accuracy     strict (exact words) and roman-norm
  * command accuracy     roman-norm hypothesis == roman-norm reference
  * decode latency / real-time factor, peak process RSS

Usage:
    python run_eval.py --model-dir <hi-hinglish-swift> --audio <dir from generate_synthetic_audio.py> \
        --out results/desktop_sherpa-<ver>.json [--language hi] [--threads 2]
"""

import argparse
import csv
import json
import re
import threading
import time
from pathlib import Path

import numpy as np
import psutil
import sherpa_onnx
import soundfile as sf

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------- normalisers


def words(text: str) -> list[str]:
    text = text.lower()
    text = re.sub(r"[^\w\s.]", " ", text)  # keep '.' for decimals like 2.5
    text = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", text)
    return text.split()


def roman_norm_word(w: str) -> str:
    w = w.replace("ee", "i").replace("oo", "u").replace("w", "v").replace("ph", "f")
    w = re.sub(r"([a-z])\1+", r"\1", w)
    return w


def roman_norm(text: str) -> list[str]:
    return [roman_norm_word(w) for w in words(text)]


def wer(ref: list[str], hyp: list[str]) -> tuple[int, int]:
    d = np.zeros((len(ref) + 1, len(hyp) + 1), dtype=np.int32)
    d[:, 0] = np.arange(len(ref) + 1)
    d[0, :] = np.arange(len(hyp) + 1)
    for i in range(1, len(ref) + 1):
        for j in range(1, len(hyp) + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    return int(d[len(ref), len(hyp)]), len(ref)


# Evaluation-only number parser. Keys are roman_norm()-ed forms.
NUM = {
    "ek": 1, "one": 1, "do": 2, "two": 2, "to": 2, "tu": 2, "tin": 3, "three": 3, "char": 4, "four": 4,
    "for": 4, "panch": 5, "pach": 5, "five": 5, "che": 6, "chhe": 6, "chhah": 6, "chah": 6, "chhey": 6,
    "six": 6, "sat": 7, "seven": 7, "ath": 8, "eight": 8, "nau": 9, "nine": 9, "das": 10, "dus": 10,
    "ten": 10, "barah": 12, "bara": 12, "twelve": 12, "bis": 20, "twenty": 20, "pachis": 25, "pachchis": 25,
    "pacchis": 25, "adha": 0.5, "aadha": 0.5, "half": 0.5, "dhai": 2.5, "dhaai": 2.5,
}
HUNDRED = {"sau", "so", "hundred"}
DOZEN = {"darjan", "dozen", "darjen"}


def quantities(text: str) -> list[float]:
    toks = roman_norm(text)
    out: list[float] = []
    i = 0
    while i < len(toks):
        t = toks[i]
        val = None
        if re.fullmatch(r"\d+(\.\d+)?", t):
            val = float(t)
        elif t in NUM:
            val = float(NUM[t])
        elif t in DOZEN:
            out.append(12.0)
            i += 1
            continue
        if val is not None:
            nxt = toks[i + 1] if i + 1 < len(toks) else ""
            if nxt in HUNDRED:
                val *= 100
                i += 1
            elif nxt in DOZEN:
                val *= 12
                i += 1
            out.append(val)
        i += 1
    return out


def contains(hay: list[str], needle: list[str]) -> bool:
    n = len(needle)
    return any(hay[i : i + n] == needle for i in range(len(hay) - n + 1)) if n else True


# ---------------------------------------------------------------- runtime


class PeakRss:
    def __init__(self) -> None:
        self.proc = psutil.Process()
        self.peak = self.proc.memory_info().rss
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            self.peak = max(self.peak, self.proc.memory_info().rss)
            time.sleep(0.01)

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        self._t.join()


def make_recognizer(model_dir: Path, language: str, threads: int) -> sherpa_onnx.OfflineRecognizer:
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=str(model_dir / "encoder.int8.onnx"),
        decoder=str(model_dir / "decoder.int8.onnx"),
        tokens=str(model_dir / "tokens.txt"),
        num_threads=threads,
        decoding_method="greedy_search",
        language=language,
        task="transcribe",
    )


def decode(rec, samples: np.ndarray, sr: int) -> tuple[str, float]:
    t0 = time.perf_counter()
    s = rec.create_stream()
    s.accept_waveform(sr, samples)
    rec.decode_stream(s)
    return s.result.text.strip(), time.perf_counter() - t0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, required=True)
    ap.add_argument("--audio", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--language", default="hi")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--conditions", default="clean,fast,white_10db,babble_5db")
    ap.add_argument("--latency", action="store_true", help="also time 2/5/10 s utterances and 48 kHz input")
    args = ap.parse_args()

    commands = {c["id"]: c for c in json.loads((HERE / "kirana_commands.json").read_text(encoding="utf-8"))["commands"]}
    manifest = json.loads((args.audio / "manifest.json").read_text(encoding="utf-8"))
    conds = args.conditions.split(",")
    manifest = [m for m in manifest if m["condition"] in conds]

    rss0 = psutil.Process().memory_info().rss
    with PeakRss() as mem:
        t0 = time.perf_counter()
        rec = make_recognizer(args.model_dir, args.language, args.threads)
        init_s = time.perf_counter() - t0
        rss_after_init = psutil.Process().memory_info().rss

        rows = []
        for m in manifest:
            x, sr = sf.read(args.audio / m["file"], dtype="float32")
            hyp, dt = decode(rec, x, sr)
            c = commands[m["id"]]
            ref = c["reference"]
            e_raw, n = wer(words(ref), words(hyp))
            e_norm, _ = wer(roman_norm(ref), roman_norm(hyp))
            ref_q = sorted(float(q) for q in c["quantities"])
            hyp_q = quantities(hyp)
            q_ok = all(hyp_q.count(q) >= ref_q.count(q) for q in set(ref_q))
            # a number in the transcript that the speaker never said (dangerous downstream)
            q_spurious = any(hyp_q.count(q) > ref_q.count(q) for q in set(hyp_q))
            p_strict = all(contains(words(hyp), words(p)) for p in c["products"])
            p_norm = all(contains(roman_norm(hyp), roman_norm(p)) for p in c["products"])
            rows.append({
                **m, "language": c["language"], "reference": ref, "hypothesis": hyp,
                "err_raw": e_raw, "err_norm": e_norm, "ref_words": n,
                "has_quantity": bool(ref_q), "quantity_ok": q_ok, "quantity_spurious": q_spurious,
                "has_product": bool(c["products"]), "product_strict_ok": p_strict, "product_norm_ok": p_norm,
                "command_ok": roman_norm(hyp) == roman_norm(ref),
                "devanagari_in_output": bool(re.search(r"[ऀ-ॿ]", hyp)),
                "decode_s": round(dt, 4), "rtf": round(dt / m["duration_s"], 4),
            })

        latency = {}
        if args.latency:
            clean = [r for r in manifest if r["condition"] == "clean" and r["voice"] == "rohan"]
            pool = [sf.read(args.audio / r["file"], dtype="float32")[0] for r in clean]
            for target in (2, 5, 10):
                buf = np.zeros(0, dtype=np.float32)
                k = 0
                while len(buf) < target * 16000:
                    buf = np.concatenate([buf, pool[k % len(pool)]])
                    k += 1
                buf = buf[: target * 16000]
                decode(rec, buf, 16000)  # warm
                times = [decode(rec, buf, 16000)[1] for _ in range(5)]
                latency[f"{target}s"] = {"median_s": round(float(np.median(times)), 3),
                                         "max_s": round(float(np.max(times)), 3)}
            # 48 kHz input: the runtime resamples internally; check it yields the same text.
            x16 = pool[0]
            x48 = np.interp(np.linspace(0, len(x16) - 1, len(x16) * 3), np.arange(len(x16)), x16).astype(np.float32)
            latency["resample_check"] = {"text_16k": decode(rec, x16, 16000)[0], "text_48k": decode(rec, x48, 48000)[0]}
            silence = np.zeros(16000 * 2, dtype=np.float32)
            latency["silence_2s_text"] = decode(rec, silence, 16000)[0]
            t0 = time.perf_counter()
            rec2 = make_recognizer(args.model_dir, args.language, args.threads)
            latency["warm_reinit_s"] = round(time.perf_counter() - t0, 3)
            del rec2

    def agg(rs):
        if not rs:
            return {}
        n = sum(r["ref_words"] for r in rs)
        q = [r for r in rs if r["has_quantity"]]
        p = [r for r in rs if r["has_product"]]
        return {
            "clips": len(rs),
            "wer_raw": round(sum(r["err_raw"] for r in rs) / n, 4),
            "wer_roman_norm": round(sum(r["err_norm"] for r in rs) / n, 4),
            "quantity_acc": round(sum(r["quantity_ok"] for r in q) / len(q), 4) if q else None,
            "spurious_quantity_rate": round(sum(r["quantity_spurious"] for r in rs) / len(rs), 4),
            "product_acc_strict": round(sum(r["product_strict_ok"] for r in p) / len(p), 4) if p else None,
            "product_acc_norm": round(sum(r["product_norm_ok"] for r in p) / len(p), 4) if p else None,
            "command_acc": round(sum(r["command_ok"] for r in rs) / len(rs), 4),
            "devanagari_outputs": sum(r["devanagari_in_output"] for r in rs),
            "decode_median_s": round(float(np.median([r["decode_s"] for r in rs])), 3),
            "rtf_median": round(float(np.median([r["rtf"] for r in rs])), 3),
        }

    summary = {
        "runtime": f"sherpa-onnx {sherpa_onnx.__version__} (python, desktop CPU)",
        "language": args.language, "threads": args.threads,
        "init_s": round(init_s, 3),
        "rss_mb": {"before_init": round(rss0 / 2**20, 1), "after_init": round(rss_after_init / 2**20, 1),
                   "peak": round(mem.peak / 2**20, 1)},
        "overall": agg(rows),
        "by_condition": {c: agg([r for r in rows if r["condition"] == c]) for c in conds},
        "by_language": {l: agg([r for r in rows if r["language"] == l]) for l in ("hinglish", "hindi", "english")},
        "by_voice": {v: agg([r for r in rows if r["voice"] == v]) for v in sorted({r["voice"] for r in rows})},
        "latency": latency,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    with open(args.out.with_suffix(".csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(json.dumps({k: summary[k] for k in ("runtime", "language", "init_s", "rss_mb", "overall", "latency")}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
