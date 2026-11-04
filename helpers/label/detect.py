"""Spine boxes for F-0 (docs/models/open-weights.md): an open-vocabulary detector finds "book spine" boxes on
overlapping tiles, SAM 2.1 base-plus turns each box into a mask, and the mask's minimum-area rotated rectangle
becomes the contract's 4-point polygon (working-copy pixels). $F0_ARM picks the detector: b2 Grounding DINO base
(default), b3 OWLv2 base patch16 ensemble, b4 MM Grounding DINO large. b1 SAM 3 segments "book spine" instances
directly from the text prompt (no SAM 2.1 step); its masks go through the same polygon, filter and merge steps.
F-0e: tiles may be taller than wide ($F0_TILE_H, $F0_OVERLAP_Y) or follow coarse shelf bands ($F0_LAYOUT=bands),
and post steps run after NMS ($F0_POST: strips, join, extend). `--from detect.jsonl` re-runs only the post steps on
that file's spines. Each output line names its tiling and post steps in "layout".
F-0f: post steps "tops" (an upright box whose top stops short of its row's top line is extended along its own axis
and re-masked with SAM, at its own width), "ends" (the same for both ends) and "angles" (a box leaning off its row's
fitted lean is turned to it). Rows come from each box's upright neighbours, so every shelf keeps its own perspective.
F-0c: the post step "covers" runs a second pass with the prompt "book cover." on shelf-scale tiles and adds the
cover-shaped boxes it finds as "covers" (face-out books). It never changes "spines": with only that step, `--from`
copies the cached spines, bands and gaps verbatim. Which box is a spine, a face-out cover or not a book is decided
from both lists by src/eval/f0c.ts.

JSON Lines in (stdin): {"id": str, "image": path}. One JSON line out per image:
{"id", "width", "height", "spines": [{"polygon", "boxScore", "maskScore", "aspect"}], "bands": [...],
 "gaps": {...}, "tiles", "seconds"}, plus "covers" (same box fields), "coverTiles" and "coverSeconds" with "covers". stderr carries progress only, never image content.
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
COVER_PROMPT = "book cover."  # F-0c: the cover pass (post step "covers")
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
# F-0c: a cover-prompt box is kept for src/eval/f0c.ts only if its long side is under this many times its short side
# (a portrait cover is 1.25-1.67; the rest is perspective and mask slack). Spine-shaped cover-prompt boxes are spines.
COVER_MAX_ASPECT = 2.0
FLAT_DEG = 60  # long side more than this many degrees from vertical: lying flat
UPRIGHT_DEG = 30  # long side within this many degrees of vertical: an upright spine (as src/eval/f0e.ts)
TOUCH_WIDTHS = 0.25  # stacked pieces of one spine are at most this many median spine widths apart
EXTEND_BELOW = 0.8  # the extend step re-masks upright boxes shorter than this share of their band's height
# F-0f post steps "tops", "ends" and "angles" read each upright box's row from its neighbours, not from the band
# polygon (a minimum-area rectangle that perspective and chained rows stretch): upright boxes within ROW_WIDTHS
# median spine widths either side whose vertical extents overlap by half, leaning within ROW_LEAN degrees.
ROW_WIDTHS = 6
ROW_LEAN = 15
ROW_WHOLE = 0.8  # a neighbour this share of the row's spine height (p90) or longer is whole: its ends make the row's lines
TOPS_SHORT = 0.12  # an end this share of the row's spine height short of the row's line is extended to it
TOPS_MAX = 1.1  # never grown longer than this many row spine heights
TOPS_WIDTH = 1.3  # the re-mask may be at most this much wider than the box (no swallowing a neighbour)
TOPS_LEAN = 6  # ... and lean within this many degrees of it
ANGLE_DEV = 6  # "angles": a box leaning this many degrees off its row's fitted lean is turned to it

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
    def boxes(self, tile: Image.Image, prompt: str = PROMPT) -> tuple[np.ndarray, np.ndarray]:
        if ARM == "b3":
            # OWLv2 pads the tile to a square at the bottom and right, so boxes come back in the padded frame.
            side = max(tile.size)
            inputs = self.gd_proc(text=[[prompt.rstrip(".")]], images=tile, return_tensors="pt").to(DEVICE)
            out = self.gd(**inputs)
            res = self.gd_proc.post_process_grounded_object_detection(
                out, threshold=BOX_THRESHOLD, target_sizes=torch.tensor([[side, side]]),
            )[0]
            b = res["boxes"].float().cpu().numpy()
            b[:, [0, 2]] = b[:, [0, 2]].clip(0, tile.size[0])
            b[:, [1, 3]] = b[:, [1, 3]].clip(0, tile.size[1])
            return b, res["scores"].float().cpu().numpy()
        inputs = self.gd_proc(images=tile, text=prompt, return_tensors="pt").to(DEVICE)
        out = self.gd(**inputs)
        res = self.gd_proc.post_process_grounded_object_detection(
            out, inputs.input_ids, threshold=BOX_THRESHOLD, text_threshold=TEXT_THRESHOLD,
            target_sizes=[tile.size[::-1]],
        )[0]
        return res["boxes"].float().cpu().numpy(), res["scores"].float().cpu().numpy()

    @torch.inference_mode()
    def instances(self, tile: Image.Image, prompt: str = PROMPT) -> tuple[np.ndarray, np.ndarray, list[np.ndarray], np.ndarray]:
        """SAM 3: boxes, scores and masks for every prompted instance ("book spine") in one pass (at most 200 queries)."""
        inputs = self.sam3_proc(images=tile, text=prompt.rstrip("."), return_tensors="pt").to(DEVICE)
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

    def candidates(self, img: Image.Image, grid: list[tuple[int, int, int, int]], sam: bool = True, prompt: str = PROMPT) -> list[tuple]:
        """(rect, boxScore, maskScore, cut) for every box on every tile. Without SAM the box itself is the rect."""
        w, h = img.size
        cands = []
        for x0, y0, x1, y1 in grid:
            tile = img.crop((x0, y0, x1, y1))
            tw, th = tile.size
            if ARM == "b1":
                bx, sc, ms, ious = self.instances(tile, prompt)
            else:
                bx, sc = self.boxes(tile, prompt)
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

    @torch.inference_mode()
    def prompted(self, img: Image.Image, box: list[float], pos: list[tuple], neg: list[tuple]) -> tuple | None:
        """SAM 2.1 on one image-space box with positive and negative points, in a window around the box (as
        `remask`). Returns (rect, maskScore) or None."""
        w, h = img.size
        x0, y0 = max(0, int(box[0]) - 32), max(0, int(box[1]) - 32)
        x1, y1 = min(w, int(box[2]) + 32), min(h, int(box[3]) + 32)
        pts = [[float(p[0]) - x0, float(p[1]) - y0] for p in pos + neg]
        inputs = self.sam_proc(images=img.crop((x0, y0, x1, y1)), input_boxes=[[[box[0] - x0, box[1] - y0, box[2] - x0, box[3] - y0]]],
                               input_points=[[pts]], input_labels=[[[1] * len(pos) + [0] * len(neg)]], return_tensors="pt").to(DEVICE)
        out = self.sam(**inputs, multimask_output=False)
        m = self.sam_proc.post_process_masks(out.pred_masks.cpu(), inputs["original_sizes"].cpu())[0][0, 0].numpy().astype(np.uint8)
        r = mask_rect(m, x0, y0)
        return None if r is None else (r, float(out.iou_scores.float().cpu().numpy().reshape(-1)[0]))

    def tops(self, img: Image.Image, kept: list[tuple], ends: tuple[str, ...] = ("top",)) -> list[tuple]:
        """F-0f: an upright box whose top end (and with "ends", its bottom end) stops short of its row's line is
        extended along its own axis to that line, at its own width, and re-masked with SAM: the extended box as the
        prompt, points on the box and on the new part, negative points on the nearest neighbours either side. The
        mask stands only if it reached at least half the way, leans and is as wide as the box, and holds no
        neighbour from another column; boxes then mostly inside a grown box (pieces of its spine) are dropped."""
        rows = row_lines(kept)
        geo = [rect_geometry(c[0]) for c in kept]
        out = list(kept)
        grown: set[int] = set()
        why = {"rows": len(rows), "short": 0, "no-mask": 0, "too-short": 0, "too-long": 0, "too-wide": 0, "lean": 0, "moved": 0, "neighbour": 0}
        for i, row in rows.items():
            g = geo[i]
            u = np.array([g["ux"], g["uy"]])
            c = np.array([g["cx"], g["cy"]])
            top, bottom = c - u * g["long"] / 2, c + u * g["long"] / 2
            need = {"top": along_to_line(top, -u, row["top"]), "bottom": along_to_line(bottom, u, row["bottom"]) if "bottom" in ends else None}
            t_top = need["top"] if need["top"] is not None and need["top"] > TOPS_SHORT * row["h"] else 0.0
            t_bot = need["bottom"] if need["bottom"] is not None and need["bottom"] > TOPS_SHORT * row["h"] else 0.0
            if t_top <= 0 and t_bot <= 0:
                continue
            new_long = min(g["long"] + t_top + t_bot, TOPS_MAX * row["h"])
            if new_long <= g["long"] * 1.05:
                continue
            why["short"] += 1
            scale = (new_long - g["long"]) / (t_top + t_bot)
            t_top, t_bot = t_top * scale, t_bot * scale
            nc = c + u * (t_bot - t_top) / 2
            ang = math.degrees(math.atan2(u[1], u[0]))
            ext = ((float(nc[0]), float(nc[1])), (new_long, g["short"]), ang)
            pos = [tuple(c)] + ([tuple(top - u * t_top / 2)] if t_top > 0 else []) + ([tuple(bottom + u * t_bot / 2)] if t_bot > 0 else [])
            neg = neighbour_points(geo, i, np.array(pos[1]), row["nb"])
            m = self.prompted(img, aabb(ext), pos, neg)
            if m is None:
                why["no-mask"] += 1
                continue
            ng = rect_geometry(m[0])
            lateral = abs(-(ng["cx"] - g["cx"]) * g["uy"] + (ng["cy"] - g["cy"]) * g["ux"])
            fail = ("too-short" if ng["long"] < g["long"] + 0.5 * (t_top + t_bot) else "too-long" if ng["long"] > new_long + 0.15 * row["h"]
                    else "too-wide" if ng["short"] > TOPS_WIDTH * g["short"] else "lean" if abs(ng["tilt"] - g["tilt"]) > TOPS_LEAN
                    else "moved" if lateral > 0.5 * g["short"] else None)
            if fail is None and any(j != i and other_column(g, geo[j]) and held(m[0], kept[j][0]) >= 0.5 for j in range(len(kept))):
                fail = "neighbour"  # it took in most of a box from another column: a neighbour, not the rest of this spine
            if fail:
                why[fail] += 1
                continue
            out[i] = (m[0], kept[i][1], m[1], False)  # re-masked off the tile grid: no longer cut by a tile
            grown.add(i)
        # A box mostly inside a grown box is a piece of that spine (or the same spine twice): the grown box stands.
        drop = {j for j in range(len(out)) if j not in grown and any(held(out[i][0], out[j][0]) >= 0.6 for i in grown)}
        log("tops: " + ", ".join(f"{k} {v}" for k, v in why.items()) + f", grown {len(grown)}, pieces dropped {len(drop)}")
        return nms([c for k, c in enumerate(out) if k in grown]) + [c for k, c in enumerate(out) if k not in drop and k not in grown]

    def angles(self, kept: list[tuple]) -> list[tuple]:
        """F-0f: an upright box leaning more than ANGLE_DEV degrees off its row's lean (fitted on its neighbours,
        linear in x, since spines converge to one vanishing point) is turned about its centre to that lean. Size
        and centre stay; no re-mask."""
        rows = row_lines(kept)
        out = list(kept)
        for i, row in rows.items():
            if row["lean"] is None:
                continue
            g = rect_geometry(kept[i][0])
            if abs(g["lean"] - row["lean"]) <= ANGLE_DEV:
                continue
            a = math.radians(row["lean"])  # signed angle of the long axis from vertical, down-pointing
            ang = math.degrees(math.atan2(math.cos(a), math.sin(a)))
            out[i] = (((g["cx"], g["cy"]), (g["long"], g["short"]), ang), kept[i][1], kept[i][2], kept[i][3])
        return out

    def covers(self, img: Image.Image) -> tuple[list[dict], int]:
        """F-0c cover pass: "book cover." on the shelf-scale grid (a cover is several spines wide, so it fits whole
        in a coarse tile where a fine tile could cut it, and a shelf of only face-out books has no spine band to
        tile along). Cover-shaped boxes only; duplicates across tiles removed as for spines. Returns (covers, tiles)."""
        w, h = img.size
        grid = tiles(w, h, COARSE_TILE, COARSE_OVERLAP, COARSE_TILE, COARSE_OVERLAP)
        kept = nms([c for c in self.candidates(img, grid, prompt=COVER_PROMPT) if max(c[0][1]) < COVER_MAX_ASPECT * min(c[0][1])])
        out = []
        for rect, s, iou, cut in kept:
            out.append({"polygon": order_corners(cv2.boxPoints(rect)), "boxScore": round(s, 4), "maskScore": round(iou, 4),
                        "aspect": round(max(rect[1]) / max(min(rect[1]), 1e-6), 2), "cut": bool(cut)})
        return out, len(grid)

    def run(self, path: str, cached: dict | None = None) -> dict:
        t0 = time.time()
        img = Image.open(path).convert("RGB")
        w, h = img.size
        steps = [p for p in POST if p != "covers"]
        if cached is not None and not steps:  # --from with the cover pass only: the cached spines stand verbatim
            covers, cover_tiles = self.covers(img)
            cover_seconds = round(time.time() - t0, 2)
            return {**{k: v for k, v in cached.items() if k != "id"}, "covers": covers, "coverTiles": cover_tiles,
                    "coverSeconds": cover_seconds, "seconds": round(cached["seconds"] + cover_seconds, 2),
                    "layout": (cached.get("layout") or "") + " +covers"}
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
        if "angles" in POST:
            kept = self.angles(kept)
        if "tops" in POST or "ends" in POST:
            kept = self.tops(img, kept, ("top", "bottom") if "ends" in POST else ("top",))
        spines = as_spines(kept)
        bands, gaps = shelf_bands(spines)
        for s in spines:
            s.pop("rect")
        extra: dict = {}
        if "covers" in POST:  # after the spine path, which it never touches
            c0 = time.time()
            covers, cover_tiles = self.covers(img)
            extra = {"covers": covers, "coverTiles": cover_tiles, "coverSeconds": round(time.time() - c0, 2)}
        seconds = time.time() - t0 + (cached["seconds"] if cached else 0)
        return {"width": w, "height": h, "spines": spines, "bands": bands, "gaps": gaps, **extra,
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
            "tilt": math.degrees(math.atan2(abs(v[0]), abs(v[1]))),
            # signed: positive when the bottom end lies right of the top end
            "lean": math.degrees(math.atan2(float(v[0]), float(v[1])))}


def held(a: tuple, b: tuple) -> float:
    """Share of rotated rect b's area inside rotated rect a."""
    _, small = rect_iou(a, b)
    aa, ab = a[1][0] * a[1][1], b[1][0] * b[1][1]
    return small * min(aa, ab) / max(ab, 1e-6)


