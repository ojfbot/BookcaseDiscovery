"""Q-1 private overlay renders: a first look at a coverage overlay on real photos.

For each photo, three JPEGs (long edge 2000 px) plus an index.html, all written to --out, which must be a
private folder under the data root (never the repo):

- ``-outcome``: every detected spine filled by its F-0 outcome;
- ``-readability``: every spine filled by the Q-1 descriptive model's P(confirmed rather than no text), red to green;
- ``-grid``: a coarse grid, each cell filled by the mean modelled readability of the spines centred in it,
  hatched grey where nothing was detected.

    python -I render.py --detect detect.jsonl --images images.jsonl --scores scores.jsonl --out DIR --label SET
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys

import cv2
import numpy as np

LONG_EDGE = 2000
# BGR
COLOURS = {
    "confirmed": (80, 200, 60),
    "unknown:no-text": (60, 60, 230),
    "unknown:no-catalog-match": (0, 190, 255),
    "unknown:single-reader": (230, 160, 40),
    "unknown:readers-disagree": (200, 60, 200),
    "rejected/wrong": (20, 20, 20),
}


def ramp(p: float) -> tuple[int, int, int]:
    """Red (0) through yellow to green (1), BGR."""
    p = min(1.0, max(0.0, p))
    return (0, int(255 * min(1, 2 * p)), int(255 * min(1, 2 * (1 - p))))


def fill(base: np.ndarray, polys: list[np.ndarray], colours: list[tuple[int, int, int]], alpha: float = 0.45) -> np.ndarray:
    layer = base.copy()
    for p, c in zip(polys, colours):
        cv2.fillPoly(layer, [p], c)
    out = cv2.addWeighted(layer, alpha, base, 1 - alpha, 0)
    for p, c in zip(polys, colours):
        cv2.polylines(out, [p], True, c, 2)
    return out


def grid(base: np.ndarray, centres: list[tuple[float, float]], scores: list[float | None]) -> np.ndarray:
    h, w = base.shape[:2]
    cols, rows = (8, 6) if w >= h else (6, 8)
    acc = np.zeros((rows, cols)), np.zeros((rows, cols))
    for (x, y), p in zip(centres, scores):
        if p is None:
            continue
        c, r = min(cols - 1, int(x * cols)), min(rows - 1, int(y * rows))
        acc[0][r, c] += p
        acc[1][r, c] += 1
    layer = base.copy()
    for r in range(rows):
        for c in range(cols):
            x0, x1 = int(c * w / cols), int((c + 1) * w / cols)
            y0, y1 = int(r * h / rows), int((r + 1) * h / rows)
            if acc[1][r, c] == 0:
                for k in range(x0 - (y1 - y0), x1, 24):
                    cv2.line(layer, (k, y1), (k + (y1 - y0), y0), (128, 128, 128), 2)
                continue
            cv2.rectangle(layer, (x0, y0), (x1, y1), ramp(acc[0][r, c] / acc[1][r, c]), -1)
    out = cv2.addWeighted(layer, 0.5, base, 0.5, 0)
    for c in range(1, cols):
        cv2.line(out, (int(c * w / cols), 0), (int(c * w / cols), h), (255, 255, 255), 1)
    for r in range(1, rows):
        cv2.line(out, (0, int(r * h / rows)), (w, int(r * h / rows)), (255, 255, 255), 1)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    for a in ("--detect", "--images", "--scores", "--out", "--label"):
        ap.add_argument(a, required=True)
    args = ap.parse_args()
    paths = {}
    with open(args.images) as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                paths[r["id"]] = r["image"]
    scores = {}
    with open(args.scores) as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                scores[r["id"]] = r
    with open(args.detect) as fh:
        dets = [json.loads(l) for l in fh if l.strip()]
    os.makedirs(args.out, exist_ok=True)
    cards = []
    for n, det in enumerate(dets, 1):
        img = cv2.imread(paths[det["id"]], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        H, W = img.shape[:2]
        s = LONG_EDGE / max(H, W)
        base = cv2.resize(img, (int(W * s), int(H * s)), interpolation=cv2.INTER_AREA)
        polys, outc, prob, centres, ps = [], [], [], [], []
        for i, sp in enumerate(det["spines"]):
            sc = scores.get(f"{det['id']}:{i}")
            if not sc:
                continue
            q = np.int32(np.round(np.float64(sp["polygon"]) * s))
            polys.append(q)
            outc.append(COLOURS[sc["outcome"]])
            prob.append((128, 128, 128) if sc["p"] is None else ramp(sc["p"]))
            cx, cy = np.float64(sp["polygon"]).mean(axis=0)
            centres.append((cx / W, cy / H))
            ps.append(sc["p"])
        stem = f"{args.label}-{n:02d}"
        names = [f"{stem}-outcome.jpg", f"{stem}-readability.jpg", f"{stem}-grid.jpg"]
        cv2.imwrite(os.path.join(args.out, names[0]), fill(base, polys, outc), [cv2.IMWRITE_JPEG_QUALITY, 85])
        cv2.imwrite(os.path.join(args.out, names[1]), fill(base, polys, prob), [cv2.IMWRITE_JPEG_QUALITY, 85])
        cv2.imwrite(os.path.join(args.out, names[2]), grid(base, centres, ps), [cv2.IMWRITE_JPEG_QUALITY, 85])
        conf = sum(1 for c in outc if c == COLOURS["confirmed"])
        cards.append((stem, names, len(polys), conf))
        print(f"render: {n}/{len(dets)}", file=sys.stderr)
    legend = "".join(
        f'<span style="background:rgb({c[2]},{c[1]},{c[0]});padding:2px 8px;margin-right:6px;color:#fff">{html.escape(k)}</span>'
        for k, c in COLOURS.items()
    )
    body = "".join(
        f"<h3>{html.escape(stem)} · {n} detected, {conf} confirmed</h3>"
        + "".join(f'<a href="{x}"><img src="{x}" style="height:420px;margin:4px"></a>' for x in names)
        for stem, names, n, conf in cards
    )
    with open(os.path.join(args.out, "index.html"), "w") as fh:
        fh.write(
            f"<!doctype html><meta charset=utf-8><title>Q-1 {html.escape(args.label)}</title>"
            f"<body style='font-family:sans-serif;background:#222;color:#eee'><h1>Q-1 renders · {html.escape(args.label)}</h1>"
            f"<p>Left: F-0 outcome {legend}</p><p>Middle: modelled readability, red 0 → green 1. "
            f"Right: coarse grid of mean modelled readability; grey hatch = nothing detected.</p>{body}</body>"
        )


if __name__ == "__main__":
    main()
