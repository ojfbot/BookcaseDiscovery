"""Spine boxes for F-0 (docs/models/open-weights.md): an open-vocabulary detector finds "book spine" boxes on
overlapping tiles, SAM 2.1 base-plus turns each box into a mask, and the mask's minimum-area rotated rectangle
becomes the contract's 4-point polygon (working-copy pixels). $F0_ARM picks the detector: b2 Grounding DINO base
(default), b3 OWLv2 base patch16 ensemble, b4 MM Grounding DINO large. b1 SAM 3 segments "book spine" instances
directly from the text prompt (no SAM 2.1 step); its masks go through the same polygon, filter and merge steps.
F-0e: tiles may be taller than wide ($F0_TILE_H, $F0_OVERLAP_Y) or follow coarse shelf bands ($F0_LAYOUT=bands),
and post steps run after NMS ($F0_POST: strips, join, extend). `--from detect.jsonl` re-runs only the post steps on
that file's spines. Each output line names its tiling and post steps in "layout".

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
    Sam3Model,
    Sam3Processor,
)

Image.MAX_IMAGE_PIXELS = None

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
MODELS = DATA / "models"
ARM = os.environ.get("F0_ARM", "b2")
ARMS = {"b1": "sam3", "b2": "grounding-dino-base", "b3": "owlv2-base-patch16-ensemble", "b4": "mm-grounding-dino-large-all"}
PROMPT = "book spine."
# Tiling: spines are ~2 % of an ultra-wide frame; the detector shrinks its input to ~800-1333 px.
TILE = int(os.environ.get("F0_TILE", "1600"))  # the runner sets these per photo scale (src/eval/f0.ts)
OVERLAP = int(os.environ.get("F0_OVERLAP", "700"))
# F-0e: tiles may be taller than wide, with their own vertical overlap. A tile row whose overlap is at least the
# tallest shelf band holds every spine whole; the width stays TILE, so the detector's input scale is unchanged.
TILE_H = int(os.environ.get("F0_TILE_H") or TILE)
OVERLAP_Y = int(os.environ.get("F0_OVERLAP_Y") or OVERLAP)
# F-0e post steps after NMS, comma-separated: "strips" (drop boxes lying flat that a tile edge cuts: strips of
# spine ends at a tile's top or bottom, not books), "join" (union stacked pieces of one spine, re-mask) and
# "extend" (re-mask each short upright box with its box stretched to its shelf band's height). Empty: none.
POST = [p for p in os.environ.get("F0_POST", "").split(",") if p]
# "bands": a coarse pass on large tiles finds the shelf bands, then fine tiles follow each band (tile height = band
# height plus a margin). Anything else: the plain grid above.
LAYOUT = os.environ.get("F0_LAYOUT", "grid")
COARSE_TILE, COARSE_OVERLAP = 3100, 1300  # the shelf-scale tiling: a whole shelf fits one tile
BAND_MARGIN = 0.12  # share of a band's height added above and below it for its fine tiles
# OWLv2's scores run lower than Grounding DINO's; 0.1 is its usual open-vocabulary threshold. SAM 3 keeps the
# transformers default for its instance score (0.3).
BOX_THRESHOLD = float(os.environ.get("F0_BOX_THRESHOLD", {"b1": "0.3", "b3": "0.1"}.get(ARM, "0.15")))
TEXT_THRESHOLD = 0.15
MAX_WIDTH_RATIO = 2.5  # a box this many median spine widths across holds several books
MIN_ASPECT = 1.5  # long side / short side; face-out covers and whole-shelf boxes fall below or above
MAX_TILE_SHARE = 0.35  # a "spine" box covering more of the tile than this is a shelf, not a spine
EDGE = 6  # px: a box this close to an inner tile edge is cut by the tile
NMS_IOU = 0.45
CHAIN_WIDTHS = 8  # a gap wider than this many median spine widths ends a shelf band
FLAT_DEG = 60  # long side more than this many degrees from vertical: lying flat
UPRIGHT_DEG = 30  # long side within this many degrees of vertical: an upright spine (as src/eval/f0e.ts)
TOUCH_WIDTHS = 0.25  # stacked pieces of one spine are at most this many median spine widths apart
EXTEND_BELOW = 0.8  # the extend step re-masks upright boxes shorter than this share of their band's height

DEVICE = os.environ.get("F0_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def starts(n: int, tile: int, overlap: int) -> list[int]:
    if n <= tile:
        return [0]
    out = list(range(0, n - tile, tile - overlap))
    out.append(n - tile)
    return out


def tiles(w: int, h: int, tile: int = 0, overlap: int = 0, tile_h: int = 0, overlap_y: int = 0) -> list[tuple[int, int, int, int]]:
    tile, overlap = tile or TILE, overlap or OVERLAP
    tile_h, overlap_y = tile_h or (TILE_H if tile == TILE else tile), overlap_y or (OVERLAP_Y if tile == TILE else overlap)
    return [(x, y, min(x + tile, w), min(y + tile_h, h)) for y in starts(h, tile_h, overlap_y) for x in starts(w, tile, overlap)]


def band_tiles(w: int, h: int, bands: list[dict]) -> list[tuple[int, int, int, int]]:
    """Fine tiles along each coarse shelf band: one tile row per band, as tall as the band plus a margin."""
    out = []
    for b in bands:
        p = np.array(b["polygon"])
        top, bottom = p[:, 1].min(), p[:, 1].max()
        m = BAND_MARGIN * (bottom - top)
        y0, y1 = max(0, int(top - m)), min(h, int(bottom + m))
        x0, x1 = max(0, int(p[:, 0].min() - m)), min(w, int(p[:, 0].max() + m))
        for x in starts(x1 - x0, TILE, OVERLAP):
            out.append((x0 + x, y0, min(x0 + x + TILE, x1), y1))
    return out


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
    def __init__(self, sam_only: bool = False) -> None:
        gd = MODELS / ARMS[ARM]
        sm = MODELS / "sam2.1-hiera-base-plus"
        self.mps_peak = 0
        if sam_only:
            self.sam_proc = Sam2Processor.from_pretrained(sm)
            self.sam = Sam2Model.from_pretrained(sm).to(DEVICE).eval()
            return
        if ARM == "b1":
            self.sam3_proc = Sam3Processor.from_pretrained(gd)
            self.sam3 = Sam3Model.from_pretrained(gd).to(DEVICE).eval()
            return
        if ARM == "b3":
            self.gd_proc = Owlv2Processor.from_pretrained(gd)
            self.gd = Owlv2ForObjectDetection.from_pretrained(gd).to(DEVICE).eval()
        else:
            self.gd_proc = AutoProcessor.from_pretrained(gd)
            self.gd = AutoModelForZeroShotObjectDetection.from_pretrained(gd).to(DEVICE).eval()
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
    def instances(self, tile: Image.Image) -> tuple[np.ndarray, np.ndarray, list[np.ndarray], np.ndarray]:
        """SAM 3: boxes, scores and masks for every "book spine" instance in one pass (at most 200 queries)."""
        inputs = self.sam3_proc(images=tile, text=PROMPT.rstrip("."), return_tensors="pt").to(DEVICE)
        out = self.sam3(**inputs)
        res = self.sam3_proc.post_process_instance_segmentation(
            out, threshold=BOX_THRESHOLD, mask_threshold=0.5, target_sizes=inputs["original_sizes"].tolist(),
        )[0]
        sc = res["scores"].float().cpu().numpy()
        masks = list(res["masks"].cpu().numpy().astype(np.uint8))
        # SAM 3 has no separate mask-quality head here: the instance score stands in for both.
        return res["boxes"].float().cpu().numpy(), sc, masks, sc

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

    def candidates(self, img: Image.Image, grid: list[tuple[int, int, int, int]], sam: bool = True) -> list[tuple]:
        """(rect, boxScore, maskScore, cut) for every box on every tile. Without SAM the box itself is the rect."""
        w, h = img.size
        cands = []
        for x0, y0, x1, y1 in grid:
            tile = img.crop((x0, y0, x1, y1))
            tw, th = tile.size
            if ARM == "b1":
                bx, sc, ms, ious = self.instances(tile)
            else:
                bx, sc = self.boxes(tile)
                ms, ious = [], np.zeros(0)
            keep = [(bx[i][2] - bx[i][0]) * (bx[i][3] - bx[i][1]) <= MAX_TILE_SHARE * tw * th for i in range(len(bx))]
            bx, sc = bx[keep], sc[keep]
            if ARM == "b1":
                ms, ious = [m for m, k in zip(ms, keep) if k], ious[keep]
            if len(bx) == 0:
                continue
            if ARM != "b1" and sam:
                ms, ious = self.masks(tile, bx)
            if DEVICE == "mps":
                self.mps_peak = max(self.mps_peak, torch.mps.driver_allocated_memory())
            for i, (b, s) in enumerate(zip(bx, sc)):
                cut = (x0 > 0 and b[0] < EDGE) or (y0 > 0 and b[1] < EDGE) or \
                      (x1 < w and b[2] > tw - EDGE) or (y1 < h and b[3] > th - EDGE)
                if not sam and ARM != "b1":
                    rect = (((b[0] + b[2]) / 2 + x0, (b[1] + b[3]) / 2 + y0), (b[2] - b[0], b[3] - b[1]), 0.0)
                    cands.append((rect, float(s), 0.0, cut))
                    continue
                rect = mask_rect(ms[i], x0, y0)
                if rect is not None:
                    cands.append((rect, float(s), float(ious[i]), cut))
        return cands

    def coarse_bands(self, img: Image.Image) -> list[dict]:
        """Shelf bands from a box-only pass on shelf-scale tiles (no SAM): the rows of those boxes."""
        w, h = img.size
        kept = nms(narrow(self.candidates(img, tiles(w, h, COARSE_TILE, COARSE_OVERLAP, COARSE_TILE, COARSE_OVERLAP), sam=False)))
        bands, _ = shelf_bands(as_spines(kept))
        return bands

    def remask(self, img: Image.Image, boxes: list[list[float]]) -> list[tuple | None]:
        """SAM 2.1 on image-space boxes, grouped left to right into windows about one tile wide (one call each),
        so a box is masked at the same scale as on its tile. Returns (rect, maskScore) or None per box."""
        w, h = img.size
        out: list[tuple | None] = [None] * len(boxes)
        order = sorted(range(len(boxes)), key=lambda i: (boxes[i][0] + boxes[i][2]) / 2)
        groups: list[list[int]] = []
        for i in order:
            if groups:
                g = groups[-1] + [i]
                if max(boxes[j][2] for j in g) - min(boxes[j][0] for j in g) <= TILE and len(g) <= 32:
                    groups[-1] = g
                    continue
            groups.append([i])
        for g in groups:
            x0 = max(0, int(min(boxes[j][0] for j in g)) - 32)
            y0 = max(0, int(min(boxes[j][1] for j in g)) - 32)
            x1 = min(w, int(max(boxes[j][2] for j in g)) + 32)
            y1 = min(h, int(max(boxes[j][3] for j in g)) + 32)
            local = np.array([[boxes[j][0] - x0, boxes[j][1] - y0, boxes[j][2] - x0, boxes[j][3] - y0] for j in g])
            ms, ious = self.masks(img.crop((x0, y0, x1, y1)), local)
            for j, m, iou in zip(g, ms, ious):
                r = mask_rect(m, x0, y0)
                out[j] = None if r is None else (r, float(iou))
        return out

    def join(self, img: Image.Image, kept: list[tuple]) -> list[tuple]:
        """Union pieces of one spine stacked end to end in one column (same lean, similar width, touching or
        barely overlapping), then re-mask each union with SAM; the union rect stands if SAM finds less of it."""
        if len(kept) < 2:
            return kept
        med = float(np.median([min(c[0][1]) for c in kept]))
        geo = [rect_geometry(c[0]) for c in kept]
        parent = list(range(len(kept)))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for i in range(len(kept)):
            if geo[i]["tilt"] > UPRIGHT_DEG:
                continue
            for j in range(i + 1, len(kept)):
                if geo[j]["tilt"] > UPRIGHT_DEG:
                    continue
                if max(geo[i]["short"], geo[j]["short"]) > 1.5 * min(geo[i]["short"], geo[j]["short"]):
                    continue
                if stacked(geo[i], geo[j], TOUCH_WIDTHS * med):
                    parent[find(i)] = find(j)
        groups: dict[int, list[int]] = {}
        for i in range(len(kept)):
            groups.setdefault(find(i), []).append(i)
        out = [kept[g[0]] for g in groups.values() if len(g) == 1]
        multi = [g for g in groups.values() if len(g) > 1]
        unions = [cv2.minAreaRect(np.concatenate([cv2.boxPoints(kept[i][0]) for i in g]).astype(np.float32)) for g in multi]
        masked = self.remask(img, [aabb(u) for u in unions])
        for g, u, m in zip(multi, unions, masked):
            rect = u
            if m is not None and max(m[0][1]) >= 0.7 * max(u[1]) and min(m[0][1]) <= 1.5 * max(min(kept[i][0][1]) for i in g):
                rect = m[0]
            out.append((rect, max(kept[i][1] for i in g), m[1] if m else float(np.mean([kept[i][2] for i in g])),
                        all(kept[i][3] for i in g)))
        return out

    def extend(self, img: Image.Image, kept: list[tuple]) -> list[tuple]:
        """Re-mask each upright box shorter than its shelf band with its box stretched to the band's full height
        at that x. The new mask stands only if it is longer, about as wide and leans alike; then duplicates (pieces
        of one spine that grew into the same box) are removed."""
        bands, _ = shelf_bands(as_spines(kept))
        if not bands:
            return kept
        polys = [np.array(b["polygon"], dtype=np.float32) for b in bands]
        todo, boxes = [], []
        for i, c in enumerate(kept):
            g = rect_geometry(c[0])
            if g["tilt"] > UPRIGHT_DEG:
                continue
            band = next((p for p in polys if cv2.pointPolygonTest(p, (float(g["cx"]), float(g["cy"])), False) >= 0), None)
            if band is None:
                continue
            top, bottom = column_extent(band, g["cx"])
            if g["long"] >= EXTEND_BELOW * (bottom - top):
                continue
            x0, y0, x1, y1 = aabb(c[0])
            todo.append(i)
            boxes.append([x0, min(y0, top), x1, max(y1, bottom)])
        out = list(kept)
        for i, m in zip(todo, self.remask(img, boxes)):
            if m is None:
                continue
            old, new = rect_geometry(kept[i][0]), rect_geometry(m[0])
            if new["long"] > 1.1 * old["long"] and new["short"] <= 1.4 * old["short"] and abs(new["tilt"] - old["tilt"]) <= 10:
                out[i] = (m[0], kept[i][1], m[1], False)  # re-masked off the tile grid: no longer cut by a tile
        return nms(out, inside=0.7)

    def run(self, path: str, cached: dict | None = None) -> dict:
        t0 = time.time()
        img = Image.open(path).convert("RGB")
        w, h = img.size
        if cached is not None:  # --from: the post steps only, on a previous run's spines
            kept = [(cv2.minAreaRect(np.array(s["polygon"], dtype=np.float32)), s["boxScore"], s["maskScore"], s["cut"])
                    for s in cached["spines"]]
            n_tiles = cached["tiles"]
        else:
            grid = tiles(w, h)
            if LAYOUT == "bands":
                grid = band_tiles(w, h, self.coarse_bands(img)) or grid  # no band found: the plain grid
            n_tiles = len(grid)
            kept = nms(narrow(self.candidates(img, grid)))
        if "strips" in POST:
            kept = [c for c in kept if not (c[3] and rect_geometry(c[0])["tilt"] > FLAT_DEG)]
        if "join" in POST:
            kept = self.join(img, kept)
        if "extend" in POST:
            kept = self.extend(img, kept)
        spines = as_spines(kept)
        bands, gaps = shelf_bands(spines)
        for s in spines:
            s.pop("rect")
        seconds = time.time() - t0 + (cached["seconds"] if cached else 0)
        return {"width": w, "height": h, "spines": spines, "bands": bands, "gaps": gaps,
                "tiles": n_tiles, "seconds": round(seconds, 2), "arm": ARM, "device": DEVICE,
                "layout": provenance(),
                # Peaks so far in this process (models included): resident set and the MPS driver's allocation.
                "peakRssMb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20),
                "mpsPeakMb": round(self.mps_peak / 2**20)}


def provenance() -> str:
    """The tiling and post steps of this process, as the runner's provenance string names them."""
    tiling = f"bands {COARSE_TILE}/{COARSE_OVERLAP} -> {TILE}w" if LAYOUT == "bands" else \
        f"{TILE}x{TILE_H}/{OVERLAP}x{OVERLAP_Y}" if (TILE_H, OVERLAP_Y) != (TILE, OVERLAP) else f"{TILE}/{OVERLAP}"
    return tiling + "".join(f" +{p}" for p in POST)