def theil_sen(x: np.ndarray, y: np.ndarray, max_slope: float) -> tuple[float, float]:
    """Median of pairwise slopes (clipped), then the median intercept: a line robust to a few odd points."""
    sl = [(y[j] - y[i]) / (x[j] - x[i]) for i in range(len(x)) for j in range(i + 1, len(x)) if abs(x[j] - x[i]) > 1]
    m = float(np.clip(np.median(sl), -max_slope, max_slope)) if sl else 0.0
    return m, float(np.median(y - m * x))


def row_lines(kept: list[tuple]) -> dict[int, dict]:
    """F-0f: for each upright box with at least three row neighbours, its row's spine height `h` (p90 of the long
    sides), the lines through the top and bottom ends of the row's whole boxes (y = a x + b, slopes clipped to 0.3)
    and the row's lean at the box's x (signed degrees, fitted linear in x on the neighbours, None under four), plus
    the neighbours themselves (`nb`)."""
    if not kept:
        return {}
    geo = [rect_geometry(c[0]) for c in kept]
    med = float(np.median([g["short"] for g in geo]))
    up = [i for i, g in enumerate(geo) if g["tilt"] <= UPRIGHT_DEG]
    ext = {i: (geo[i]["cy"] - geo[i]["uy"] * geo[i]["long"] / 2, geo[i]["cy"] + geo[i]["uy"] * geo[i]["long"] / 2) for i in up}
    out = {}
    for i in up:
        gi = geo[i]
        nb = []
        for j in up:
            if j == i or abs(geo[j]["cx"] - gi["cx"]) > ROW_WIDTHS * med or abs(geo[j]["lean"] - gi["lean"]) > ROW_LEAN:
                continue
            (a0, a1), (b0, b1) = ext[i], ext[j]
            if min(a1, b1) - max(a0, b0) >= 0.5 * min(a1 - a0, b1 - b0):
                nb.append(j)
        if len(nb) < 3:
            continue
        h = float(np.quantile([geo[j]["long"] for j in nb + [i]], 0.9))
        whole = [j for j in nb if geo[j]["long"] >= ROW_WHOLE * h]
        if len(whole) < 2:
            continue
        ends = {}
        for name, sgn in (("top", -1), ("bottom", 1)):
            pts = np.array([[geo[j]["cx"] + sgn * geo[j]["ux"] * geo[j]["long"] / 2, geo[j]["cy"] + sgn * geo[j]["uy"] * geo[j]["long"] / 2] for j in whole])
            ends[name] = theil_sen(pts[:, 0], pts[:, 1], 0.3)
        lean = None
        if len(nb) >= 4:
            a, b = theil_sen(np.array([geo[j]["cx"] for j in nb]), np.array([geo[j]["lean"] for j in nb]), 0.05)
            lean = a * gi["cx"] + b
        out[i] = {"h": h, "top": ends["top"], "bottom": ends["bottom"], "lean": lean, "nb": nb}
    return out


