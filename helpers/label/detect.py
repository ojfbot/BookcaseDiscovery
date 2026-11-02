"""Spine boxes for F-0 (docs/models/open-weights.md): an open-vocabulary detector finds "book spine" boxes on
overlapping tiles, SAM 2.1 base-plus turns each box into a mask, and the mask's minimum-area rotated rectangle
becomes the contract's 4-point polygon (working-copy pixels). $F0_ARM picks the detector: b2 Grounding DINO base
(default), b3 OWLv2 base patch16 ensemble, b4 MM Grounding DINO large.

JSON Lines in (stdin): {"id": str, "image": path}. One JSON line out per image:
{"id", "width", "height", "spines": [{"polygon", "boxScore", "maskScore", "aspect"}], "bands": [...],
 "gaps": {...}, "tiles", "seconds"}. stderr carries progress only, never image content.
Weights are read from $BOOKCASE_DATA/models/ (never downloaded here).
"""

from __future__ import annotations

import json
import math
import os
import resource
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import (
    AutoModelForZeroShotObjectDetection,
    AutoProcessor,
    Owlv2ForObjectDetection,
    Owlv2Processor,
    Sam2Model,
    Sam2Processor,
)

Image.MAX_IMAGE_PIXELS = None

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
MODELS = DATA / "models"
ARM = os.environ.get("F0_ARM", "b2")
ARMS = {"b2": "grounding-dino-base", "b3": "owlv2-base-patch16-ensemble", "b4": "mm-grounding-dino-large-all"}
PROMPT = "book spine."
# Tiling: spines are ~2 % of an ultra-wide frame; the detector shrinks its input to ~800-1333 px.
TILE = int(os.environ.get("F0_TILE", "1600"))  # the runner sets these per photo scale (src/eval/f0.ts)
OVERLAP = int(os.environ.get("F0_OVERLAP", "700"))
# OWLv2's scores run lower than Grounding DINO's; 0.1 is its usual open-vocabulary threshold.
BOX_THRESHOLD = float(os.environ.get("F0_BOX_THRESHOLD", "0.1" if ARM == "b3" else "0.15"))
TEXT_THRESHOLD = 0.15
MAX_WIDTH_RATIO = 2.5  # a box this many median spine widths across holds several books
MIN_ASPECT = 1.5  # long side / short side; face-out covers and whole-shelf boxes fall below or above
MAX_TILE_SHARE = 0.35  # a "spine" box covering more of the tile than this is a shelf, not a spine
EDGE = 6  # px: a box this close to an inner tile edge is cut by the tile
NMS_IOU = 0.45
CHAIN_WIDTHS = 8  # a gap wider than this many median spine widths ends a shelf band

DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def tiles(w: int, h: int) -> list[tuple[int, int, int, int]]:
    def starts(n: int) -> list[int]:
        if n <= TILE:
            return [0]
        step = TILE - OVERLAP
        out = list(range(0, n - TILE, step))
        out.append(n - TILE)
        return out

    return [(x, y, min(x + TILE, w), min(y + TILE, h)) for y in starts(h) for x in starts(w)]


def order_corners(pts: np.ndarray) -> list[list[float]]:
    """Clockwise from the corner nearest the image's top-left: TL, TR, BR, BL (as ocr-vision does)."""
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    cw = pts[np.argsort(ang)]  # y down: increasing angle is clockwise on screen
    start = int(np.argmin(cw[:, 0] + cw[:, 1]))
    cw = np.roll(cw, -start, axis=0)
    return [[round(float(x), 1), round(float(y), 1)] for x, y in cw]


def rect_iou(a: tuple, b: tuple) -> tuple[float, float]:
    """IoU and intersection over the smaller area of two cv2 rotated rects."""
    kind, inter = cv2.rotatedRectangleIntersection(a, b)
    if kind == cv2.INTERSECT_NONE or inter is None:
        return 0.0, 0.0
    ia = cv2.contourArea(cv2.convexHull(inter))
    aa, ab = a[1][0] * a[1][1], b[1][0] * b[1][1]
    return ia / max(aa + ab - ia, 1e-6), ia / max(min(aa, ab), 1e-6)