def mask_rect(m: np.ndarray, x0: int, y0: int) -> tuple | None:
    """A mask's minimum-area rectangle in image coordinates (None when it is empty or thinner than 4 px)."""
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    (cx, cy), (rw, rh), ang = cv2.minAreaRect(max(cnts, key=cv2.contourArea))
    if min(rw, rh) < 4:
        return None
    return ((cx + x0, cy + y0), (rw, rh), ang)


def narrow(cands: list[tuple]) -> list[tuple]:
    """A box much wider than the median spine is a group of books, not one."""
    if not cands:
        return cands
    med = float(np.median([min(c[0][1]) for c in cands]))
    return [c for c in cands if min(c[0][1]) <= MAX_WIDTH_RATIO * med]


def nms(cands: list[tuple], inside: float = 1.01) -> list[tuple]:
    """Whole boxes before cut ones, then by box score. A cut box also yields to any box holding 30 % of it, and
    any box to one holding `inside` of it (F-0e's extend step: grown pieces of one spine)."""
    cands = sorted(cands, key=lambda c: (c[3], -c[1]))
    kept: list[tuple] = []
    for c in cands:
        if any((lambda r: r[0] > NMS_IOU or (c[3] and r[1] > 0.3) or r[1] > inside)(rect_iou(c[0], k[0])) for k in kept):
            continue
        kept.append(c)
    return kept


