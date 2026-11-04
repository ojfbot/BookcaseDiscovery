"""F-R3: label-free, CPU-only alternate image representations, scored on cached data (no model runs).

Each representation re-renders a pilot-000 working copy (colour spaces, illumination invariants, a classical
albedo/shading split, edges, lines, band-pass energy, H-2's depth and normals) and yields an edge map. The edge maps
are scored against Q-2b's outline boundaries (M1), H-2's depth and normal discontinuities (M2) and spine-to-spine
seams between neighbouring boxes (M3); per-pixel values are scored on book faces against not-a-book regions (M4, M5).
The pre-registration (sample rule, measures, decision rule) is evals/FR3/report.md. Work is at H-2's point-map
resolution (2048 px long side).

stdout: aggregates only (metrics JSON). Per-photo rows and renders go under the data root's private/fr3/.
stderr: progress (photo ordinals, never ids).

    python -I spike.py --images I --detect D --outlines O --table T --stage S --cache C --out PRIV > metrics.json
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np

GEOMETRY_DIR = "moge-2-vitl-normal@cb0e8bb"
SAMPLE_N = 10
SALT = "F-R3/"
REPS, SEED = 2000, 1
MAX_PIX = 50_000
FRONT, UNDER, BEHIND = 0, 3, 5  # helpers/depth/faces.py CLASSES indices
UPRIGHT_DEG = 15
M1_BOUNDARY, M1_INTERIOR = 1, 4
M2_GROW, M2_PCT, M2_AWAY = 6, 95, 3
M3_HEIGHTS, M3_SPAN = 9, (0.2, 0.8)
M4_GROW, M4_WIN = 8, 15

CHANNEL_REPS = ["gray", "rgb", "lab", "lab-L", "lab-C", "hsv-S", "hsv-V", "opponent", "rg-chroma", "c1c2c3",
                "log-chroma", "clahe-L", "retinex", "bilateral-albedo"]
EDGE_REPS = ["canny", "coherent", "aligned", "dog", "lsd", "lsd-long", "depth", "normals"]
FUSED = {"fuse-colour": ["lab", "opponent", "log-chroma", "retinex"], "fuse-rgb+depth": ["rgb", "depth", "normals"]}
ALL_REPS = CHANNEL_REPS + EDGE_REPS + list(FUSED)
FAMILY = {**{r: "baseline" for r in ["gray", "rgb"]},
          **{r: "(a) colour" for r in ["lab", "lab-L", "lab-C", "hsv-S", "hsv-V", "opponent", "rg-chroma", "c1c2c3"]},
          "log-chroma": "(a) invariant", "clahe-L": "(a) contrast", "retinex": "(b) intrinsic",
          "bilateral-albedo": "(b) intrinsic", **{r: "(c) edges" for r in ["canny", "coherent", "aligned", "dog"]},
          "lsd": "(c) lines", "lsd-long": "(c) lines", "depth": "(c) geometry", "normals": "(c) geometry",
          **{r: "fused" for r in FUSED}}
CIRCULAR_M2 = {"depth", "normals", "fuse-rgb+depth"}
FEATURES = ["luma", "L*", "a*", "b*", "C*", "S", "V", "O1", "O2", "r", "g", "log-chroma", "retinex",
            "bilateral-albedo", "edge-density", "dog-energy", "coherence", "rel-depth"]
COLOUR_TEXTURE = [f for f in FEATURES if f != "rel-depth"]
CLASSES = ["flagged", "behind", "under", "outside"]


def log(s: str) -> None:
    print(f"[fr3] {s}", file=sys.stderr, flush=True)


def read_jsonl(path: str | Path) -> list[dict]:
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def sample_ids(ids: list[str], n: int = SAMPLE_N) -> list[str]:
    """The pre-registered sample: smallest SHA-256 of SALT + id."""
    return sorted(ids, key=lambda i: hashlib.sha256((SALT + i).encode()).hexdigest())[:n]


# --- representations --------------------------------------------------------------------------------------

def spread(x: np.ndarray, valid: np.ndarray) -> float:
    q1, q3 = np.percentile(x[valid], [25, 75])
    s = (q3 - q1) / 1.349
    return float(s) if s > 1e-6 else float(x[valid].std() + 1e-6)


def grad_xy(ch: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    g = cv2.GaussianBlur(ch.astype(np.float32), (0, 0), 1.0)
    return cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)


def grad_mag(ch: np.ndarray) -> np.ndarray:
    gx, gy = grad_xy(ch)
    return np.sqrt(gx * gx + gy * gy)


def edge_multi(chs: list[np.ndarray], valid: np.ndarray, normalise: bool = True) -> np.ndarray:
    acc = np.zeros(chs[0].shape, np.float32)
    for c in chs:
        g = grad_mag(c / spread(c, valid) if normalise else c)
        acc += g * g
    return np.sqrt(acc)


def log_chroma_invariant(rgb: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, int]:
    """Finlayson-Drew-Lu entropy-minimised 1-D invariant on the stored sRGB values; returns (map, angle in degrees)."""
    lg = np.log(rgb + 1.0 / 255)
    rho = lg - lg.mean(axis=2, keepdims=True)
    u = np.array([[1 / math.sqrt(2), -1 / math.sqrt(2), 0], [1 / math.sqrt(6), 1 / math.sqrt(6), -2 / math.sqrt(6)]],
                 np.float32)
    chi = rho @ u.T
    flat = chi.reshape(-1, 2)
    pick = flat[rng.choice(len(flat), size=min(100_000, len(flat)), replace=False)]
    best, best_h = 0, math.inf
    for deg in range(180):
        t = math.radians(deg)
        v = pick[:, 0] * math.cos(t) + pick[:, 1] * math.sin(t)
        lo, hi = np.percentile(v, [5, 95])
        v = v[(v >= lo) & (v <= hi)]
        width = 3.5 * v.std() * len(v) ** (-1 / 3)
        if width <= 0:
            continue
        hist, _ = np.histogram(v, bins=max(1, int(math.ceil((hi - lo) / width))))
        p = hist[hist > 0] / hist.sum()
        h = float(-(p * np.log(p)).sum())
        if h < best_h:
            best, best_h = deg, h
    t = math.radians(best)
    return (chi[..., 0] * math.cos(t) + chi[..., 1] * math.sin(t)).astype(np.float32), best


def structure(gx: np.ndarray, gy: np.ndarray, sigma: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    b = lambda a: cv2.GaussianBlur(a, (0, 0), sigma)
    return b(gx * gx), b(gy * gy), b(gx * gy)


def compute(rgb: np.ndarray, pts: np.ndarray, nrm: np.ndarray, valid: np.ndarray, rng: np.random.Generator) -> tuple[dict, dict, dict]:
    """Edge maps per representation, per-pixel feature maps, and timing/info."""
    t0 = time.perf_counter()
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    luma = 0.299 * R + 0.587 * G + 0.114 * B
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2Lab)
    L, A, Bb = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(A, Bb)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    S, V = hsv[..., 1], hsv[..., 2]
    O1, O2, O3 = (R - G) / math.sqrt(2), (R + G - 2 * B) / math.sqrt(6), (R + G + B) / math.sqrt(3)
    s = R + G + B + 1e-4
    r, g = R / s, G / s
    eps = 1e-4
    c1 = np.arctan2(R, np.maximum(G, B) + eps)
    c2 = np.arctan2(G, np.maximum(R, B) + eps)
    c3 = np.arctan2(B, np.maximum(R, G) + eps)
    inv, angle = log_chroma_invariant(rgb, rng)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(np.clip(L * 2.55, 0, 255).astype(np.uint8))
    logY = np.log(luma + 1.0 / 255).astype(np.float32)
    retinex = np.mean([logY - np.log(cv2.GaussianBlur(luma, (0, 0), sg) + 1.0 / 255) for sg in (8, 32, 128)], axis=0)
    shading = cv2.bilateralFilter(logY, d=-1, sigmaColor=0.3, sigmaSpace=16)
    albedo = logY - shading
    t_rep = time.perf_counter()

    E: dict[str, np.ndarray] = {}
    E["gray"] = grad_mag(luma)
    E["rgb"] = edge_multi([R, G, B], valid)
    E["lab"] = edge_multi([L, A, Bb], valid)
    E["lab-L"], E["lab-C"] = grad_mag(L), grad_mag(C)
    E["hsv-S"], E["hsv-V"] = grad_mag(S), grad_mag(V)
    E["opponent"] = edge_multi([O1, O2, O3], valid)
    E["rg-chroma"] = edge_multi([r, g], valid)
    E["c1c2c3"] = edge_multi([c1, c2, c3], valid)
    E["log-chroma"] = grad_mag(inv)
    E["clahe-L"] = grad_mag(clahe.astype(np.float32))
    E["retinex"] = grad_mag(retinex)
    E["bilateral-albedo"] = grad_mag(albedo)

    y8 = np.clip(luma * 255, 0, 255).astype(np.uint8)
    med = float(np.median(y8))
    E["canny"] = (cv2.Canny(y8, 0.66 * med, 1.33 * med) > 0).astype(np.float32)
    gx, gy = grad_xy(luma)
    mag = np.sqrt(gx * gx + gy * gy)
    j11, j22, j12 = structure(gx, gy, 4)
    coh = (np.sqrt((j11 - j22) ** 2 + 4 * j12 ** 2) / (j11 + j22 + 1e-9)) ** 2
    E["coherent"] = mag * coh
    k11, k22, k12 = structure(gx, gy, 12)
    th = 0.5 * np.arctan2(2 * k12, k11 - k22)
    proj = gx * np.cos(th) + gy * np.sin(th)
    E["aligned"] = proj * proj / (mag + 1e-9)
    dog = np.abs(cv2.GaussianBlur(luma, (0, 0), 1) - cv2.GaussianBlur(luma, (0, 0), 3))
    E["dog"] = dog
    lines = cv2.createLineSegmentDetector().detect(y8)[0]
    segs = [] if lines is None else [tuple(l[0]) for l in lines]
    segs.sort(key=lambda q: math.hypot(q[2] - q[0], q[3] - q[1]))
    for name, minlen in (("lsd", 0.0), ("lsd-long", 40.0)):
        m = np.zeros(luma.shape, np.float32)
        for x1, y1, x2, y2 in segs:
            ln = math.hypot(x2 - x1, y2 - y1)
            if ln >= minlen:
                cv2.line(m, (int(round(x1)), int(round(y1))), (int(round(x2)), int(round(y2))), float(math.log1p(ln)), 1)
        E[name] = m
    z = pts[..., 2].astype(np.float32)
    lz = np.where(valid, np.log(np.clip(z, 1e-3, None)), 0).astype(np.float32)
    lz[~valid] = float(np.median(lz[valid]))
    E["depth"] = grad_mag(lz)
    nn = nrm.astype(np.float32).copy()
    nn[~valid] = 0
    E["normals"] = edge_multi([nn[..., 0], nn[..., 1], nn[..., 2]], valid, normalise=False)
    t_edge = time.perf_counter()

    F = {"luma": luma, "L*": L, "a*": A, "b*": Bb, "C*": C, "S": S, "V": V, "O1": O1, "O2": O2, "r": r, "g": g,
         "log-chroma": inv, "retinex": retinex, "bilateral-albedo": albedo,
         "edge-density": cv2.blur(E["rgb"], (M4_WIN, M4_WIN)), "dog-energy": cv2.blur(dog, (M4_WIN, M4_WIN)),
         "coherence": coh, "z": z}
    info = {"logChromaAngle": angle, "lsdSegments": len(segs),
            "seconds": {"representations": t_rep - t0, "edges": t_edge - t_rep}}
    return E, F, info


def rank_norm(e: np.ndarray, valid: np.ndarray) -> np.ndarray:
    out = np.zeros(e.shape, np.float32)
    v = e[valid]
    order = np.argsort(v, kind="stable")
    rk = np.empty(len(v), np.float32)
    rk[order] = np.arange(len(v), dtype=np.float32) / max(1, len(v) - 1)
    out[valid] = rk
    return out


# --- scoring ----------------------------------------------------------------------------------------------

def auc(pos: np.ndarray, neg: np.ndarray) -> float | None:
    if len(pos) == 0 or len(neg) == 0:
        return None
    x = np.concatenate([pos, neg]).astype(np.float64)
    order = np.argsort(x, kind="mergesort")
    xs = x[order]
    _, start, counts = np.unique(xs, return_index=True, return_counts=True)
    avg = start + (counts + 1) / 2.0
    ranks = np.empty(len(x))
    ranks[order] = np.repeat(avg, counts)
    u = ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2.0
    return float(u / (len(pos) * len(neg)))


def pick(mask: np.ndarray, rng: np.random.Generator, n: int = MAX_PIX) -> np.ndarray:
    idx = np.flatnonzero(mask)
    return idx if len(idx) <= n else rng.choice(idx, size=n, replace=False)


def poly_px(poly: list, scale: float) -> np.ndarray:
    return np.round(np.asarray(poly, np.float64) * scale).astype(np.int32)


def fill(shape: tuple, polys: list[np.ndarray]) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    if polys:
        cv2.fillPoly(m, polys, 1)
    return m.astype(bool)


def grow(mask: np.ndarray, px: int) -> np.ndarray:
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.dilate(mask.astype(np.uint8), k).astype(bool)


def away(mask: np.ndarray) -> np.ndarray:
    """Distance (px) from the nearest pixel of mask."""
    return cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 3)


def box_geom(poly: np.ndarray) -> dict | None:
    """An upright box's left and right long sides as x(y) lines, its y extent and its width; None if not upright."""
    p = poly.astype(np.float64)
    sides = [(p[i], p[(i + 1) % 4]) for i in range(4)]
    lens = [np.linalg.norm(b - a) for a, b in sides]
    i = int(np.argmax(lens))
    long1, long2 = sides[i], sides[(i + 2) % 4]
    d = long1[1] - long1[0]
    tilt = math.degrees(math.atan2(abs(d[0]), abs(d[1])))
    if tilt > UPRIGHT_DEG:
        return None
    width = float(min(lens[(i + 1) % 4], lens[(i + 3) % 4]))

    def xline(seg):
        (x1, y1), (x2, y2) = seg
        return (lambda y: x1 + (x2 - x1) * (y - y1) / (y2 - y1)) if abs(y2 - y1) > 1e-6 else (lambda y: (x1 + x2) / 2)

    a, b = sorted([long1, long2], key=lambda sg: (sg[0][0] + sg[1][0]) / 2)
    return {"left": xline(a), "right": xline(b), "y0": float(p[:, 1].min()), "y1": float(p[:, 1].max()),
            "cx": float(p[:, 0].mean()), "w": width, "h": float(lens[i])}


