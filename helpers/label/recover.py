"""F-0k: missed-book recovery (pre-registered in evals/F0k/prereg.md).

  detect (GPU): Grounding DINO + SAM 2.1 re-prompted on one tile per candidate region, with detect.py's `candidates`
                unchanged. A candidate belongs to its region when its rectangle's centre lies inside the region grown
                by half the photo's median spine width; detect.py's `narrow` (photo median), `strips` and aspect floor
                follow. Out: one pool row per surviving candidate, with its mask's largest outer contour.
  gate (CPU):   per arm and photo, F-0i's constants with the existing boxes fixed: detect.py's `nms` among the new
                candidates, then duplicate / piece-of against the kept boxes in F-0i's label map, then the exclusive
                mask (minus kept pixels and new boxes ranked before it) with F-0i's absorb share. Out: recovered boxes.

    python -I recover.py detect --requests R.jsonl > pool.jsonl           # one request line per photo
    python -I recover.py gate --pool P.jsonl --labels DIR --arm A --sources a,b > boxes.jsonl

Per-box output goes only under the data root's private/f0k/; stderr carries counts only.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

# F-0i's gate constants (helpers/coverage/resolve.py), unchanged.
DUP_IOU, DUP_IOM, DUP_RATIO = 0.5, 0.85, 1.3
NEST_IOM = 0.8
ABSORB_KEEP = 0.3
REGION_GROW_WIDTHS = 0.5  # a candidate's centre may lie this many median spine widths outside its region


def log(s: str) -> None:
    print(f"[f0k] {s}", file=sys.stderr, flush=True)


def grown(poly: list, by: float) -> np.ndarray:
    """The polygon's outline dilated by `by` px (as a contour), for the centre-inside test."""
    p = np.array(poly, np.float32)
    x0, y0 = p.min(0) - by - 2
    x1, y1 = p.max(0) + by + 2
    w, h = int(x1 - x0) + 1, int(y1 - y0) + 1
    m = np.zeros((h, w), np.uint8)
    cv2.fillPoly(m, [np.round(p - [x0, y0]).astype(np.int32)], 1)
    if by > 0:
        k = int(round(2 * by)) | 1
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cnts, key=cv2.contourArea).astype(np.float32)
    c[:, 0, 0] += x0
    c[:, 0, 1] += y0
    return c


# --- detect -----------------------------------------------------------------------------------------------------

def detect(requests: Path) -> None:
    import detect as D  # noqa: PLC0415 - torch loads only on the GPU step
    from PIL import Image  # noqa: PLC0415

    det = D.Detector()
    log(f"detect: arm {D.ARM}, device {D.DEVICE}, threshold {D.BOX_THRESHOLD}")
    for line in open(requests):
        req = json.loads(line)
        t0 = time.time()
        img = Image.open(req["image"]).convert("RGB")
        w, h = img.size
        mw = float(req["medianWidth"])
        n_tiles, n_in, n_out = 0, 0, 0
        for reg in req["regions"]:
            zone = grown(reg["polygon"], REGION_GROW_WIDTHS * mw)
            for t, tile in enumerate(reg["tiles"]):
                x0, y0, x1, y1 = tile
                n_tiles += 1
                for c in candidates_with_contours(det, D, img, (x0, y0, x1, y1)):
                    (cx, cy), _, _ = c["rect"]
                    if cv2.pointPolygonTest(zone, (float(cx), float(cy)), False) < 0:
                        continue
                    n_in += 1
                    rect = c["rect"]
                    if min(rect[1]) > D.MAX_WIDTH_RATIO * mw:  # narrow, on the photo's median width
                        continue
                    if c["cut"] and D.rect_geometry(rect)["tilt"] > D.FLAT_DEG:  # strips
                        continue
                    aspect = max(rect[1]) / max(min(rect[1]), 1e-6)
                    if aspect < D.MIN_ASPECT:  # as_spines' floor
                        continue
                    n_out += 1
                    print(json.dumps({
                        "photo": req["id"], "region": reg["id"], "source": reg["source"], "tile": t, "tileBox": tile,
                        "rect": [list(map(float, rect[0])), list(map(float, rect[1])), float(rect[2])],
                        "polygon": D.order_corners(cv2.boxPoints(rect)), "boxScore": round(c["score"], 4),
                        "maskScore": round(c["iou"], 4), "aspect": round(aspect, 2), "cut": bool(c["cut"]),
                        "contour": c["contour"],
                    }), flush=True)
        log(f"detect: {req['id'][:12]} {len(req['regions'])} regions {n_tiles} tiles {n_in} in regions {n_out} pooled "
            f"{time.time() - t0:.1f} s")
        print(json.dumps({"photo": req["id"], "done": True, "tiles": n_tiles, "inRegions": n_in, "pooled": n_out,
                          "seconds": round(time.time() - t0, 2)}), flush=True)