class Detector:
    def __init__(self) -> None:
        gd = MODELS / ARMS[ARM]
        sm = MODELS / "sam2.1-hiera-base-plus"
        if ARM == "b3":
            self.gd_proc = Owlv2Processor.from_pretrained(gd)
            self.gd = Owlv2ForObjectDetection.from_pretrained(gd).to(DEVICE).eval()
        else:
            self.gd_proc = AutoProcessor.from_pretrained(gd)
            self.gd = AutoModelForZeroShotObjectDetection.from_pretrained(gd).to(DEVICE).eval()
        self.mps_peak = 0
        self.sam_proc = Sam2Processor.from_pretrained(sm)
        self.sam = Sam2Model.from_pretrained(sm).to(DEVICE).eval()

    @torch.inference_mode()
    def boxes(self, tile: Image.Image) -> tuple[np.ndarray, np.ndarray]:
        if ARM == "b3":
            # OWLv2 pads the tile to a square at the bottom and right, so boxes come back in the padded frame.
            side = max(tile.size)
            inputs = self.gd_proc(text=[[PROMPT.rstrip(".")]], images=tile, return_tensors="pt").to(DEVICE)
            out = self.gd(**inputs)
            res = self.gd_proc.post_process_grounded_object_detection(
                out, threshold=BOX_THRESHOLD, target_sizes=torch.tensor([[side, side]]),
            )[0]
            b = res["boxes"].float().cpu().numpy()
            b[:, [0, 2]] = b[:, [0, 2]].clip(0, tile.size[0])
            b[:, [1, 3]] = b[:, [1, 3]].clip(0, tile.size[1])
            return b, res["scores"].float().cpu().numpy()
        inputs = self.gd_proc(images=tile, text=PROMPT, return_tensors="pt").to(DEVICE)
        out = self.gd(**inputs)
        res = self.gd_proc.post_process_grounded_object_detection(
            out, inputs.input_ids, threshold=BOX_THRESHOLD, text_threshold=TEXT_THRESHOLD,
            target_sizes=[tile.size[::-1]],
        )[0]
        return res["boxes"].float().cpu().numpy(), res["scores"].float().cpu().numpy()

    @torch.inference_mode()
    def masks(self, tile: Image.Image, boxes: np.ndarray) -> tuple[list[np.ndarray], np.ndarray]:
        masks: list[np.ndarray] = []
        scores: list[float] = []
        for i in range(0, len(boxes), 32):
            chunk = boxes[i : i + 32].tolist()
            inputs = self.sam_proc(images=tile, input_boxes=[chunk], return_tensors="pt").to(DEVICE)
            out = self.sam(**inputs, multimask_output=False)
            m = self.sam_proc.post_process_masks(out.pred_masks.cpu(), inputs["original_sizes"].cpu())[0]
            masks.extend(m[:, 0].numpy().astype(np.uint8))
            scores.extend(out.iou_scores.float().cpu().numpy().reshape(-1).tolist())
        return masks, np.array(scores)

    def run(self, path: str) -> dict:
        t0 = time.time()
        img = Image.open(path).convert("RGB")
        w, h = img.size
        cands = []  # (rect, boxScore, maskScore, cut)
        grid = tiles(w, h)
        for x0, y0, x1, y1 in grid:
            tile = img.crop((x0, y0, x1, y1))
            tw, th = tile.size
            bx, sc = self.boxes(tile)
            keep = [(bx[i][2] - bx[i][0]) * (bx[i][3] - bx[i][1]) <= MAX_TILE_SHARE * tw * th for i in range(len(bx))]
            bx, sc = bx[keep], sc[keep]
            if len(bx) == 0:
                continue
            ms, ious = self.masks(tile, bx)
            if DEVICE == "mps":
                self.mps_peak = max(self.mps_peak, torch.mps.driver_allocated_memory())
            for b, s, m, iou in zip(bx, sc, ms, ious):
                cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                if not cnts:
                    continue
                cnt = max(cnts, key=cv2.contourArea)
                (cx, cy), (rw, rh), ang = cv2.minAreaRect(cnt)
                if min(rw, rh) < 4:
                    continue
                cut = (x0 > 0 and b[0] < EDGE) or (y0 > 0 and b[1] < EDGE) or \
                      (x1 < w and b[2] > tw - EDGE) or (y1 < h and b[3] > th - EDGE)
                cands.append((((cx + x0, cy + y0), (rw, rh), ang), float(s), float(iou), cut))
        # A box much wider than the median spine is a group of books, not one.
        if cands:
            med = float(np.median([min(c[0][1]) for c in cands]))
            cands = [c for c in cands if min(c[0][1]) <= MAX_WIDTH_RATIO * med]
        # NMS: whole boxes before cut ones, then by box score.
        cands.sort(key=lambda c: (c[3], -c[1]))
        kept: list[tuple] = []
        for c in cands:
            if any((lambda r: r[0] > NMS_IOU or (c[3] and r[1] > 0.3))(rect_iou(c[0], k[0])) for k in kept):
                continue
            kept.append(c)
        spines = []
        for rect, s, iou, cut in kept:
            rw, rh = rect[1]
            aspect = max(rw, rh) / max(min(rw, rh), 1e-6)
            if aspect < MIN_ASPECT:
                continue
            spines.append({
                "polygon": order_corners(cv2.boxPoints(rect)), "boxScore": round(s, 4), "maskScore": round(iou, 4),
                "aspect": round(aspect, 2), "cut": bool(cut), "rect": [list(rect[0]), list(rect[1]), rect[2]],
            })
        bands, gaps = shelf_bands(spines)
        for s in spines:
            s.pop("rect")
        return {"width": w, "height": h, "spines": spines, "bands": bands, "gaps": gaps,
                "tiles": len(grid), "seconds": round(time.time() - t0, 2), "arm": ARM,
                # Peaks so far in this process (models included): resident set and the MPS driver's allocation.
                "peakRssMb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20),
                "mpsPeakMb": round(self.mps_peak / 2**20)}