def seam_pairs(det: dict, kept: set[str], scale: float) -> list[tuple[dict, dict, float, float]]:
    """Detection records keep a band's polygon and box count, not its members: a box belongs to the first band
    polygon holding its centre (a logged deviation from the pre-registration's "boxes of one band")."""
    bands = [np.asarray(b["polygon"], np.float32) * scale for b in det.get("bands", [])]
    members: list[list[dict]] = [[] for _ in bands]
    for i, s in enumerate(det["spines"]):
        if f"{det['id']}:{i}" not in kept:
            continue
        gm = box_geom(poly_px(s["polygon"], scale))
        if not gm:
            continue
        c = (gm["cx"], (gm["y0"] + gm["y1"]) / 2)
        for k, bp in enumerate(bands):
            if cv2.pointPolygonTest(bp, c, False) >= 0:
                members[k].append(gm)
                break
    pairs = []
    for boxes in members:
        boxes.sort(key=lambda b: b["cx"])
        for a, b in zip(boxes, boxes[1:]):
            y0, y1 = max(a["y0"], b["y0"]), min(a["y1"], b["y1"])
            if y1 - y0 < 0.5 * min(a["y1"] - a["y0"], b["y1"] - b["y0"]):
                continue
            ym = (y0 + y1) / 2
            if b["left"](ym) - a["right"](ym) > 0.5 * min(a["w"], b["w"]):
                continue
            pairs.append((a, b, y0, y1))
    return pairs


