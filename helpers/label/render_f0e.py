"""F-0e private before/after renders: each photo twice, side by side, with one arm's spine boxes on the left and
another's on the right. Boxes cut by a tile edge are red, the rest yellow. Writes JPEGs (each half's long edge
1600 px) and an index.html to --out, which must be a private folder under the data root (never the repo).

    python -I render_f0e.py --before a.jsonl --after b.jsonl --images images.jsonl --out DIR --label SET \
        --names "base,tall+extend"
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys

import cv2
import numpy as np

LONG_EDGE = 1600
CUT, WHOLE = (40, 40, 230), (0, 200, 255)  # BGR


def load(path: str) -> dict:
    out = {}
    for line in open(path):
        d = json.loads(line)
        if "error" not in d:
            out[d["id"]] = d
    return out


def draw(img: np.ndarray, det: dict, scale: float) -> np.ndarray:
    base = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    layer = base.copy()
    polys = [(np.array(s["polygon"]) * scale).astype(np.int32) for s in det["spines"]]
    colours = [CUT if s["cut"] else WHOLE for s in det["spines"]]
    for p, c in zip(polys, colours):
        cv2.fillPoly(layer, [p], c)
    out = cv2.addWeighted(layer, 0.35, base, 0.65, 0)
    for p, c in zip(polys, colours):
        cv2.polylines(out, [p], True, c, 2)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    for a in ("--before", "--after", "--images", "--out", "--label", "--names"):
        ap.add_argument(a, required=True)
    args = ap.parse_args()
    root = os.path.realpath(os.environ.get("BOOKCASE_DATA", os.path.expanduser("~/data/bookcase-discovery")))
    out = os.path.realpath(args.out)
    if not out.startswith(os.path.join(root, "private") + os.sep):
        sys.exit("render_f0e: --out must be under the data root's private/ folder")
    os.makedirs(out, exist_ok=True)
    before, after = load(args.before), load(args.after)
    left, right = args.names.split(",")
    rows = []
    for n, line in enumerate(open(args.images), 1):
        req = json.loads(line)
        if req["id"] not in before or req["id"] not in after:
            continue
        img = cv2.imread(req["image"])
        scale = LONG_EDGE / max(img.shape[:2])
        b, a = before[req["id"]], after[req["id"]]
        pair = np.concatenate([draw(img, b, scale), np.full((int(img.shape[0] * scale) + 0, 12, 3), 30, np.uint8), draw(img, a, scale)], axis=1)
        name = f"{args.label}-{n:02d}.jpg"
        cv2.imwrite(os.path.join(out, name), pair, [cv2.IMWRITE_JPEG_QUALITY, 85])
        cuts = lambda d: sum(s["cut"] for s in d["spines"])  # noqa: E731
        rows.append(f"<h2>{html.escape(args.label)}-{n:02d} · {html.escape(left)}: {len(b['spines'])} boxes, {cuts(b)} cut"
                    f" · {html.escape(right)}: {len(a['spines'])} boxes, {cuts(a)} cut</h2><img src='{name}'>")
        print(f"render: {n}", file=sys.stderr, flush=True)
    page = ("<!doctype html><meta charset=utf-8><title>F-0e renders</title><style>body{background:#222;color:#eee;"
            "font:14px system-ui;margin:16px}img{width:100%;margin-bottom:24px}</style>"
            f"<h1>F-0e · {html.escape(args.label)} · left {html.escape(left)}, right {html.escape(right)}"
            " · red: cut by a tile edge, yellow: not cut</h1>" + "".join(rows))
    with open(os.path.join(out, "index.html"), "w") as f:
        f.write(page)


if __name__ == "__main__":
    main()
