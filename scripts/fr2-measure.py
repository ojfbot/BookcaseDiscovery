"""F-R2 measurement (evals/FR2/report.md): crop pixel sizes, text-line heights (PP-OCRv5 server detector only, on
the CPU, seeded sample), contrast, against reader outcomes, on the cached default boxes of pilot-000 (F-0e
`bands+strips`, F-0c's base decisions) and the yardstick (F-0's B2 run). Per-box rows go to
the data root's private/fr2/; stderr carries progress and counts only, never text. Run with helpers/label's venv:

    node scripts/fr2-truth.ts <data root>/private/fr2/yardstick-truth.json
    python -I scripts/fr2-measure.py boxes   # geometry + contrast + outcomes, every box (no model)
    python -I scripts/fr2-measure.py lines   # text-line detection on a seeded sample (CPU)
    python -I scripts/fr2-aggregate.py > evals/FR2/metrics.json
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
from pathlib import Path

import cv2
import numpy as np

D = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
OUT = D / "private" / "fr2"
MAX_SIDE = 1600  # read.py: PP-OCR and Qwen crops are capped at this long side; Vision reads full resolution
SETS = {
    "pilot-000": dict(dir=D / "f0e/pilot-000/bands+strips", decisions=D / "f0c/pilot-000/base-decisions.jsonl",
                      images=D / "private/f0f/images-pilot-000.jsonl"),
    "yardstick": dict(dir=D / "f0/yardstick-library-b2", decisions=D / "f0/yardstick-library-b2/decisions.jsonl",
                      images=D / "private/f0f/images-yardstick.jsonl"),
}
SAMPLE = {"pilot-000": 700, "yardstick": 350}
SEED = 20261103


def jl(p: Path):
    with open(p) as f:
        return [json.loads(l) for l in f if l.strip()]


def order_corners(pts: np.ndarray) -> np.ndarray:  # as read.py
    c = pts.mean(axis=0)
    cw = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    return np.roll(cw, -int(np.argmin(cw[:, 0] + cw[:, 1])), axis=0)


def clip_poly(poly, w, h):
    """Approximation of crop.ts clipToFrame for sizing: clamp corners into the frame."""
    p = np.array(poly, dtype=np.float32)
    p[:, 0] = p[:, 0].clip(0, w - 1)
    p[:, 1] = p[:, 1].clip(0, h - 1)
    return p


def warp(img, p, rotation=90, cap=MAX_SIDE, short_px=None):
    p = order_corners(p)
    w = int(round(max(np.linalg.norm(p[1] - p[0]), np.linalg.norm(p[2] - p[3]))))
    h = int(round(max(np.linalg.norm(p[3] - p[0]), np.linalg.norm(p[2] - p[1]))))
    w, h = max(w, 2), max(h, 2)
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    out = cv2.warpPerspective(img, cv2.getPerspectiveTransform(p, dst), (w, h), flags=cv2.INTER_CUBIC)
    s = 1.0
    if short_px:
        s = short_px / min(w, h)
    elif cap and max(w, h) > cap:
        s = cap / max(w, h)
    if s != 1.0:
        out = cv2.resize(out, (max(2, int(w * s)), max(2, int(h * s))), interpolation=cv2.INTER_AREA)
    rot = {0: None, 90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rotation]
    return (out if rot is None else cv2.rotate(out, rot)), s, w, h


def contrast(crop):
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
    p5, p95 = np.percentile(g, [5, 95])
    # Lettering contrast: Otsu split, distance between the two class means (0-255).
    _, th = cv2.threshold(g.astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    a, b = g[th > 0], g[th == 0]
    sep = float(abs(a.mean() - b.mean())) if a.size and b.size else 0.0
    return float(p95 - p5), float(g.std()), sep


def load(set_name):
    s = SETS[set_name]
    dets = jl(s["dir"] / "detect.jsonl")
    images = {r["id"]: r["image"] for r in jl(s["images"])}
    decisions = {r["id"]: r for r in jl(s["decisions"])}
    readers = {}
    for name in ("vision", "ppocr", "qwen"):
        p = s["dir"] / f"{name}.jsonl"
        if p.exists():
            readers[name] = {r["id"]: r for r in jl(p)}
    truth = None
    if set_name == "yardstick":
        truth = {k: set(v) for k, v in json.load(open(OUT / "yardstick-truth.json")).items()}
    return dets, images, decisions, readers, truth


def accepted_id(d):
    a = d.get("accepted")
    if a is None:
        return None
    return a if isinstance(a, str) else a.get("workId")


def boxes(set_name):
    dets, images, decisions, readers, truth = load(set_name)
    out = open(OUT / f"{set_name}-boxes.jsonl", "w")
    n = 0
    for det in dets:
        img = cv2.imread(images[det["id"]], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        H, W = img.shape[:2]
        for i, sp in enumerate(det["spines"]):
            bid = f"{det['id']}:{i}"
            d = decisions.get(bid)
            if d is None:
                continue
            p = clip_poly(sp["polygon"], W, H)
            small, _, w, h = warp(img, p, rotation=90, short_px=64)
            rng, std, sep = contrast(small)
            short, long_ = min(w, h), max(w, h)
            scale = min(1.0, MAX_SIDE / long_)
            acc = accepted_id(d)
            row = {
                "id": bid, "image": det["id"], "short": short, "long": long_, "scale": round(scale, 4),
                "upright": bool(w <= h), "cut": bool(sp.get("cut")), "photoW": W, "photoH": H,
                "range": round(rng, 1), "std": round(std, 1), "sep": round(sep, 1),
                "readText": d.get("readText", {}), "pass": {k: v is not None for k, v in d.get("confirmed", {}).items()},
                "qwenRead": bid in readers.get("qwen", {}), "accepted": acc is not None, "reason": d.get("reason"),
                "agreeing": len(d.get("agreeing", [])) if isinstance(d.get("agreeing"), list) else None,
            }
            if truth is not None:
                gt = truth.get(det["id"], set())
                row["confirmed"] = acc is not None and acc in gt
                row["wrong"] = acc is not None and acc not in gt
            else:
                row["confirmed"] = acc is not None
            # Agreement with the pass set: which readers passed and named the accepted work
            if acc is not None:
                row["agree"] = sorted(k for k, v in d.get("confirmed", {}).items() if v == acc)
            out.write(json.dumps(row) + "\n")
            n += 1
        print(f"{set_name}: {n} boxes", file=sys.stderr, flush=True)
    out.close()


def lines(set_name):
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import TextDetection

    model = TextDetection(model_name="PP-OCRv5_server_det", model_dir=str(D / "models/pp-ocrv5/server_det"), device="cpu")
    rows = jl(OUT / f"{set_name}-boxes.jsonl")
    pool = sorted(r["id"] for r in rows if r["short"] >= 6)
    random.Random(SEED).shuffle(pool)
    pick = set(pool[: SAMPLE[set_name]])
    dets, images, *_ = load(set_name)
    out = open(OUT / f"{set_name}-lines.jsonl", "w")
    n, t0 = 0, time.time()
    for det in dets:
        ids = [f"{det['id']}:{i}" for i in range(len(det["spines"])) if f"{det['id']}:{i}" in pick]
        if not ids:
            continue
        img = cv2.imread(images[det["id"]], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        H, W = img.shape[:2]
        for bid in ids:
            i = int(bid.rsplit(":", 1)[1])
            p = clip_poly(det["spines"][i]["polygon"], W, H)
            crop, s, w, h = warp(img, p, rotation=90)  # exactly what PP-OCR and Qwen see at 90 deg
            t = time.time()
            res = list(model.predict(crop))
            polys = res[0]["dt_polys"] if res else []
            ls = []
            for q in polys:
                (cx, cy), (rw, rh), ang = cv2.minAreaRect(np.asarray(q, dtype=np.float32))
                # Reading frame: a line runs along x. Height = extent across the line's direction.
                xs, ys = np.asarray(q)[:, 0], np.asarray(q)[:, 1]
                ext_x, ext_y = float(xs.max() - xs.min()), float(ys.max() - ys.min())
                thick, length = min(rw, rh), max(rw, rh)
                cross = ext_y > 1.5 * ext_x  # a column: stacked letters, or text set across the spine
                ls.append({"thick": round(thick, 1), "length": round(length, 1), "cross": bool(cross)})
            out.write(json.dumps({"id": bid, "scale": round(s, 4), "cropW": crop.shape[1], "cropH": crop.shape[0],
                                  "lines": ls, "seconds": round(time.time() - t, 3)}) + "\n")
            n += 1
            if n % 50 == 0:
                print(f"{set_name}: {n} crops, {time.time() - t0:.0f} s", file=sys.stderr, flush=True)
    out.close()


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    step = sys.argv[1]
    for s in (sys.argv[2:] or list(SETS)):
        (boxes if step == "boxes" else lines)(s)
