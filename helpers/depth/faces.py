"""H-1 spine-face split and book cuboids per detected box, from MoGe-2 normals and point maps (geometry.py).

For each photo, every detected spine polygon (working-copy pixels) is rasterised on the geometry map and eroded by
one map pixel, so neighbours' edges stay out. Each shelf band gets a frame:

- ``front`` (n_f): the band's spine-plane normal, the mode of the normals of its boxes' pixels (mean of those within
  25° of the running estimate, three rounds, starting from the median). It points toward the camera.
- ``up`` (u): the mode of the photo's horizontal-surface normals (within 45° of the camera's up, more than 45° from
  every band's n_f), made orthogonal to n_f. With fewer than 500 such pixels the camera's up is used instead.
- ``side`` (s = u x n_f), along the shelf.
- the band's spine plane offset c_b: the median of n_f . P over its front pixels.

A box whose dominant vertical normal (|n.u| < 0.5) lies more than 35° from its band's n_f stands on another plane
(a side case sharing the band on a whole-case photo). It gets a frame of its own, shared with the band's other such
boxes within 25° of it (``ownPlane``).

Each box pixel is classed by its normal's angle a to n_f: **front** (a < 30°, the spine face) unless it lies more
than 8 cm behind the spine plane (**behind**: back wall, a gap); **edge** (30–45°, rounded spines and mixed pixels,
left out of shares); **other** (a ≥ 45°), split by the larger of |n.u| and |n.s| into **top** (faces up: a top face
or a shelf), **under** (faces down: a shelf's underside) and **cover** (faces along the shelf: a receding cover or
the case's side). A box **over-selects** when top, under, cover and behind together are at least 15 % of its
pixels and at least 15 map pixels.

**Trim**: the largest 8-connected region of front and edge pixels, as a minimum-area rectangle mapped back to
working-copy pixels. It is **feasible** when that region holds at least 80 % of the box's front and edge pixels, the
rectangle's pixels inside the box are at least 85 % front or edge, and its long side keeps at least half the box's.

**Cuboid** (a *book cuboid*): the trimmed region's 3D points in the band frame give the spine-face rectangle
(side p3–p97, up p2–p98, at the median offset). Its depth into the shelf comes from top or cover pixels of the same
book, searched in the box and 25 % of its length past its top end, within the face's side extent: the face offset
minus their 10th-percentile offset, when at least 10 such pixels give 3–35 cm (``seen``); else the band's median
seen depth (``band``); else 20 cm (``default``). The 8 corners are projected with MoGe's intrinsics.

Writes one JSON line per box, then one per photo (``photo: true``: band frames and seconds), to stdout. Private:
they hold positions in private photos. stderr carries progress only.

    python -I faces.py --detect detect.jsonl --geometry DIR [--only ID ...] [--classmaps DIR] > faces.jsonl
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np

FRONT_DEG, EDGE_DEG = 30.0, 45.0
BEHIND_M = 0.08
OVER_SHARE, OVER_MIN_PX = 0.15, 15
TRIM_COMPONENT, TRIM_PURITY, TRIM_KEEP = 0.80, 0.85, 0.5
DEPTH_MIN, DEPTH_MAX, DEPTH_DEFAULT, DEPTH_MIN_PX = 0.03, 0.35, 0.20, 10
TOP_REACH = 0.25
MODE_DEG, HORIZ_DEG, HORIZ_MIN_PX = 25.0, 45.0, 500
PLANE_DEG, VERTICAL_SIN = 35.0, 0.5

CLASSES = ("front", "edge", "top", "under", "cover", "behind")


def unit(v: np.ndarray) -> np.ndarray:
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)


def mode_direction(n: np.ndarray, start: np.ndarray | None = None, deg: float = MODE_DEG, rounds: int = 3) -> np.ndarray:
    """Dominant unit direction of normals ``n`` (N, 3): mean of those within ``deg`` of the running estimate."""
    est = unit(np.median(n, axis=0) if start is None else start)
    cos = math.cos(math.radians(deg))
    for _ in range(rounds):
        near = n[n @ est > cos]
        if len(near) < 10:
            break
        est = unit(near.mean(axis=0))
    return est


def long_side(poly: np.ndarray) -> float:
    e = np.linalg.norm(np.roll(poly, -1, axis=0) - poly, axis=1)
    return float(max(e[0], e[1]))


def box_mask(poly_map: np.ndarray, H: int, W: int) -> tuple[np.ndarray, tuple[int, int, int, int]] | None:
    x0, y0 = np.floor(poly_map.min(axis=0)).astype(int) - 2
    x1, y1 = np.ceil(poly_map.max(axis=0)).astype(int) + 2
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    if x1 - x0 < 3 or y1 - y0 < 3:
        return None
    m = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(m, [np.round(poly_map - [x0, y0]).astype(np.int32)], 1)
    m = cv2.erode(m, np.ones((3, 3), np.uint8))
    return m.astype(bool), (x0, y0, x1, y1)


def top_extension(poly_map: np.ndarray, reach: float) -> np.ndarray:
    """The polygon stretched by ``reach`` of its long side past its upper end (smaller image y)."""
    p = poly_map.copy()
    e = np.linalg.norm(np.roll(p, -1, axis=0) - p, axis=1)
    pairs = [(1, 2), (3, 0)] if e[0] >= e[1] else [(0, 1), (2, 3)]  # the two short sides
    ends = [(p[a] + p[b]) / 2 for a, b in pairs]
    top_i = 0 if ends[0][1] <= ends[1][1] else 1
    axis = ends[top_i] - ends[1 - top_i]
    for k in pairs[top_i]:
        p[k] = p[k] + axis * reach
    return p


def classify(n: np.ndarray, P: np.ndarray, frame: dict) -> np.ndarray:
    """Class index (into CLASSES) per pixel."""
    nf, u, s, c = frame["front"], frame["up"], frame["side"], frame["offset"]
    cos = np.clip(n @ nf, -1, 1)
    ang = np.degrees(np.arccos(cos))
    h, w = n @ u, n @ s
    out = np.full(len(n), 4, np.int8)  # cover
    out[(np.abs(h) >= np.abs(w)) & (h > 0)] = 2  # top
    out[(np.abs(h) >= np.abs(w)) & (h <= 0)] = 3  # under
    out[ang < EDGE_DEG] = 1
    front = ang < FRONT_DEG
    out[front] = 0
    if c is not None:
        out[front & (P @ nf < c - BEHIND_M)] = 5
    return out


def project(X: np.ndarray, K: np.ndarray, W: int, H: int, scale: float) -> list[list[float]]:
    x = (K[0, 0] * X[:, 0] / X[:, 2] + K[0, 2]) * W / scale
    y = (K[1, 1] * X[:, 1] / X[:, 2] + K[1, 2]) * H / scale
    return [[round(float(a), 1), round(float(b), 1)] for a, b in zip(x, y)]


def run_photo(rec: dict, z: dict) -> tuple[list[dict], dict, np.ndarray]:
    N = unit(z["normal"].astype(np.float32))
    P = z["points"].astype(np.float32)
    valid = z["mask"] & np.isfinite(P).all(-1) & np.isfinite(N).all(-1)
    K, scale = z["intrinsics"], float(z["scale"])
    H, W = N.shape[:2]

    spines = rec["spines"]
    bands = rec.get("bands") or []
    polys = [np.float64(sp["polygon"]) * scale for sp in spines]
    centres = [p.mean(axis=0) for p in polys]
    band_polys = [np.float32(b["polygon"]) * scale for b in bands]
    band_of = []
    for c in centres:
        hit = [i for i, bp in enumerate(band_polys) if cv2.pointPolygonTest(bp, (float(c[0]), float(c[1])), False) >= 0]
        band_of.append(hit[0] if hit else -1)

    masks = [box_mask(p, H, W) for p in polys]

    # Band frames: spine-plane normal per band (and one for boxes in no band).
    frames: dict[int, dict] = {}
    for b in sorted(set(band_of)):
        ns = []
        for i, bm in enumerate(masks):
            if band_of[i] != b or bm is None:
                continue
            m, (x0, y0, x1, y1) = bm
            sel = m & valid[y0:y1, x0:x1]
            ns.append(N[y0:y1, x0:x1][sel])
        ns = np.concatenate(ns) if ns else np.zeros((0, 3), np.float32)
        if len(ns) > 60000:
            ns = ns[np.random.default_rng(0).choice(len(ns), 60000, replace=False)]
        if len(ns) < 50:
            continue
        nf = mode_direction(ns, start=np.array([0, 0, -1.0]) if np.median(ns[:, 2]) > 0 else None)
        frames[b] = {"front": nf, "n": len(ns)}

    # Up: the photo's horizontal surfaces.
    cam_up = np.array([0, -1.0, 0])
    flat = N[valid]
    flat = flat[np.random.default_rng(1).choice(len(flat), min(len(flat), 200000), replace=False)]
    cand = flat[flat @ cam_up > math.cos(math.radians(HORIZ_DEG))]
    for fr in frames.values():
        cand = cand[cand @ fr["front"] < math.cos(math.radians(45))]
    up_h = mode_direction(cand, start=cam_up) if len(cand) >= HORIZ_MIN_PX else cam_up
    for b, fr in frames.items():
        nf = fr["front"]
        u = unit(up_h - (up_h @ nf) * nf)
        fr["up"], fr["side"], fr["offset"] = u, unit(np.cross(u, nf)), None
        fr["upSource"] = "surfaces" if len(cand) >= HORIZ_MIN_PX else "camera"

    # A box on another vertical plane than its band (on a whole-case photo, a side case can share a band with the
    # front one): its dominant vertical normal lies more than PLANE_DEG from the band's front. Such boxes get a
    # plane of their own, shared by the band's other such boxes within MODE_DEG of it.
    frame_of: dict[int, object] = {}
    for b, fr in list(frames.items()):
        odd = []
        for i, bm in enumerate(masks):
            if band_of[i] != b or bm is None:
                continue
            m, (x0, y0, x1, y1) = bm
            n = N[y0:y1, x0:x1][m & valid[y0:y1, x0:x1]]
            vert = n[np.abs(n @ up_h) < VERTICAL_SIN]
            d = mode_direction(vert) if len(vert) >= 20 else fr["front"]
            if d @ fr["front"] < math.cos(math.radians(PLANE_DEG)):
                odd.append((i, d))
            else:
                frame_of[i] = b
        groups: list[dict] = []
        for i, d in odd:
            for g in groups:
                if d @ g["dir"] > math.cos(math.radians(MODE_DEG)):
                    g["boxes"].append(i)
                    g["dirs"].append(d)
                    break
            else:
                groups.append({"dir": d, "boxes": [i], "dirs": [d]})
        for k, g in enumerate(groups):
            nf = unit(np.mean(g["dirs"], axis=0))
            u = unit(up_h - (up_h @ nf) * nf)
            key = f"{b}.{k + 1}"
            frames[key] = {"front": nf, "n": len(g["boxes"]), "up": u, "side": unit(np.cross(u, nf)), "offset": None,
                           "upSource": fr["upSource"]}
            for i in g["boxes"]:
                frame_of[i] = key

    # Spine-plane offset per frame from its front pixels.
    for b, fr in frames.items():
        cs = []
        for i, bm in enumerate(masks):
            if frame_of.get(i) != b or bm is None:
                continue
            m, (x0, y0, x1, y1) = bm
            sel = m & valid[y0:y1, x0:x1]
            n, p = N[y0:y1, x0:x1][sel], P[y0:y1, x0:x1][sel]
            f = n @ fr["front"] > math.cos(math.radians(FRONT_DEG))
            cs.append(p[f] @ fr["front"])
        cs = np.concatenate(cs) if cs else np.zeros(0)
        fr["offset"] = float(np.median(cs)) if len(cs) else None
        fr["offsetSpreadM"] = float(np.subtract(*np.percentile(cs, [75, 25]))) if len(cs) else None

    rows, seen_depth = [], {b: [] for b in frames}
    classmap = np.full((H, W), 255, np.uint8)  # class index per box pixel; 255 outside every box
    for i, bm in enumerate(masks):
        key = frame_of.get(i)
        row = {"id": rec["id"], "box": i, "band": band_of[i], "frame": str(key), "ownPlane": isinstance(key, str),
               "cut": bool(spines[i].get("cut"))}
        fr = frames.get(key)
        if bm is None or fr is None:
            row["skip"] = "no-pixels" if bm is None else "no-frame"
            rows.append(row)
            continue
        m, (x0, y0, x1, y1) = bm
        sel = m & valid[y0:y1, x0:x1]
        n, p = N[y0:y1, x0:x1][sel], P[y0:y1, x0:x1][sel]
        if len(n) < 20:
            row["skip"] = "small"
            rows.append(row)
            continue
        cls = classify(n, p, fr)
        cm = classmap[y0:y1, x0:x1]
        cm[sel] = np.where(cm[sel] == 255, cls, cm[sel])
        counts = {k: int((cls == j).sum()) for j, k in enumerate(CLASSES)}
        total = len(cls)
        extra = counts["top"] + counts["under"] + counts["cover"] + counts["behind"]
        row.update(counts)
        row["pixels"] = total
        row["shareOver"] = round(extra / total, 4)
        row["overSelects"] = extra / total >= OVER_SHARE and extra >= OVER_MIN_PX
        # Elevation of the box centre against the horizon (negative: below eye level, seen from above).
        ray = unit(np.median(p, axis=0))
        row["elevationDeg"] = round(math.degrees(math.asin(float(np.clip(ray @ fr["up"], -1, 1)))), 1)

        # Trim to the largest connected front/edge region.
        lab = np.full(m.shape, -1, np.int8)
        lab[sel] = cls
        fe = ((lab == 0) | (lab == 1)).astype(np.uint8)
        k, comp, stats, _ = cv2.connectedComponentsWithStats(fe, connectivity=8)
        if k > 1 and fe.sum() > 0:
            j = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            region = comp == j
            ys, xs = np.nonzero(region)
            rect = cv2.minAreaRect(np.stack([xs, ys], 1).astype(np.float32))
            quad = cv2.boxPoints(rect)
            rm = np.zeros(m.shape, np.uint8)
            cv2.fillPoly(rm, [np.round(quad).astype(np.int32)], 1)
            inside = rm.astype(bool) & sel
            purity = float(fe[inside].mean()) if inside.any() else 0.0
            comp_share = float(region.sum() / fe.sum())
            keep = long_side(quad) / max(long_side(polys[i] - [x0, y0]), 1e-6)
            row["trim"] = {
                "polygon": [[round(float((a + x0) / scale), 1), round(float((b + y0) / scale), 1)] for a, b in quad],
                "component": round(comp_share, 3), "purity": round(purity, 3), "keep": round(min(keep, 1.5), 3),
                "areaShare": round(float(region.sum() / total), 3),
            }
            row["trimFeasible"] = comp_share >= TRIM_COMPONENT and purity >= TRIM_PURITY and keep >= TRIM_KEEP
            F = P[y0:y1, x0:x1][region & valid[y0:y1, x0:x1]]
        else:
            row["trimFeasible"] = False
            F = np.zeros((0, 3), np.float32)

        # Cuboid from the spine face plus a depth seen on the book's top or cover.
        if len(F) >= 20:
            a, b, c = F @ fr["side"], F @ fr["up"], F @ fr["front"]
            a0, a1 = np.percentile(a, [3, 97])
            b0, b1 = np.percentile(b, [2, 98])
            cf = float(np.median(c))
            ext = box_mask(top_extension(polys[i], TOP_REACH), H, W)
            depth, src = None, None
            if ext is not None:
                em, (ex0, ey0, ex1, ey1) = ext
                esel = em & valid[ey0:ey1, ex0:ex1]
                en, ep = N[ey0:ey1, ex0:ex1][esel], P[ey0:ey1, ex0:ex1][esel]
                ecls = classify(en, ep, fr)
                ea = ep @ fr["side"]
                pick = ((ecls == 2) | (ecls == 4)) & (ea >= a0) & (ea <= a1)
                if pick.sum() >= DEPTH_MIN_PX:
                    d = cf - float(np.percentile(ep[pick] @ fr["front"], 10))
                    if DEPTH_MIN <= d <= DEPTH_MAX:
                        depth, src = d, "seen"
                        seen_depth[key].append(d)
            row["cuboid"] = {"side": [float(a0), float(a1)], "up": [float(b0), float(b1)], "offset": cf,
                             "depthM": depth, "depthSource": src}
            row["heightM"] = round(float(b1 - b0), 4)
            row["widthM"] = round(float(a1 - a0), 4)
        rows.append(row)

    # Fill unseen depths, then project each cuboid's corners.
    for row in rows:
        cb = row.get("cuboid")
        if not cb:
            continue
        key = frame_of[row["box"]]
        fr = frames[key]
        if cb["depthM"] is None:
            bd = seen_depth.get(key) or []
            cb["depthM"], cb["depthSource"] = (float(np.median(bd)), "band") if bd else (DEPTH_DEFAULT, "default")
        s, u, nf = fr["side"], fr["up"], fr["front"]
        (a0, a1), (b0, b1), cf, d = cb["side"], cb["up"], cb["offset"], cb["depthM"]
        corners = [a * s + b * u + cf * nf for a, b in ((a0, b0), (a1, b0), (a1, b1), (a0, b1))]
        corners = np.array(corners + [x - d * nf for x in corners])
        if (corners[:, 2] <= 0.01).any():
            del row["cuboid"]
            continue
        cb["corners"] = project(corners, K, W, H, scale)
        cb["depthM"] = round(float(d), 4)
        for k in ("side", "up"):
            cb[k] = [round(v, 4) for v in cb[k]]
        cb["offset"] = round(cb["offset"], 4)

    frame_rows = {str(b): {"front": [round(float(v), 4) for v in fr["front"]], "up": [round(float(v), 4) for v in fr["up"]],
                           "upSource": fr["upSource"], "offsetSpreadM": fr["offsetSpreadM"], "pixels": fr["n"]}
                  for b, fr in frames.items()}
    return rows, frame_rows, classmap


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--detect", required=True)
    ap.add_argument("--geometry", required=True)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--classmaps", default=None, help="private folder for per-photo class maps (PNG, for render.py)")
    args = ap.parse_args()
    for line in open(args.detect):
        rec = json.loads(line)
        if args.only and rec["id"] not in args.only:
            continue
        g = Path(args.geometry) / f"{rec['id']}.npz"
        if not g.exists():
            print(f"{rec['id'][:8]} no geometry", file=sys.stderr)
            continue
        t = time.time()
        z = dict(np.load(g))
        rows, frames, classmap = run_photo(rec, z)
        if args.classmaps:
            Path(args.classmaps).mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(Path(args.classmaps) / f"{rec['id']}.png"), classmap)
        for row in rows:
            sys.stdout.write(json.dumps(row) + "\n")
        secs = round(time.time() - t, 2)
        sys.stdout.write(json.dumps({"id": rec["id"], "photo": True, "frames": frames, "facesSeconds": secs}) + "\n")
        sys.stdout.flush()
        print(f"{rec['id'][:8]} {len(rows)} boxes {secs}s", file=sys.stderr)


if __name__ == "__main__":
    main()