def along_to_line(p: np.ndarray, d: np.ndarray, line: tuple[float, float]) -> float | None:
    """Distance from p along unit direction d to the line y = a x + b (negative: the line is behind p)."""
    a, b = line
    den = d[1] - a * d[0]
    if abs(den) < 1e-6:
        return None
    return float((a * p[0] + b - p[1]) / den)


def other_column(g: dict, o: dict) -> bool:
    """o's centre lies off g's axis by more than half of g's width: another spine, not a piece of g's."""
    return abs(-(o["cx"] - g["cx"]) * g["uy"] + (o["cy"] - g["cy"]) * g["ux"]) > 0.5 * g["short"]


def neighbour_points(geo: list[dict], i: int, at: np.ndarray, row: list[int]) -> list[tuple]:
    """Negative points for the re-mask: on the nearest box of its row either side of box i (another column), at
    the height of `at` along its own axis (clipped to its ends)."""
    g = geo[i]
    best: dict[int, tuple[float, int]] = {}
    for j in row:
        o = geo[j]
        if not other_column(g, o):
            continue
        side = 1 if (o["cx"] - g["cx"]) * g["uy"] - (o["cy"] - g["cy"]) * g["ux"] > 0 else -1
        d = abs(o["cx"] - g["cx"])
        if d <= 3 * (g["short"] + o["short"]) and (side not in best or d < best[side][0]):
            best[side] = (d, j)
    pts = []
    for _, j in best.values():
        o = geo[j]
        t = float(np.clip((at[0] - o["cx"]) * o["ux"] + (at[1] - o["cy"]) * o["uy"], -o["long"] / 2, o["long"] / 2))
        pts.append((o["cx"] + o["ux"] * t, o["cy"] + o["uy"] * t))
    return pts


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
    det = Detector(sam_only=bool(src) and "covers" not in POST)  # the cover pass needs the box detector
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