def seam_hits(E: dict, pairs: list, valid: np.ndarray) -> tuple[dict, float | None, int]:
    """Per representation, mean over pairs of the share of heights whose profile maximum sits on the seam."""
    h, w = valid.shape
    per = {k: [] for k in E}
    chance = []
    for a, b, y0, y1 in pairs:
        ww = min(a["w"], b["w"])
        half, tol = 0.5 * ww, max(2.0, 0.1 * ww)
        hits = {k: [] for k in E}
        for j in range(M3_HEIGHTS):
            y = y0 + (y1 - y0) * (M3_SPAN[0] + (M3_SPAN[1] - M3_SPAN[0]) * j / (M3_HEIGHTS - 1))
            yi = int(round(y))
            xs = (a["right"](y) + b["left"](y)) / 2
            lo, hi = int(math.floor(xs - half)), int(math.ceil(xs + half))
            if yi < 0 or yi >= h or lo < 0 or hi >= w or hi - lo < 3 or not valid[yi, lo:hi + 1].all():
                continue
            xpos = np.arange(lo, hi + 1)
            chance.append(min(1.0, (2 * tol + 1) / len(xpos)))
            for k, e in E.items():
                prof = e[yi, lo:hi + 1]
                mx = prof.max()
                if mx <= 0:
                    hits[k].append(0.0)
                    continue
                at = xpos[prof >= mx]
                hits[k].append(float(np.all(np.abs(at - xs) <= tol)))
        for k in E:
            if hits[k]:
                per[k].append(float(np.mean(hits[k])))
    n = len(per["rgb"])
    return {k: (float(np.mean(v)) if v else None) for k, v in per.items()}, (float(np.mean(chance)) if chance else None), n


