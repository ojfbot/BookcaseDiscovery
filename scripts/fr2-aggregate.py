"""Aggregate F-R2's private per-box rows (scripts/fr2-measure.py) into shares by bin, aggregates only, as
evals/FR2/metrics.json on stdout. Intervals are 95 % photo-cluster bootstraps of the pooled share, in %."""
from __future__ import annotations

import json
import os
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

D = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
OUT = D / "private" / "fr2"
DRAWS, SEED = 2000, 1
EFF_BINS = [0, 16, 24, 32, 48, 64, 96, 1e9]       # short side px reaching PP-OCR / Qwen (after the 1600 cap)
RAW_BINS = [0, 24, 32, 48, 64, 96, 128, 192, 1e9]  # short side px reaching Vision (full resolution)
LINE_BINS = [0, 8, 12, 16, 24, 32, 48, 1e9]       # tallest detected text line, px as PP-OCR's recogniser receives it
SEP_BINS = [0, 30, 45, 60, 80, 1e9]                # Otsu class-mean separation, 0-255


def jl(p):
    return [json.loads(l) for l in open(p) if l.strip()]


def label(lo, hi):
    return f"<{hi:g}" if lo == 0 else (f">={lo:g}" if hi >= 1e9 else f"{lo:g}-{hi:g}")


def binof(v, bins):
    for lo, hi in zip(bins, bins[1:]):
        if lo <= v < hi:
            return label(lo, hi)
    return None


def share_ci(rows, key):
    """Pooled share with a photo-cluster bootstrap 95 % interval, in %."""
    by = defaultdict(list)
    for r in rows:
        by[r["image"]].append(1.0 if key(r) else 0.0)
    imgs = sorted(by)
    if not rows:
        return None
    sums = np.array([sum(by[i]) for i in imgs]); ns = np.array([len(by[i]) for i in imgs])
    pt = sums.sum() / ns.sum()
    rng = np.random.default_rng(SEED)
    idx = rng.integers(0, len(imgs), size=(DRAWS, len(imgs)))
    bs = sums[idx].sum(1) / np.maximum(ns[idx].sum(1), 1)
    lo, hi = np.percentile(bs, [2.5, 97.5])
    return [round(100 * pt, 1), round(100 * lo, 1), round(100 * hi, 1)]


MEASURES = {
    "anyText": lambda r: any(r["readText"].values()),
    "visionText": lambda r: r["readText"].get("vision", False),
    "ppocrText": lambda r: r["readText"].get("ppocr", False),
    "visionPass": lambda r: r["pass"].get("vision", False),
    "ppocrPass": lambda r: r["pass"].get("ppocr", False),
    "confirmed": lambda r: r["confirmed"],
}


def table(rows, keyfn, bins_order, extra=None):
    groups = defaultdict(list)
    for r in rows:
        b = keyfn(r)
        if b is not None:
            groups[b].append(r)
    out = []
    for b in bins_order:
        g = groups.get(b, [])
        if not g:
            continue
        row = {"bin": b, "boxCount": len(g), "photos": len({r["image"] for r in g})}
        for k, f in {**MEASURES, **(extra or {})}.items():
            row[k] = share_ci(g, f)
        out.append(row)
    return out


def order(bins):
    return [label(lo, hi) for lo, hi in zip(bins, bins[1:])]