def candidates_with_contours(det, D, img, tile: tuple) -> list[dict]:
    """detect.py's `candidates` on one tile, keeping each mask's largest outer contour (image coordinates)."""
    import torch  # noqa: PLC0415

    x0, y0, x1, y1 = tile
    w, h = img.size
    crop = img.crop(tile)
    tw, th = crop.size
    bx, sc = det.boxes(crop)
    keep = [(b[2] - b[0]) * (b[3] - b[1]) <= D.MAX_TILE_SHARE * tw * th for b in bx]
    bx, sc = bx[keep], sc[keep]
    if len(bx) == 0:
        return []
    ms, ious = det.masks(crop, bx)
    if D.DEVICE == "mps":
        det.mps_peak = max(det.mps_peak, torch.mps.driver_allocated_memory())
    out = []
    for i, (b, s) in enumerate(zip(bx, sc)):
        cut = (x0 > 0 and b[0] < D.EDGE) or (y0 > 0 and b[1] < D.EDGE) or \
              (x1 < w and b[2] > tw - D.EDGE) or (y1 < h and b[3] > th - D.EDGE)
        cnts, _ = cv2.findContours(ms[i], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        big = max(cnts, key=cv2.contourArea)
        rect = D.mask_rect(ms[i], x0, y0)
        if rect is None:
            continue
        contour = [[int(p[0][0]) + x0, int(p[0][1]) + y0] for p in big]
        out.append({"rect": rect, "score": float(s), "iou": float(ious[i]), "cut": bool(cut), "contour": contour})
    return out


# --- gate -------------------------------------------------------------------------------------------------------

def raster(contour: list, W: int, H: int) -> tuple[tuple[int, int, int, int], np.ndarray]:
    c = np.array(contour, np.int32)
    x0, y0 = max(0, int(c[:, 0].min())), max(0, int(c[:, 1].min()))
    x1, y1 = min(W, int(c[:, 0].max()) + 1), min(H, int(c[:, 1].max()) + 1)
    m = np.zeros((max(y1 - y0, 1), max(x1 - x0, 1)), np.uint8)
    cv2.fillPoly(m, [c - [x0, y0]], 1)
    return (x0, y0, x1, y1), m.astype(bool)


def gate(pool_path: Path, labels: Path, arm: str, sources: set[str]) -> None:
    import detect as D  # noqa: PLC0415 - geometry helpers only; torch import is unavoidable but no model loads

    rows = [json.loads(x) for x in open(pool_path)]
    by_photo: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if "done" not in r and r["source"] in sources:
            by_photo[r["photo"]].append(r)
    totals: Counter = Counter()
    for photo in sorted(by_photo):
        cands = by_photo[photo]
        lab = cv2.imread(str(labels / f"{photo}.png"), cv2.IMREAD_UNCHANGED)
        if lab is None:
            raise FileNotFoundError(f"no label map for a photo in {labels}")
        H, W = lab.shape
        kept_area = np.bincount(lab.ravel(), minlength=int(lab.max()) + 1)
        # 1. nms among the new candidates (detect.py's own: whole before cut, then box score).
        tup = [((tuple(c["rect"][0]), tuple(c["rect"][1]), c["rect"][2]), c["boxScore"], c["maskScore"], c["cut"], k)
               for k, c in enumerate(cands)]
        survivors = {t[4] for t in D.nms([t[:4] + (t[4],) for t in tup])} if tup else set()
        totals["candidates"] += len(cands)
        totals["nms"] += len(cands) - len(survivors)
        # 2. duplicate / piece-of against single kept boxes.
        alive = []
        for k in sorted(survivors):
            c = cands[k]
            bb, m = raster(c["contour"], W, H)
            a = int(m.sum())
            if a == 0:
                totals["empty"] += 1
                continue
            sub = lab[bb[1]:bb[3], bb[0]:bb[2]][m]
            inter = np.bincount(sub, minlength=len(kept_area))
            why = None
            for j in np.nonzero(inter[1:])[0] + 1:
                i, aj = int(inter[j]), int(kept_area[j])
                iou = i / (a + aj - i)
                iom = i / min(a, aj)
                ratio = max(a, aj) / min(a, aj)
                if iou >= DUP_IOU or (iom >= DUP_IOM and ratio < DUP_RATIO):
                    why = "duplicate"
                    break
                if i / a >= NEST_IOM:
                    why = "piece-of"
            if why:
                totals[why] += 1
                continue
            alive.append((k, bb, m, a))
        # 3. exclusive masks, best first (box score × mask score, then pool order).
        alive.sort(key=lambda t: (-cands[t[0]]["boxScore"] * cands[t[0]]["maskScore"], t[0]))
        claimed = lab > 0
        for k, bb, m, a in alive:
            c = cands[k]
            excl = m & ~claimed[bb[1]:bb[3], bb[0]:bb[2]]
            share = float(excl.sum()) / a
            if share < ABSORB_KEEP:
                totals["absorbed"] += 1
                continue
            n, cc, st, _ = cv2.connectedComponentsWithStats(excl.astype(np.uint8), connectivity=8)
            big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
            comp = cc == big
            claimed[bb[1]:bb[3], bb[0]:bb[2]] |= excl
            cnts, _ = cv2.findContours(comp.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            outline = [[int(p[0][0]) + bb[0], int(p[0][1]) + bb[1]] for p in max(cnts, key=cv2.contourArea)]
            yy, xx = np.nonzero(comp)
            rect = cv2.minAreaRect(np.stack([xx + bb[0], yy + bb[1]], 1).astype(np.float32))
            if min(rect[1]) < 4:
                totals["thin"] += 1
                continue
            totals["recovered"] += 1
            print(json.dumps({
                "photo": photo, "pool": c["poolIndex"], "region": c["region"], "source": c["source"], "tile": c["tile"],
                "polygon": D.order_corners(cv2.boxPoints(rect)), "boxScore": c["boxScore"], "maskScore": c["maskScore"],
                "aspect": round(max(rect[1]) / max(min(rect[1]), 1e-6), 2), "cut": c["cut"], "keptShare": round(share, 4),
                "area": int(comp.sum()), "outline": outline, "recoveredBy": "f0k", "arm": arm,
            }), flush=True)
    log(f"gate {arm}: " + ", ".join(f"{k} {v}" for k, v in sorted(totals.items())))
    print(json.dumps({"arm": arm, "totals": dict(totals)}), flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["detect", "gate"])
    ap.add_argument("--requests", type=Path)
    ap.add_argument("--pool", type=Path)
    ap.add_argument("--labels", type=Path)
    ap.add_argument("--arm")
    ap.add_argument("--sources")
    a = ap.parse_args()
    if a.step == "detect":
        detect(a.requests)
    else:
        gate(a.pool, a.labels, a.arm, set(a.sources.split(",")))


if __name__ == "__main__":
    main()