# --- per photo --------------------------------------------------------------------------------------------

def photo(det: dict, image: str, outlines: dict, kept: set[str], geom: Path, classmap: Path, full: bool,
          rng: np.random.Generator, renders: Path | None) -> tuple[dict, dict | None]:
    t0 = time.perf_counter()
    z = np.load(geom)
    pts, nrm, valid, scale = z["points"], z["normal"], z["mask"].astype(bool), float(z["scale"])
    hh, ww = valid.shape
    bgr = cv2.imread(image, cv2.IMREAD_COLOR)
    rgb = cv2.cvtColor(cv2.resize(bgr, (ww, hh), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    valid &= np.isfinite(pts).all(axis=2) & np.isfinite(nrm).all(axis=2) & (pts[..., 2] > 0)
    valid = cv2.erode(valid.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    cls = cv2.imread(str(classmap), cv2.IMREAD_UNCHANGED)
    t_load = time.perf_counter()

    E, F, info = compute(rgb, pts, nrm, valid, rng)
    for name, members in FUSED.items():
        E[name] = np.mean([rank_norm(E[m], valid) for m in members], axis=0)

    n_box = len(det["spines"])
    ids = [f"{det['id']}:{i}" for i in range(n_box)]
    polys = [poly_px(s["polygon"], scale) for s in det["spines"]]
    kept_polys = [p for p, i in zip(polys, ids) if i in kept]
    flag_polys = [p for p, i in zip(polys, ids) if i not in kept]
    kept_mask, flag_mask, all_mask = fill(valid.shape, kept_polys), fill(valid.shape, flag_polys), fill(valid.shape, polys)

    row: dict = {"id": det["id"], "full": full, "info": info, "boxes": n_box, "kept": len(kept_polys),
                 "flagged": len(flag_polys)}
    # M4 classes (per-pixel values)
    book = (cls == FRONT) & kept_mask & ~flag_mask & valid
    z = F.pop("z")
    F["rel-depth"] = (z / max(1e-6, float(np.median(z[book])) if book.any() else 1.0)).astype(np.float32)
    masks = {"flagged": flag_mask & ~kept_mask & valid, "behind": (cls == BEHIND) & kept_mask & valid,
             "under": (cls == UNDER) & kept_mask & valid, "outside": valid & ~grow(all_mask, M4_GROW)}
    bi = pick(book, rng)
    m4 = {}
    samples = {"book": {f: F[f].reshape(-1)[bi] for f in FEATURES}}
    for c, m in masks.items():
        if not full and c != "flagged":
            continue
        ci = pick(m, rng)
        if len(ci) < 50:
            continue
        m4[c] = {f: auc(F[f].reshape(-1)[ci], F[f].reshape(-1)[bi]) for f in FEATURES}
        samples[c] = {f: F[f].reshape(-1)[ci] for f in FEATURES}
    row["m4"] = m4
    row["m4Pixels"] = {"book": int(book.sum()), **{c: int(m.sum()) for c, m in masks.items()}}
    if not full:
        row["seconds"] = time.perf_counter() - t0
        return row, None

    # M1: outline boundaries against book interiors
    outl = [poly_px(outlines[i], scale) for i in ids if i in kept and i in outlines]
    edge = np.zeros(valid.shape, np.uint8)
    cv2.polylines(edge, outl, True, 1, 1)
    edge = edge.astype(bool)
    inside = fill(valid.shape, outl)
    dist_edge = away(edge)
    pos1, neg1 = valid & (dist_edge <= M1_BOUNDARY), inside & valid & (dist_edge >= M1_INTERIOR)
    p1, n1 = pick(pos1, rng), pick(neg1, rng)
    # M2: depth and normal discontinuities in the books' region
    region = grow(inside, M2_GROW) & valid
    tz, tn = np.percentile(E["depth"][region], M2_PCT), np.percentile(E["normals"][region], M2_PCT)
    ref = region & ((E["depth"] >= tz) | (E["normals"] >= tn))
    neg2 = region & (away(ref) >= M2_AWAY)
    p2, n2 = pick(ref, rng), pick(neg2, rng)
    row["m1"] = {k: auc(e.reshape(-1)[p1], e.reshape(-1)[n1]) for k, e in E.items()}
    row["m2"] = {k: auc(e.reshape(-1)[p2], e.reshape(-1)[n2]) for k, e in E.items()}
    row["m2DepthEdgeOnOutline"] = float((grow(edge, 2) & ref).sum() / max(1, ref.sum()))
    # M3: seams between neighbouring upright boxes
    pairs = seam_pairs(det, kept, scale)
    row["m3"], row["m3Chance"], row["m3Pairs"] = seam_hits(E, pairs, valid)
    row["outlines"] = len(outl)
    row["seconds"] = time.perf_counter() - t0
    row["info"]["seconds"]["load"] = t_load - t0
    if renders is not None:
        render(renders, det["id"], rgb, E, valid)
    return row, samples


def render(out: Path, pid: str, rgb: np.ndarray, E: dict, valid: np.ndarray) -> None:
    out.mkdir(parents=True, exist_ok=True)
    tw = 512
    th = int(round(rgb.shape[0] * tw / rgb.shape[1]))
    tiles = [("photo", cv2.resize((rgb[..., ::-1] * 255).astype(np.uint8), (tw, th), interpolation=cv2.INTER_AREA))]
    for k in ALL_REPS:
        e = E[k]
        hi = float(np.percentile(e[valid], 99)) or 1.0
        im = np.clip(e / hi * 255, 0, 255).astype(np.uint8)
        im = cv2.resize(im, (tw, th), interpolation=cv2.INTER_AREA)
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
        cv2.putText(im, k, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)
        tiles.append((k, im))
    cols = 5
    rows = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
    blank = np.zeros((th, tw, 3), np.uint8)
    sheet = np.vstack([np.hstack([t for _, t in r] + [blank] * (cols - len(r))) for r in rows])
    cv2.imwrite(str(out / f"{pid[:16]}.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 85])


# --- aggregation ------------------------------------------------------------------------------------------

def boot(vals: list[float], rng: np.random.Generator) -> dict | None:
    v = np.asarray([x for x in vals if x is not None], np.float64)
    if len(v) == 0:
        return None
    draws = v[rng.integers(0, len(v), size=(REPS, len(v)))].mean(axis=1)
    lo, hi = np.percentile(draws, [2.5, 97.5])
    return {"mean": round(float(v.mean()), 4), "lo": round(float(lo), 4), "hi": round(float(hi), 4), "photos": int(len(v))}


def paired(rows: list[dict], key: str, rep: str, base: str = "rgb", rng: np.random.Generator | None = None) -> dict | None:
    d = [r[key][rep] - r[key][base] for r in rows if r[key].get(rep) is not None and r[key].get(base) is not None]
    return boot(d, rng)


def logistic_lopo(samples: dict[str, dict], feats: list[str], rng: np.random.Generator) -> list[float]:
    """Book (1) against every non-book class pooled (0); leave one photo out; held-out AUC per photo."""
    per = {}
    for pid, s in samples.items():
        X1 = np.column_stack([s["book"][f] for f in feats])
        neg = [np.column_stack([s[c][f] for f in feats]) for c in CLASSES if c in s]
        if not neg:
            continue
        X0 = np.vstack(neg)
        k = 5000
        X1 = X1[rng.choice(len(X1), size=min(k, len(X1)), replace=False)]
        X0 = X0[rng.choice(len(X0), size=min(k, len(X0)), replace=False)]
        per[pid] = (X1, X0)
    out = []
    for held in per:
        tr1 = np.vstack([per[p][0] for p in per if p != held])
        tr0 = np.vstack([per[p][1] for p in per if p != held])
        X = np.vstack([tr1, tr0]).astype(np.float64)
        y = np.concatenate([np.ones(len(tr1)), np.zeros(len(tr0))])
        mu, sd = X.mean(axis=0), X.std(axis=0) + 1e-9
        Xs = np.column_stack([np.ones(len(X)), (X - mu) / sd])
        wv = np.zeros(Xs.shape[1])
        for _ in range(25):  # Newton / IRLS with a small ridge
            p = 1 / (1 + np.exp(-np.clip(Xs @ wv, -30, 30)))
            H = (Xs * (p * (1 - p))[:, None]).T @ Xs + 1e-3 * np.eye(len(wv))
            wv -= np.linalg.solve(H, Xs.T @ (p - y) + 1e-3 * wv)
        sc = lambda Z: np.column_stack([np.ones(len(Z)), (Z - mu) / sd]) @ wv
        out.append(auc(sc(per[held][0]), sc(per[held][1])))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    for k in ("images", "detect", "outlines", "table", "stage", "cache", "out"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args()
    images = {r["id"]: r["image"] for r in read_jsonl(a.images)}
    dets = {d["id"]: d for d in read_jsonl(a.detect) if not d.get("error")}
    outlines = {r["id"]: r["outline"] for r in read_jsonl(a.outlines) if r.get("outline")}
    kept = {r["id"] for r in read_jsonl(a.table)}
    keys = {r["id"]: (r["geometryKey"], r["facesKey"]) for r in read_jsonl(a.stage) if r.get("photo")}
    cache, out = Path(a.cache), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    ids = sorted(set(dets) & set(images) & set(keys))
    sample = sample_ids(ids)
    flagged_photos = [i for i in ids if i not in sample and any(f"{i}:{j}" not in kept for j in range(len(dets[i]["spines"])))]
    s1_cached = any((Path(a.out).parent / "s1").glob("**/*voids*"))
    log(f"{len(ids)} photos; sample {len(sample)}; {len(flagged_photos)} more photos with flagged boxes")

    rows, samples = [], {}
    for n, pid in enumerate(sample + flagged_photos):
        full = pid in sample
        rng = np.random.default_rng([SEED, n])
        gk, fk = keys[pid]
        row, smp = photo(dets[pid], images[pid], outlines, kept, cache / "geometry" / GEOMETRY_DIR / f"{gk}.npz",
                         cache / "faces" / gk / f"{fk}.png", full, rng, None if (a.no_render or not full) else out / "renders")
        rows.append(row)
        if smp is not None:
            samples[pid] = smp
        log(f"photo {n + 1}/{len(sample) + len(flagged_photos)} ({'sample' if full else 'flagged only'}) {row['seconds']:.1f} s")

    with open(out / "per-photo.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    rng = np.random.default_rng(SEED)
    full_rows = [r for r in rows if r["full"]]
    reps = {}
    for k in ALL_REPS:
        reps[k] = {"family": FAMILY[k],
                   "m1": boot([r["m1"][k] for r in full_rows], rng), "m1VsRgb": paired(full_rows, "m1", k, rng=rng),
                   "m2": boot([r["m2"][k] for r in full_rows], rng), "m2VsRgb": paired(full_rows, "m2", k, rng=rng),
                   "m2Circular": k in CIRCULAR_M2,
                   "m3": boot([r["m3"][k] for r in full_rows], rng), "m3VsRgb": paired(full_rows, "m3", k, rng=rng)}
        d2, d3 = reps[k]["m2VsRgb"], reps[k]["m3VsRgb"]
        # M2 is circular for the depth-derived maps, M3 is not (pre-registration)
        reps[k]["carry"] = k != "rgb" and bool((d2 and d2["lo"] > 0 and k not in CIRCULAR_M2) or (d3 and d3["lo"] > 0))
    m4 = {}
    for c in CLASSES:
        rs = rows if c == "flagged" else full_rows
        m4[c] = {}
        for f in FEATURES:
            v = [r["m4"][c][f] for r in rs if c in r["m4"] and r["m4"][c].get(f) is not None]
            b = boot(v, rng)
            if b is None:
                continue
            sep = boot([max(x, 1 - x) for x in v], rng)
            m4[c][f] = {"auc": b, "separation": sep, "bookHigher": b["mean"] < 0.5,
                        "carry": bool(sep["mean"] >= 0.75 and sep["lo"] >= 0.70)}
    m5_ct = logistic_lopo(samples, COLOUR_TEXTURE, np.random.default_rng(SEED))
    m5_d = logistic_lopo(samples, FEATURES, np.random.default_rng(SEED))
    m5 = {"colourTexture": boot(m5_ct, rng), "withDepth": boot(m5_d, rng),
          "depthGain": boot([b - a for a, b in zip(m5_ct, m5_d)], rng)}
    m5["carryDepth"] = bool(m5["depthGain"] and m5["depthGain"]["mean"] >= 0.03)

    secs = [r["seconds"] for r in full_rows]
    metrics = {
        "card": "F-R3", "set": "pilot-000", "note": "machine agreement on cached outlines and depth, never accuracy (INV-17); aggregates only",
        "sample": {"photos": len(full_rows), "rule": "smallest sha256('F-R3/' + photo id)", "flaggedOnlyPhotos": len(flagged_photos)},
        "counts": {"sampleBoxes": sum(r["boxes"] for r in full_rows), "kept": sum(r["kept"] for r in full_rows),
                  "flaggedAllPhotos": sum(r["flagged"] for r in rows), "outlines": sum(r["outlines"] for r in full_rows),
                  "seamPairs": sum(r["m3Pairs"] for r in full_rows)},
        "m2DepthEdgeShareOnOutlines": boot([r["m2DepthEdgeOnOutline"] for r in full_rows], rng),
        "m3Chance": boot([r["m3Chance"] for r in full_rows], rng),
        "representations": reps, "m4": m4, "m5": m5,
        "m4Pixels": {c: sum(r["m4Pixels"][c] for r in (rows if c == "flagged" else full_rows)) for c in ["book"] + CLASSES},
        "logChromaAngleDeg": sorted(r["info"]["logChromaAngle"] for r in full_rows),
        "s1VoidsCached": s1_cached,
        "secondsPerPhoto": {"p50": round(float(np.median(secs)), 2), "max": round(float(np.max(secs)), 2),
                            "representationsP50": round(float(np.median([r["info"]["seconds"]["representations"] for r in full_rows])), 2),
                            "edgesP50": round(float(np.median([r["info"]["seconds"]["edges"] for r in full_rows])), 2)},
    }
    json.dump(metrics, sys.stdout, indent=1)
    print()
    if not a.no_render:
        idx = ["<!doctype html><meta charset=utf-8><title>F-R3 representations</title><body style='background:#111;color:#ddd;font-family:sans-serif'>",
               "<h1>F-R3: edge maps per representation (private)</h1>"]
        for r in full_rows:
            idx.append(f"<h3>photo {html.escape(r['id'][:16])}</h3><img src='{html.escape(r['id'][:16])}.jpg' style='max-width:100%'>")
        (out / "renders" / "index.html").write_text("\n".join(idx))


if __name__ == "__main__":
    main()