def main():
    metrics = {
        "card": "F-R2", "date": "2026-11-03",
        "scope": {"pilot-000": "real use (OC35): machine agreement, never accuracy (INV-17)",
                  "yardstick": "PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated"},
        "constants": {"maxSide": 1600, "effBins": EFF_BINS[:-1], "rawBins": RAW_BINS[:-1], "lineBins": LINE_BINS[:-1],
                      "sepBins": SEP_BINS[:-1], "bootstrapDraws": DRAWS, "seed": SEED,
                      "lineDetector": "PP-OCRv5_server_det, CPU, crop as read.py cuts it at 90 deg",
                      "lineHeight": "short side of the detector's line box after DB unclip (an upper bound on glyph height)"},
    }
    for s in ("pilot-000", "yardstick"):
        rows = [r for r in jl(OUT / f"{s}-boxes.jsonl")]
        for r in rows:
            r["eff"] = r["short"] * r["scale"]
        extra = {"wrong": (lambda r: r.get("wrong", False))} if s == "yardstick" else {}
        qrows = [r for r in rows if r["qwenRead"]]
        m = {
            "boxCount": len(rows), "photos": len({r["image"] for r in rows}),
            "shortPx": {q: float(np.percentile([r["short"] for r in rows], q)) for q in (10, 25, 50, 75, 90)},
            "longPx": {q: float(np.percentile([r["long"] for r in rows], q)) for q in (10, 25, 50, 75, 90)},
            "effShortPx": {q: round(float(np.percentile([r["eff"] for r in rows], q)), 1) for q in (10, 25, 50, 75, 90)},
            "downscaledShare": round(100 * np.mean([r["scale"] < 1 for r in rows]), 1),
            "medianScaleWhenDownscaled": round(float(np.median([r["scale"] for r in rows if r["scale"] < 1] or [1])), 3),
            "byEffShort": table(rows, lambda r: binof(r["eff"], EFF_BINS), order(EFF_BINS), extra),
            "byShort": table(rows, lambda r: binof(r["short"], RAW_BINS), order(RAW_BINS), extra),
            "bySep": table(rows, lambda r: binof(r["sep"], SEP_BINS), order(SEP_BINS), extra),
            "qwenByEffShort": table(qrows, lambda r: binof(r["eff"], EFF_BINS), order(EFF_BINS),
                                    {"qwenText": lambda r: r["readText"].get("qwen", False),
                                     "qwenPass": lambda r: r["pass"].get("qwen", False)}),
        }
        # Pools: where unknown boxes sit in size and contrast
        pools = defaultdict(list)
        for r in rows:
            pools["confirmed" if r["confirmed"] else ("wrong" if r.get("wrong") else (r["reason"] or "other"))].append(r)
        m["pools"] = {k: {"boxCount": len(v),
                          "effShortP50": round(float(np.median([r["eff"] for r in v])), 1),
                          "shortP50": round(float(np.median([r["short"] for r in v])), 1),
                          "sepP50": round(float(np.median([r["sep"] for r in v])), 1),
                          "effUnder24": round(100 * np.mean([r["eff"] < 24 for r in v]), 1),
                          "sepUnder45": round(100 * np.mean([r["sep"] < 45 for r in v]), 1),
                          "cut": round(100 * np.mean([r["cut"] for r in v]), 1)}
                      for k, v in sorted(pools.items())}
        # Stylised-type proxy on spines: Qwen passes the bar, neither OCR reader does (hard crops Qwen read)
        m["qwenOnly"] = {"qwenRead": len(qrows),
                         "qwenPass": sum(r["pass"].get("qwen", False) for r in qrows),
                         "qwenPassNoOcrPass": sum(r["pass"].get("qwen", False) and not r["pass"].get("vision", False)
                                                  and not r["pass"].get("ppocr", False) for r in qrows)}
        lp = OUT / f"{s}-lines.jsonl"
        if lp.exists():
            m["lines"] = lines_summary(rows, jl(lp), extra)
        metrics[s] = m
    json.dump(metrics, sys.stdout, indent=1)


def lines_summary(rows, lines, extra):
    by = {r["id"]: r for r in rows}
    joined = []
    for l in lines:
        r = by.get(l["id"])
        if r is None:
            continue
        th = [x["thick"] for x in l["lines"]]
        r = dict(r)
        r["nLines"] = len(th)
        r["tallest"] = max(th) if th else 0.0           # px in the crop PP-OCR / Qwen receive
        r["tallestWorking"] = (max(th) / l["scale"]) if th else 0.0
        r["crossShare"] = (sum(x["cross"] for x in l["lines"]) / len(th)) if th else 0.0
        r["anyCross"] = any(x["cross"] for x in l["lines"])
        r["detSeconds"] = l["seconds"]
        joined.append(r)
    withl = [r for r in joined if r["nLines"]]
    th = np.array([x["thick"] for l in lines for x in l["lines"]])
    srt = [sorted(x["thick"] for x in l["lines"]) for l in lines if l["lines"]]
    second = np.array([t[-2] for t in srt if len(t) >= 2])
    res = {
        "allLines": {"lines": int(th.size),
                     "px": {q: round(float(np.percentile(th, q)), 1) for q in (10, 25, 50, 75)},
                     "under16": round(100 * float((th < 16).mean()), 1),
                     "under24": round(100 * float((th < 24).mean()), 1),
                     "under32": round(100 * float((th < 32).mean()), 1),
                     "secondTallestP50": float(np.median(second)),
                     "secondTallestUnder32": round(100 * float((second < 32).mean()), 1),
                     "tallestOverSecondP50": round(float(np.median([t[-1] / max(1, t[-2]) for t in srt if len(t) >= 2])), 2),
                     "cropsSmallestUnder24": round(100 * float(np.mean([t[0] < 24 for t in srt])), 1)},
        "sampled": len(joined),
        "withLines": len(withl),
        "noLinesShare": round(100 * (1 - len(withl) / max(len(joined), 1)), 1),
        "tallestPx": {q: round(float(np.percentile([r["tallest"] for r in withl], q)), 1) for q in (10, 25, 50, 75, 90)} if withl else {},
        "tallestOverShort": {q: round(float(np.percentile([r["tallest"] / max(r["eff"], 1) for r in withl], q)), 2) for q in (25, 50, 75)} if withl else {},
        "linesPerBoxP50": float(np.median([r["nLines"] for r in withl])) if withl else 0,
        "anyCrossShare": share_ci(withl, lambda r: r["anyCross"]),
        "detSecondsP50": round(float(np.median([r["detSeconds"] for r in joined])), 3),
        "byTallest": table(joined, lambda r: binof(r["tallest"], LINE_BINS) if r["nLines"] else "no lines",
                           ["no lines"] + order(LINE_BINS), extra),
        "byCross": table(withl, lambda r: "has column text" if r["anyCross"] else "lines along the spine",
                         ["lines along the spine", "has column text"], extra),
    }
    return res


if __name__ == "__main__":
    main()