def as_spines(kept: list[tuple]) -> list[dict]:
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
    return spines


def aabb(rect) -> list[float]:
    p = cv2.boxPoints(rect)
    return [float(p[:, 0].min()), float(p[:, 1].min()), float(p[:, 0].max()), float(p[:, 1].max())]


def rect_geometry(rect) -> dict:
    """Centre, long and short side, unit vector down the long side, and its angle from vertical (as f0e.ts)."""
    v, long, short = long_axis(rect)
    if v[1] < 0 or (v[1] == 0 and v[0] < 0):
        v = -v
    return {"cx": rect[0][0], "cy": rect[0][1], "long": long, "short": short, "ux": float(v[0]), "uy": float(v[1]),
            "tilt": math.degrees(math.atan2(abs(v[0]), abs(v[1])))}


def stacked(a: dict, b: dict, tol: float) -> bool:
    """b sits end to end with a in a's column (mirrors `stacked` in src/eval/f0e.ts, which measures it)."""
    dx, dy = b["cx"] - a["cx"], b["cy"] - a["cy"]
    if abs(-dx * a["uy"] + dy * a["ux"]) > 0.5 * min(a["short"], b["short"]):
        return False
    if abs(a["tilt"] - b["tilt"]) > 10 or abs(a["ux"] * b["uy"] - a["uy"] * b["ux"]) > math.sin(math.radians(10)):
        return False
    gap = abs(dx * a["ux"] + dy * a["uy"]) - (a["long"] + b["long"]) / 2
    return gap <= tol and -gap <= 0.2 * min(a["long"], b["long"])