def long_axis(rect) -> tuple[np.ndarray, float, float]:
    """Unit vector along a spine's long side, its length and its short side."""
    (_, _), (rw, rh), ang = rect
    a = math.radians(ang)
    v = np.array([math.cos(a), math.sin(a)])
    if rh > rw:
        v = np.array([-v[1], v[0]])
    return v, max(rw, rh), min(rw, rh)


def shelf_bands(spines: list[dict]) -> tuple[list[dict], dict]:
    """Machine shelf bands: spines grouped into rows by overlap of their vertical extent. A band runs from its
    leftmost to its rightmost spine, so the gap test sees only gaps between boxes, never missed spines at a
    row's ends (logged as a limitation)."""
    if not spines:
        return [], {"bandLength": 0.0, "gapLength": 0.0, "gapCount": 0, "medianWidth": 0.0}
    items = []
    for i, s in enumerate(spines):
        p = np.array(s["polygon"])
        items.append((i, p[:, 1].min(), p[:, 1].max(), p[:, 0].min(), p[:, 0].max()))
    widths = [long_axis(tuple(s["rect"]))[2] for s in spines]
    median_w = float(np.median(widths))
    items.sort(key=lambda t: (t[3] + t[4]) / 2)  # left to right, so a row grows along x
    rows: list[list[tuple]] = []
    for it in items:
        best, best_ov = None, 0.0
        for r in rows:
            last = r[-1]
            if it[3] - last[4] > CHAIN_WIDTHS * median_w:  # too far right of the row's last box: another case
                continue
            lo, hi = last[1], last[2]
            ov = (min(hi, it[2]) - max(lo, it[1])) / max(min(hi - lo, it[2] - it[1]), 1e-6)
            if ov > best_ov:
                best, best_ov = r, ov
        if best is not None and best_ov >= 0.5:
            best.append(it)
        else:
            rows.append([it])
    bands, band_len, gap_len, gap_n = [], 0.0, 0.0, 0
    for r in rows:
        if len(r) < 3:  # a lone box is not a shelf
            continue
        pts = np.concatenate([np.array(spines[t[0]]["polygon"], dtype=np.float32) for t in r])
        rect = cv2.minAreaRect(pts)
        v, length, _ = long_axis(rect)
        if abs(v[0]) < abs(v[1]):
            v = np.array([-v[1], v[0]])  # band runs along x
        origin = np.array(rect[0])
        ivs = []
        for t in r:
            proj = (np.array(spines[t[0]]["polygon"]) - origin) @ v
            ivs.append((proj.min(), proj.max()))
        ivs.sort()
        lo, hi = ivs[0][0], ivs[0][1]
        gaps = []
        for a, b in ivs[1:]:
            if a > hi:
                gaps.append(a - hi)
            hi = max(hi, b)
        span = hi - lo
        # Slack under half a median spine width is a lean or a shadow, not a missed book.
        real = [g for g in gaps if g >= 0.5 * median_w]
        band_len += span
        gap_len += sum(real)
        gap_n += len(real)
        bands.append({"polygon": order_corners(cv2.boxPoints(rect)), "spines": len(r), "span": round(float(span), 1),
                      "gap": round(float(sum(real)), 1)})
    return bands, {"bandLength": round(band_len, 1), "gapLength": round(gap_len, 1), "gapCount": gap_n,
                   "medianWidth": round(median_w, 1)}


def main() -> None:
    log(f"detect: arm {ARM} ({ARMS[ARM]}), device {DEVICE}, tile {TILE}, overlap {OVERLAP}, threshold {BOX_THRESHOLD}")
    det = Detector()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            res = det.run(req["image"])
            print(json.dumps({"id": req["id"], **res}), flush=True)
            log(f"detect: {req['id'][:12]} {len(res['spines'])} spines {res['seconds']} s")
        except Exception as e:  # noqa: BLE001 - one bad image must not stop the run
            print(json.dumps({"id": req["id"], "error": type(e).__name__ + ": " + str(e)[:200]}), flush=True)


if __name__ == "__main__":
    main()
