"""Mask outlines for cached F-0 boxes (card F-0b): SAM 2.1 base-plus re-segments each spine from its polygon's
axis-aligned box, and the mask's outer contour comes back as a simplified polygon in working-copy pixels. F-0's
detection cache keeps only the mask's minimum-area rectangle, and the crop-geometry experiment needs the mask's
shape (a second plane, a perspective trapezoid), so the masks are re-derived here; detect.py emits the same
outline directly for new runs.

JSON Lines in (stdin): {"id", "image", "polygon"}. One line out per box: {"id", "outline": [[x, y], ...],
"maskScore", "seconds"} or {"id", "error"}. stderr carries progress only, never image content.
Weights are read from $BOOKCASE_DATA/models/ (never downloaded here).
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import Sam2Model, Sam2Processor

Image.MAX_IMAGE_PIXELS = None

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
MODELS = DATA / "models"
DEVICE = os.environ.get("F0_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")
MARGIN = 0.15  # context around the box, as a share of its larger side
EPSILON = 0.004  # contour simplification, as a share of the contour's perimeter


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def outline_of(mask: np.ndarray, x0: int, y0: int) -> list[list[float]] | None:
    """Largest outer contour of a binary mask, simplified, offset back to image pixels."""
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    cnt = max(cnts, key=cv2.contourArea)
    approx = cv2.approxPolyDP(cnt, max(1.0, EPSILON * cv2.arcLength(cnt, True)), True)[:, 0, :]
    if len(approx) < 3:
        return None
    return [[round(float(x) + x0, 1), round(float(y) + y0, 1)] for x, y in approx]


class Segmenter:
    def __init__(self) -> None:
        sm = MODELS / "sam2.1-hiera-base-plus"
        self.proc = Sam2Processor.from_pretrained(sm)
        self.sam = Sam2Model.from_pretrained(sm).to(DEVICE).eval()

    @torch.inference_mode()
    def run(self, img: Image.Image, polygon: list[list[float]]) -> tuple[list[list[float]] | None, float]:
        w, h = img.size
        p = np.array(polygon, dtype=np.float64)
        bx0, by0 = max(0.0, p[:, 0].min()), max(0.0, p[:, 1].min())
        bx1, by1 = min(float(w), p[:, 0].max()), min(float(h), p[:, 1].max())
        m = MARGIN * max(bx1 - bx0, by1 - by0)
        x0, y0 = int(max(0, bx0 - m)), int(max(0, by0 - m))
        x1, y1 = int(min(w, bx1 + m)), int(min(h, by1 + m))
        window = img.crop((x0, y0, x1, y1))
        box = [[bx0 - x0, by0 - y0, bx1 - x0, by1 - y0]]
        inputs = self.proc(images=window, input_boxes=[box], return_tensors="pt").to(DEVICE)
        out = self.sam(**inputs, multimask_output=False)
        mask = self.proc.post_process_masks(out.pred_masks.cpu(), inputs["original_sizes"].cpu())[0][0, 0].numpy()
        return outline_of(mask, x0, y0), float(out.iou_scores.float().cpu().numpy().reshape(-1)[0])


def main() -> None:
    log(f"outline: sam2.1-hiera-base-plus, device {DEVICE}")
    seg = Segmenter()
    cache: tuple[str, Image.Image] | None = None
    n = 0
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        t0 = time.time()
        try:
            if cache is None or cache[0] != req["image"]:
                cache = (req["image"], Image.open(req["image"]).convert("RGB"))
            outline, score = seg.run(cache[1], req["polygon"])
            if outline is None:
                print(json.dumps({"id": req["id"], "error": "empty-mask"}), flush=True)
            else:
                print(json.dumps({"id": req["id"], "outline": outline, "maskScore": round(score, 4),
                                  "seconds": round(time.time() - t0, 3)}), flush=True)
        except Exception as e:  # noqa: BLE001 - one bad box must not stop the run
            print(json.dumps({"id": req["id"], "error": type(e).__name__}), flush=True)
        n += 1
        if n % 200 == 0:
            log(f"outline: {n} boxes")


if __name__ == "__main__":
    main()