def column_extent(band: np.ndarray, x: float) -> tuple[float, float]:
    """Top and bottom of a band polygon along the vertical line at x (its y-range when the line misses it)."""
    ys = []
    for i in range(4):
        (xa, ya), (xb, yb) = band[i], band[(i + 1) % 4]
        if xa != xb and min(xa, xb) <= x <= max(xa, xb):
            ys.append(ya + (yb - ya) * (x - xa) / (xb - xa))
    if len(ys) < 2:
        return float(band[:, 1].min()), float(band[:, 1].max())
    return float(min(ys)), float(max(ys))


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
    # --from <detect.jsonl>: re-run only the post steps ($F0_POST) on that file's spines, adding their time.
    src = sys.argv[sys.argv.index("--from") + 1] if "--from" in sys.argv else None
    cached = {}
    if src:
        for line in open(src):
            d = json.loads(line)
            if "error" not in d:
                cached[d["id"]] = d
    log(f"detect: arm {ARM} ({ARMS[ARM]}), device {DEVICE}, layout {provenance()}, threshold {BOX_THRESHOLD}"
        + (" (post steps on cached spines)" if src else ""))
    det = Detector(sam_only=bool(src))
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            if src and req["id"] not in cached:
                raise KeyError("not in the cached run")
            res = det.run(req["image"], cached.get(req["id"]) if src else None)
            print(json.dumps({"id": req["id"], **res}), flush=True)
            log(f"detect: {req['id'][:12]} {len(res['spines'])} spines {res['seconds']} s")
        except Exception as e:  # noqa: BLE001 - one bad image must not stop the run
            print(json.dumps({"id": req["id"], "error": type(e).__name__ + ": " + str(e)[:200]}), flush=True)


if __name__ == "__main__":
    main()
