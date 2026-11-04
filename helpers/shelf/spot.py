"""S-1's blind spot check sheet: each sampled box on its photo with 25 % context, numbered, no machine output.

    python -I spot.py --key key.jsonl --images images.jsonl --out DIR

``key.jsonl`` (from s1-cli.ts spot) holds ``{n, id, polygon, group}``; the sheet shows only ``n``. Private.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

CONTEXT = 0.25


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True)
    ap.add_argument("--images", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    images = {json.loads(l)["id"]: json.loads(l)["image"] for l in open(args.images)}
    out = Path(args.out)
    for line in open(args.key):
        r = json.loads(line)
        im = np.asarray(Image.open(images[r["id"]]).convert("RGB"))
        p = np.float32(r["polygon"])
        x0, y0 = p.min(axis=0)
        x1, y1 = p.max(axis=0)
        pad = CONTEXT * max(x1 - x0, y1 - y0) + 40
        H, W = im.shape[:2]
        X0, Y0, X1, Y1 = int(max(0, x0 - pad)), int(max(0, y0 - pad)), int(min(W, x1 + pad)), int(min(H, y1 + pad))
        crop = cv2.cvtColor(im[Y0:Y1, X0:X1], cv2.COLOR_RGB2BGR).copy()
        cv2.polylines(crop, [np.round(p - [X0, Y0]).astype(np.int32)], True, (255, 0, 255), max(2, (X1 - X0) // 300), cv2.LINE_AA)
        s = 900 / max(crop.shape[:2])
        if s < 1:
            crop = cv2.resize(crop, (round(crop.shape[1] * s), round(crop.shape[0] * s)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(out / f"{r['n']:02d}.jpg"), crop, [cv2.IMWRITE_JPEG_QUALITY, 88])


if __name__ == "__main__":
    main()
