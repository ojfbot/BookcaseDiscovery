"""F-0i: the instance partition, CPU side. Every visible pixel ends up with at most one book.

Steps (pre-registered in evals/F0i/report.md; design docs/models/instance-boundaries.md §5):
  1. gate: on the rasterised outlines, IoU/IoM rules drop duplicates, two-book parents and pieces inside one spine;
     a wide parent with one child becomes its remainder (parent minus child). A box that is the only one in its photo
     accepting a work (cached decision) is never dropped (the accepted-work guard).
  2. plan: connected groups of the pairs still in conflict, a rotated tile per group and square windows on it, with
     each member's prompts. helpers/label/partition.py runs SAM 2.1 on them and caches the logits by job key.
  3. resolve: only pixels two or more members claim change hands: depth override, seam (R3-A evidence: H-2 normals
     plus a Retinex edge map), logit argmax, fallbacks. Validity, refit, exclusive outlines, label maps.
  4. provenance: per contested pair, which step decided its pixels, with the tile and prompts.

Per-box, per-pair and per-photo output goes only under the data root's private/f0i/<set>/; stdout is aggregates.

    python -I resolve.py plan    --set S --detect D --outlines O --table T --decisions C --images I --out DIR
    python -I resolve.py resolve --set S --detect D --outlines O --table T --decisions C --images I --out DIR > m.json
    python -I resolve.py own --requests R --out DIR > crops.jsonl   # the `mask=own` reader crops
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from overlap import (BOOT, CLIP_ACROSS, CLIP_ALONG, CONFLICT_IOS, INTRUDE, SEED, bbox, boot, depth_index,  # noqa: E402
                     geometry, raster, read_jsonl, rect_of)

cv2.setNumThreads(2)

# --- pre-registered constants (evals/F0i/report.md); never changed after a full run ---------------------------------
DUP_IOU, DUP_IOM, DUP_RATIO = 0.5, 0.85, 1.3
NEST_IOM, MERGED_COVER, WHOLE_WIDTHS = 0.8, 0.7, 1.6
PAD_PX, PAD_WIDTHS = 32, 0.3
MIN_SIDE, MAX_SIDE = 301, 602  # 1024 / 3.4 and 1024 / 1.7
ALONG_OVERLAP, RAMP = 0.25, 0.15
MIN_BOX_PX, MIN_MASK_IN = 4, 0.01
DEPTH_CLEAR = 0.05
SEAM_EDGE_W, SEAM_STEP, SEAM_MIN_ROWS, SEAM_MARGIN, ALIGN_DEG = 4.0, 2, 8, 1.25, 15.0
FLAG_KEEP, ABSORB_KEEP, CHANGED_LOSS = 0.6, 0.3, 0.02
LOWRES = 256
SOURCES = ("outline", "gate", "tile-argmax", "seam", "depth", "fallback")
PARTITION_PY = Path(__file__).resolve().parents[1] / "label" / "partition.py"
MODEL = "facebook/sam2.1-hiera-base-plus"


def log(s: str) -> None:
    print(f"[f0i] {s}", file=sys.stderr, flush=True)


def file_hash(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16] if p.exists() else "missing"


# --- boxes and masks -----------------------------------------------------------------------------------------------

class Box:
    __slots__ = ("id", "idx", "rect", "g", "score", "accepted", "band", "mb", "m", "area", "orig_mb", "orig_m",
                 "state", "reason", "role", "of", "children")

    def __init__(self, bid: str, idx: int, spine: dict, outline: list, accepted: str | None, W: int, H: int):
        self.id, self.idx = bid, idx
        self.rect = rect_of(spine["polygon"])
        self.g = geometry(self.rect)
        self.score = float(spine.get("boxScore", 0)) * float(spine.get("maskScore", 1))
        self.accepted = accepted
        self.band = -1
        x0, y0, x1, y1 = bbox(outline, W, H)
        self.mb = (x0, y0, x1, y1)
        self.m = raster(outline, x0, y0, max(x1 - x0, 1), max(y1 - y0, 1)) if x1 > x0 and y1 > y0 else np.zeros((1, 1), bool)
        self.area = int(self.m.sum())
        self.orig_mb, self.orig_m = self.mb, self.m
        self.state, self.reason, self.role, self.of, self.children = "kept", None, "member", None, []

    @property
    def alive(self) -> bool:
        return self.state == "kept"

    def set_mask(self, m: np.ndarray) -> None:
        self.m = m
        self.area = int(m.sum())


def overlap_window(a_bb: tuple, b_bb: tuple) -> tuple | None:
    x0, y0, x1, y1 = max(a_bb[0], b_bb[0]), max(a_bb[1], b_bb[1]), min(a_bb[2], b_bb[2]), min(a_bb[3], b_bb[3])
    return (x0, y0, x1, y1) if x1 > x0 and y1 > y0 else None


def crop_to(m: np.ndarray, bb: tuple, win: tuple) -> np.ndarray:
    return m[win[1] - bb[1]:win[3] - bb[1], win[0] - bb[0]:win[2] - bb[0]]


def inter_px(a: Box, b: Box) -> int:
    w = overlap_window(a.mb, b.mb)
    return int((crop_to(a.m, a.mb, w) & crop_to(b.m, b.mb, w)).sum()) if w else 0


def minus(a: Box, others: list[Box]) -> np.ndarray:
    out = a.m.copy()
    for o in others:
        w = overlap_window(a.mb, o.mb)
        if w:
            out[w[1] - a.mb[1]:w[3] - a.mb[1], w[0] - a.mb[0]:w[2] - a.mb[0]] &= ~crop_to(o.m, o.mb, w)
    return out


def pair_stats(a: Box, b: Box) -> dict | None:
    i = inter_px(a, b)
    if not i or not a.area or not b.area:
        return None
    small = min(a.area, b.area)
    return {"inter": i, "iou": i / (a.area + b.area - i), "iom": i / small, "ratio": max(a.area, b.area) / small}


def conflicts(boxes: list[Box]) -> dict[tuple[int, int], dict]:
    """Pairs of alive boxes whose masks share at least F-R1's conflict share of the smaller one."""
    alive = [b for b in boxes if b.alive and b.area]
    out = {}
    for x in range(len(alive)):
        a = alive[x]
        for y in range(x + 1, len(alive)):
            b = alive[y]
            if not overlap_window(a.mb, b.mb):
                continue
            s = pair_stats(a, b)
            if s and s["iom"] >= CONFLICT_IOS:
                out[(a.idx, b.idx)] = s
    return out


def bands_of(d: dict, boxes: list[Box]) -> dict[int, float]:
    """Row median width per band: median detection-rectangle short side of the boxes centred in it."""
    polys = [np.array(b["polygon"], np.float32) for b in d.get("bands") or [] if b.get("polygon")]
    widths: dict[int, list[float]] = defaultdict(list)
    for b in boxes:
        c = (float(b.g["c"][0]), float(b.g["c"][1]))
        b.band = next((k for k, p in enumerate(polys) if cv2.pointPolygonTest(p, c, False) >= 0), -1)
        widths[b.band].append(b.g["short"])
    photo = float(np.median([b.g["short"] for b in boxes])) if boxes else 0.0
    return {k: (float(np.median(v)) if k >= 0 else photo) for k, v in widths.items()} | {-1: photo}


# --- step 1: the gate -----------------------------------------------------------------------------------------------

def gate(boxes: list[Box], row_w: dict[int, float]) -> dict:
    by = {b.idx: b for b in boxes}
    counts: dict[str, int] = defaultdict(int)

    def sole(b: Box) -> bool:
        if not b.accepted:
            return False
        return sum(1 for o in boxes if o.alive and o.accepted == b.accepted) == 1

    def drop(b: Box, reason: str, of: int | None) -> None:
        b.state, b.reason, b.of = "dropped", reason, of
        counts[reason] += 1

    pairs = conflicts(boxes)
    guarded: set[tuple[int, int]] = set()
    # duplicates, highest IoU first
    dups = sorted(((k, s) for k, s in pairs.items() if s["iou"] >= DUP_IOU or (s["iom"] >= DUP_IOM and s["ratio"] < DUP_RATIO)),
                  key=lambda t: -t[1]["iou"])
    for (i, j), _ in dups:
        a, b = by[i], by[j]
        if not (a.alive and b.alive):
            continue
        win, lose = (a, b) if (a.score, -a.idx) >= (b.score, -b.idx) else (b, a)
        if not sole(lose):
            drop(lose, "duplicate", win.idx)
        elif not sole(win):
            drop(win, "duplicate", lose.idx)
            counts["guard: duplicate swapped"] += 1
        else:
            guarded.add((i, j))
            counts["guard: duplicate kept"] += 1
    # nesting, parents smallest first, on current masks
    alive = sorted((b for b in boxes if b.alive and b.area), key=lambda b: b.area)
    for p in alive:
        if not p.alive:
            continue
        kids = []
        for c in boxes:
            if c is p or not c.alive or not c.area or c.area > p.area or (min(c.idx, p.idx), max(c.idx, p.idx)) in guarded:
                continue
            if not overlap_window(c.mb, p.mb):
                continue
            if inter_px(c, p) / c.area >= NEST_IOM:
                kids.append(c)
        if not kids:
            continue
        if len(kids) >= 2:
            rest = minus(p, kids)
            cover = 1 - rest.sum() / max(p.area, 1)
            if cover >= MERGED_COVER:
                if not sole(p):
                    drop(p, "merged-parent", None)
                else:
                    counts["guard: merged parent kept"] += 1
                continue
            counts["group: children under the cover share"] += 1
            make_remainder(p, kids, rest)
            counts["remainder"] += 1
            continue
        c = kids[0]
        if p.g["short"] <= WHOLE_WIDTHS * row_w.get(p.band, row_w[-1]):
            if not sole(c):
                drop(c, "piece-of", p.idx)
                continue
            counts["guard: piece kept"] += 1
        make_remainder(p, [c], minus(p, [c]))
        counts["remainder"] += 1
    return dict(counts)


def make_remainder(p: Box, kids: list[Box], rest: np.ndarray) -> None:
    p.role, p.children = "remainder", [k.idx for k in kids]
    for k in kids:
        k.role = "group-child" if k.role == "member" else k.role
    p.set_mask(rest)
    if p.area:
        ys, xs = np.nonzero(rest)
        n, lab, st, _ = cv2.connectedComponentsWithStats(rest.astype(np.uint8), connectivity=8)
        big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])) if n > 1 else 0
        yy, xx = np.nonzero(lab == big)
        pts = np.stack([xx + p.mb[0], yy + p.mb[1]], 1).astype(np.float32)
        if len(pts) >= 3:
            p.rect = cv2.minAreaRect(pts)
            p.g = geometry(p.rect)


# --- step 2: groups, tiles and windows ------------------------------------------------------------------------------

def components(pairs: dict[tuple[int, int], dict]) -> list[list[int]]:
    adj: dict[int, set[int]] = defaultdict(set)
    for i, j in pairs:
        adj[i].add(j), adj[j].add(i)
    seen, out = set(), []
    for s in sorted(adj):
        if s in seen:
            continue
        comp, stack = [], [s]
        seen.add(s)
        while stack:
            v = stack.pop()
            comp.append(v)
            for w in adj[v]:
                if w not in seen:
                    seen.add(w), stack.append(w)
        out.append(sorted(comp))
    return out


def contested(members: list[Box], pairs: dict, W: int) -> tuple[np.ndarray, np.ndarray]:
    """Pixels two or more members claim: their keys (y*W+x, sorted) and a claimant matrix [member, pixel]."""
    pos = {b.idx: k for k, b in enumerate(members)}
    keys, who = [], []
    for (i, j) in pairs:
        if i not in pos or j not in pos:
            continue
        a, b = members[pos[i]], members[pos[j]]
        w = overlap_window(a.mb, b.mb)
        if not w:
            continue
        both = crop_to(a.m, a.mb, w) & crop_to(b.m, b.mb, w)
        ys, xs = np.nonzero(both)
        k = (ys + w[1]).astype(np.int64) * W + (xs + w[0])
        keys += [k, k]
        who += [np.full(len(k), pos[i]), np.full(len(k), pos[j])]
    if not keys:
        return np.zeros(0, np.int64), np.zeros((len(members), 0), bool)
    kk, ww = np.concatenate(keys), np.concatenate(who)
    uk, inv = np.unique(kk, return_inverse=True)
    cm = np.zeros((len(members), len(uk)), bool)
    cm[ww, inv] = True
    return uk, cm


class Frame:
    """A group's rotated tile: x across the members' mean long axis, y along it (pointing down the image)."""

    def __init__(self, members: list[Box], pad: float):
        u0 = members[0].g["u"]
        u = np.zeros(2)
        for b in members:
            v = b.g["u"]
            u += v if v @ u0 >= 0 else -v
        u = u / max(np.linalg.norm(u), 1e-9)
        if u[1] < 0:
            u = -u
        self.u, self.n = u, np.array([u[1], -u[0]])
        pts = np.concatenate([contour_pts(b) for b in members])
        c = pts.mean(0)
        R = np.stack([self.n, self.u])
        q = (pts - c) @ R.T
        lo, hi = q.min(0) - pad, q.max(0) + pad
        self.A = np.hstack([R, (-(R @ c) - lo)[:, None]])  # photo -> tile
        self.W, self.H = int(math.ceil(hi[0] - lo[0])), int(math.ceil(hi[1] - lo[1]))

    def to(self, p: np.ndarray) -> np.ndarray:
        return p @ self.A[:, :2].T + self.A[:, 2]

    def back(self, q: np.ndarray) -> np.ndarray:
        return (q - self.A[:, 2]) @ self.A[:, :2]  # R is orthonormal


def contour_pts(b: Box) -> np.ndarray:
    cnts, _ = cv2.findContours(b.m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return np.array([[b.mb[0], b.mb[1]]], float)
    return np.concatenate([c[:, 0, :] for c in cnts]).astype(float) + [b.mb[0], b.mb[1]]


def mask_coords(b: Box, m: np.ndarray | None = None, cap: int | None = None, rng=None) -> np.ndarray:
    ys, xs = np.nonzero(b.m if m is None else m)
    pts = np.stack([xs + b.mb[0], ys + b.mb[1]], 1).astype(float)
    if cap and len(pts) > cap:
        pts = pts[(rng or np.random.default_rng(SEED)).choice(len(pts), cap, replace=False)]
    return pts


def core_peaks(b: Box, core: np.ndarray, fr: Frame) -> list[np.ndarray]:
    """Distance-transform peaks of a member's exclusive core, one per third of its length (photo coords)."""
    use = core if core.any() else b.m
    dt = cv2.distanceTransform(np.pad(use, 1).astype(np.uint8), cv2.DIST_L2, 5)[1:-1, 1:-1]
    ys, xs = np.nonzero(use)
    pts = np.stack([xs + b.mb[0], ys + b.mb[1]], 1).astype(float)
    along = fr.to(pts)[:, 1]
    lo, hi = along.min(), along.max()
    out = []
    for k in range(3):
        sel = (along >= lo + k * (hi - lo) / 3) & (along <= lo + (k + 1) * (hi - lo) / 3)
        if sel.any():
            i = np.flatnonzero(sel)[int(np.argmax(dt[ys[sel], xs[sel]]))]
            out.append(pts[i])
    return out


def plan_group(members: list[Box], ckeys: np.ndarray, W: int, medw: float) -> dict:
    pad = max(PAD_PX, PAD_WIDTHS * medw)
    fr = Frame(members, pad)
    cpts = np.stack([ckeys % W, ckeys // W], 1).astype(float)
    cq = fr.to(cpts)
    cores, peaks, samples, spans = [], [], [], []
    for b in members:
        ys, xs = np.nonzero(b.m)
        k = (ys + b.mb[1]).astype(np.int64) * W + (xs + b.mb[0])
        core = b.m.copy()
        hit = np.isin(k, ckeys, assume_unique=False)
        core[ys[hit], xs[hit]] = False
        cores.append(core)
        peaks.append(core_peaks(b, core, fr))
        s = fr.to(mask_coords(b, cap=4000))
        samples.append(s)
        spans.append((s[:, 0].min(), s[:, 0].max()))
    order = sorted(range(len(members)), key=lambda k: (spans[k][0] + spans[k][1]) / 2)
    # across-subgroups of consecutive members, neighbours sharing one member
    subs, i = [], 0
    while i < len(order):
        j = i + 1
        while j < len(order) and (max(spans[order[t]][1] for t in range(i, j + 1)) - min(spans[order[t]][0] for t in range(i, j + 1)) + 2 * pad) <= MAX_SIDE:
            j += 1
        j = max(j, min(i + 2, len(order)))  # at least a pair when one is left to pair with
        subs.append(order[i:j])
        if j >= len(order):
            break
        i = j - 1
    windows = []
    for sub in subs:
        a = min(spans[k][0] for k in sub) - pad
        b = max(spans[k][1] for k in sub) + pad
        width = b - a
        if width <= MAX_SIDE:
            S = int(round(min(max(width, MIN_SIDE), MAX_SIDE)))
            cols = [(a + b) / 2 - S / 2]
        else:
            S = MAX_SIDE
            n = int(math.ceil((width - S) / (S * (1 - ALONG_OVERLAP)))) + 1
            cols = list(np.linspace(a, b - S, n))
        n_rows = max(1, int(math.ceil((fr.H - S) / (S * (1 - ALONG_OVERLAP)))) + 1) if fr.H > S else 1
        rows = list(np.linspace(0, max(fr.H - S, 0), n_rows)) if fr.H > S else [(fr.H - S) / 2]
        for x0 in cols:
            for y0 in rows:
                inside = (cq[:, 0] >= x0) & (cq[:, 0] < x0 + S) & (cq[:, 1] >= y0) & (cq[:, 1] < y0 + S)
                if not inside.any():
                    continue  # no contested pixel: nothing for this window to decide (logged deviation)
                Aw = fr.A.copy()
                Aw[:, 2] -= [x0, y0]
                pick, boxes, pts, labs = [], [], [], []
                for k in sub:
                    m = members[k]
                    corners = fr.to(cv2.boxPoints(m.rect).astype(float)) - [x0, y0]
                    bx0, by0 = np.clip(corners.min(0), 0, S)
                    bx1, by1 = np.clip(corners.max(0), 0, S)
                    s = samples[k] - [x0, y0]
                    share = float(((s[:, 0] >= 0) & (s[:, 0] < S) & (s[:, 1] >= 0) & (s[:, 1] < S)).mean())
                    if bx1 - bx0 >= MIN_BOX_PX and by1 - by0 >= MIN_BOX_PX and share >= MIN_MASK_IN:
                        pick.append(k)
                        boxes.append([round(float(v), 1) for v in (bx0, by0, bx1, by1)])
                if len(pick) < 2:
                    continue
                for k in pick:
                    pos = [q for q in (fr.to(np.array(peaks[k])) - [x0, y0] if peaks[k] else []) if 0 <= q[0] < S and 0 <= q[1] < S]
                    if not pos:  # the core's peak inside the window
                        cq_k = fr.to(mask_coords(members[k], cores[k] if cores[k].any() else None, cap=4000)) - [x0, y0]
                        ins = cq_k[(cq_k[:, 0] >= 0) & (cq_k[:, 0] < S) & (cq_k[:, 1] >= 0) & (cq_k[:, 1] < S)]
                        if len(ins):
                            pos = [ins[np.argmin(np.abs(ins[:, 0] - np.median(ins[:, 0])) + np.abs(ins[:, 1] - np.median(ins[:, 1])))]]
                    neg = []
                    for o in pick:
                        if o == k or not peaks[o]:
                            continue
                        qs = fr.to(np.array(peaks[o])) - [x0, y0]
                        qs = [q for q in qs if 0 <= q[0] < S and 0 <= q[1] < S]
                        if qs:
                            mid = len(peaks[o]) // 2
                            q_mid = fr.to(np.array([peaks[o][mid]]))[0] - [x0, y0]
                            neg.append(q_mid if 0 <= q_mid[0] < S and 0 <= q_mid[1] < S else qs[0])
                    pts.append([[round(float(v), 1) for v in q] for q in pos + neg])
                    labs.append([1] * len(pos) + [0] * len(neg))
                windows.append({"affine": [[round(float(v), 6) for v in r] for r in Aw], "side": S,
                                "members": [members[k].idx for k in pick], "boxes": boxes, "points": pts, "labels": labs,
                                "contested": int(inside.sum())})
    return {"frame": fr, "windows": windows, "cores": cores, "pad": pad}


def group_key(photo: str, members: list[Box], windows: list[dict]) -> str:
    h = hashlib.sha256(json.dumps({"model": MODEL, "partition": file_hash(PARTITION_PY), "photo": photo,
                                   "members": [b.idx for b in members], "windows": windows}, sort_keys=True).encode())
    return h.hexdigest()[:20]


# --- per-photo evidence: depth, normals and Retinex edges (H-2's map resolution) ------------------------------------

class Evidence:
    def __init__(self, npz: Path | None, image: str, W: int):
        self.ok = False
        if npz is None or not Path(npz).exists():
            return
        z = np.load(npz)
        pts, nrm, valid = z["points"].astype(np.float32), z["normal"].astype(np.float32), z["mask"].astype(bool)
        self.scale = float(z["scale"]) if "scale" in z else pts.shape[1] / W
        h, w = valid.shape
        self.z = np.where(valid, pts[..., 2], np.nan)
        self.valid = valid
        img = cv2.imread(image, cv2.IMREAD_COLOR)
        if img is None:
            return
        small = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        luma = 0.299 * small[..., 2] + 0.587 * small[..., 1] + 0.114 * small[..., 0]
        logY = np.log(luma + 1.0 / 255)
        retinex = np.mean([logY - np.log(cv2.GaussianBlur(luma, (0, 0), s) + 1.0 / 255) for s in (8, 32, 128)], axis=0)
        nn = nrm.copy()
        nn[~valid] = 0
        self.ng = [grad_xy(nn[..., c]) for c in range(3)]
        self.rg = grad_xy(retinex.astype(np.float32))
        nmag = np.sqrt(sum(gx * gx + gy * gy for gx, gy in self.ng))
        rmag = np.sqrt(self.rg[0] ** 2 + self.rg[1] ** 2)
        self.nref, self.rref = np.sort(nmag[valid]), np.sort(rmag[valid])
        self.ok = len(self.nref) > 100
        del img

    def sample_idx(self, p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        x = np.clip((p[:, 0] * self.scale).astype(int), 0, self.valid.shape[1] - 1)
        y = np.clip((p[:, 1] * self.scale).astype(int), 0, self.valid.shape[0] - 1)
        return y, x

    def depth(self, p: np.ndarray) -> np.ndarray:
        y, x = self.sample_idx(p)
        return self.z[y, x]

    def edge(self, p: np.ndarray, n: np.ndarray, only: str | None = None) -> np.ndarray:
        """R3-A evidence at photo points for edges running along the axis (gradient across it, within 15°).

        `only` ("normals" or "retinex") gives one map alone: the reported per-source seam strata, never a decision."""
        y, x = self.sample_idx(p)
        cos = math.cos(math.radians(ALIGN_DEG))
        pn = np.sqrt(sum((gx[y, x] * n[0] + gy[y, x] * n[1]) ** 2 for gx, gy in self.ng))
        fn = np.sqrt(sum(gx[y, x] ** 2 + gy[y, x] ** 2 for gx, gy in self.ng))
        pr = np.abs(self.rg[0][y, x] * n[0] + self.rg[1][y, x] * n[1])
        fr = np.sqrt(self.rg[0][y, x] ** 2 + self.rg[1][y, x] ** 2)
        rn = np.where(pn >= cos * fn, np.searchsorted(self.nref, pn) / len(self.nref), 0.0)
        rr = np.where(pr >= cos * fr, np.searchsorted(self.rref, pr) / len(self.rref), 0.0)
        return rn if only == "normals" else rr if only == "retinex" else 0.5 * (rn + rr)


class Classical:
    """The classical seam arm (reported only): across-axis luma gradient at full resolution, ranked per photo."""

    def __init__(self, image: str):
        g = cv2.imread(image, cv2.IMREAD_GRAYSCALE)
        self.ok = g is not None
        if not self.ok:
            return
        self.luma = g
        gx, gy = grad_xy(g.astype(np.float32) / 255.0)
        mag = np.sqrt(gx * gx + gy * gy).ravel()
        self.ref = np.sort(np.random.default_rng(SEED).choice(mag, min(200_000, len(mag)), replace=False))
        del gx, gy, mag

    def edge(self, p: np.ndarray, n: np.ndarray) -> np.ndarray:
        x0, y0 = max(int(p[:, 0].min()) - 4, 0), max(int(p[:, 1].min()) - 4, 0)
        x1, y1 = min(int(p[:, 0].max()) + 5, self.luma.shape[1]), min(int(p[:, 1].max()) + 5, self.luma.shape[0])
        gx, gy = grad_xy(self.luma[y0:y1, x0:x1].astype(np.float32) / 255.0)
        xi = np.clip(np.round(p[:, 0]).astype(int) - x0, 0, x1 - x0 - 1)
        yi = np.clip(np.round(p[:, 1]).astype(int) - y0, 0, y1 - y0 - 1)
        a, b = gx[yi, xi], gy[yi, xi]
        pr, fr = np.abs(a * n[0] + b * n[1]), np.sqrt(a * a + b * b)
        return np.where(pr >= math.cos(math.radians(ALIGN_DEG)) * fr, np.searchsorted(self.ref, pr) / len(self.ref), 0.0)


def grad_xy(ch: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    g = cv2.GaussianBlur(ch.astype(np.float32), (0, 0), 1.0)
    return cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)


# --- step 3: resolve ------------------------------------------------------------------------------------------------

def blended_logits(pts: np.ndarray, members: list[Box], windows: list[dict], logits: dict | None) -> np.ndarray:
    """Per member, the border-weighted mean of its window logits at photo points (NaN where no window prompted it)."""
    out = np.full((len(members), len(pts)), np.nan, np.float32)
    if not logits:
        return out
    pos = {b.idx: k for k, b in enumerate(members)}
    num = np.zeros((len(members), len(pts)), np.float64)
    den = np.zeros((len(members), len(pts)), np.float64)
    for w_i, w in enumerate(windows):
        arr = logits.get(f"w{w_i}")
        if arr is None:
            continue
        A, S = np.array(w["affine"]), float(w["side"])
        q = pts @ A[:, :2].T + A[:, 2]
        ins = (q[:, 0] >= 0) & (q[:, 0] < S) & (q[:, 1] >= 0) & (q[:, 1] < S)
        if not ins.any():
            continue
        border = np.minimum.reduce([q[:, 0], q[:, 1], S - q[:, 0], S - q[:, 1]])
        wt = np.clip(border / (RAMP * S), 1e-3, 1.0) * ins
        cx = (q[:, 0] + 0.5) * LOWRES / S - 0.5
        cy = (q[:, 1] + 0.5) * LOWRES / S - 0.5
        for m_i, idx in enumerate(w["members"]):
            v = bilinear(arr[m_i].astype(np.float32), cx, cy)
            k = pos[idx]
            num[k] += wt * v
            den[k] += wt
    have = den > 0
    out[have] = (num[have] / den[have]).astype(np.float32)
    return out


def bilinear(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Bilinear samples of a 2-D array at float coordinates, edges replicated."""
    h, w = img.shape
    x, y = np.clip(x, 0, w - 1), np.clip(y, 0, h - 1)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
    fx, fy = x - x0, y - y0
    return ((img[y0, x0] * (1 - fx) + img[y0, x1] * fx) * (1 - fy) + (img[y1, x0] * (1 - fx) + img[y1, x1] * fx) * fy)


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))


def seam_runs(q: np.ndarray, pa: np.ndarray, pb: np.ndarray, edge_at) -> list[dict]:
    """Minimum-cost seams along tile rows for one two-member contested set (a left of b).

    q: tile coords of the contested pixels; pa, pb: each member's probability there. A pixel goes to a when its
    across coordinate is below the row's seam position. Returns runs with their pixel indices and assignment."""
    rows = np.round(q[:, 1]).astype(int)
    order = np.argsort(rows, kind="stable")
    rws = rows[order]
    uniq, start = np.unique(rws, return_index=True)
    ends = list(start[1:]) + [len(rws)]
    runs, cur = [], []
    for r, s, e in zip(uniq, start, ends):
        if cur and r - cur[-1][0] > 2:
            runs.append(cur)
            cur = []
        cur.append((r, order[s:e]))
    if cur:
        runs.append(cur)
    out = []
    for run in runs:
        if len(run) < SEAM_MIN_ROWS:
            out.append({"idx": np.concatenate([ix for _, ix in run]), "seam": None})
            continue
        cand, cost = [], []
        for r, ix in run:
            xs = q[ix, 0]
            c = np.arange(int(math.floor(xs.min())), int(math.ceil(xs.max())) + 2)
            srt = np.argsort(xs)
            xs_s, to_a, to_b = xs[srt], np.maximum(0, pb[ix] - pa[ix])[srt], np.maximum(0, pa[ix] - pb[ix])[srt]
            k = np.searchsorted(xs_s, c, side="left")  # pixels left of position c go to a
            ca = np.concatenate([[0], np.cumsum(to_a)])
            cb = np.concatenate([[0], np.cumsum(to_b)])
            dis = ca[k] + (cb[-1] - cb[k])
            e = edge_at(np.stack([c - 0.5, np.full(len(c), float(r))], 1))
            cand.append((c, e))
            cost.append(dis - SEAM_EDGE_W * e)
        # dynamic program over rows, |step| <= SEAM_STEP
        acc = [cost[0]]
        back = []
        for t in range(1, len(run)):
            c_prev, c_now = cand[t - 1][0], cand[t][0]
            best = np.full(len(c_now), np.inf)
            arg = np.zeros(len(c_now), int)
            for d in range(-SEAM_STEP, SEAM_STEP + 1):
                j = np.searchsorted(c_prev, c_now + d)
                ok = (j < len(c_prev)) & (c_prev[np.minimum(j, len(c_prev) - 1)] == c_now + d)
                v = np.where(ok, acc[-1][np.minimum(j, len(c_prev) - 1)], np.inf)
                better = v < best
                best[better], arg[better] = v[better], np.minimum(j, len(c_prev) - 1)[better]
            if not np.isfinite(best).any():  # rows that cannot connect: restart the path here
                best = np.zeros(len(c_now))
                arg[:] = -1
            acc.append(best + cost[t])
            back.append(arg)
        path = [int(np.argmin(acc[-1]))]
        for t in range(len(run) - 1, 0, -1):
            j = back[t - 1][path[-1]]
            path.append(int(j) if j >= 0 else int(np.argmin(acc[t - 1])))
        path = path[::-1]
        seam_e = np.array([cand[t][1][path[t]] for t in range(len(run))])
        assign_a = []
        idx_all = []
        for t, (r, ix) in enumerate(run):
            s = cand[t][0][path[t]]
            idx_all.append(ix)
            assign_a.append(q[ix, 0] < s)
        out.append({"idx": np.concatenate(idx_all), "toA": np.concatenate(assign_a), "seamEdge": float(seam_e.mean()),
                    "rows": len(run)})
    return out


def resolve_group(members: list[Box], pairs: dict, plan: dict, logits: dict | None, ev: Evidence, cl: Classical | None,
                  W: int, tile_id: str) -> dict:
    keys, cm = contested(members, pairs, W)
    M, n = cm.shape
    owner = np.full(n, -1, int)
    source = np.zeros(n, np.int8)  # index into SOURCES; 0 = undecided
    pts = np.stack([keys % W, keys // W], 1).astype(float)
    L = blended_logits(pts, members, plan["windows"], logits)
    P = sigmoid(np.nan_to_num(L, nan=0.0))
    fr: Frame = plan["frame"]
    q = fr.to(pts)
    cores = plan["cores"]
    ncl = cm.sum(0)
    zmed = [None] * M
    if ev.ok:
        for k, b in enumerate(members):
            z = ev.depth(mask_coords(b, cores[k] if cores[k].any() else None, cap=20000))
            z = z[np.isfinite(z)]
            zmed[k] = float(np.median(z)) if z.size >= 5 else None
    zpix = ev.depth(pts) if ev.ok else np.full(n, np.nan)
    seam_stats = {"runs": 0, "strong": 0, "classicalStrong": 0, "classicalDiffer": 0, "seamPixels": 0, "classicalCompared": 0}
    two = np.flatnonzero(ncl == 2)
    first = cm[:, two].argmax(0)
    second = M - 1 - cm[::-1, two].argmax(0)
    pk = first * M + second
    centroid = [fr.to(mask_coords(b, cores[k] if cores[k].any() else None, cap=4000)).mean(0) for k, b in enumerate(members)]
    S_ = {s: i for i, s in enumerate(SOURCES)}
    rows_out, pair_ix = [], []
    for code in np.unique(pk):
        a, b = int(code // M), int(code % M)
        ix = two[pk == code]
        pair_ix.append((a, b, ix))
        rec = {"a": members[a].id, "b": members[b].id, "tile": tile_id, "contested": int(len(ix))}
        za, zb = zmed[a], zmed[b]
        if za is not None and zb is not None and abs(za - zb) / max(min(za, zb), 1e-6) >= DEPTH_CLEAR:
            zz = zpix[ix]
            ok = np.isfinite(zz)
            near_a = np.abs(zz - za) <= np.abs(zz - zb)
            owner[ix[ok]] = np.where(near_a[ok], a, b)
            source[ix[ok]] = S_["depth"]
            rec["depthGap"] = round(abs(za - zb) / max(min(za, zb), 1e-6), 4)
            ix = ix[~ok]
        dx, dy = centroid[b] - centroid[a]
        if len(ix) and ev.ok and abs(dx) >= abs(dy):
            left, right = (a, b) if dx >= 0 else (b, a)
            runs = seam_runs(q[ix], P[left, ix], P[right, ix], lambda t: ev.edge(fr.back(t), fr.n))
            alt = seam_runs(q[ix], P[left, ix], P[right, ix], lambda t: cl.edge(fr.back(t), fr.n)) if cl and cl.ok else None
            rec["seamRuns"], rec["strongRuns"], rec["runs"] = 0, 0, []
            # reported only (evals/F0i addendum): would each evidence map alone, with its own seam, pass the margin?
            alone = {}
            for src in ("normals", "retinex"):
                rs = seam_runs(q[ix], P[left, ix], P[right, ix], lambda t, src=src: ev.edge(fr.back(t), fr.n, src))
                alone[src] = [r["seamEdge"] >= SEAM_MARGIN * max(float(ev.edge(pts[ix[r["idx"]]], fr.n, src).mean()), 1e-6)
                              if "toA" in r else None for r in rs]
            for r_i, run in enumerate(runs):
                if "toA" not in run:
                    continue
                seam_stats["runs"] += 1
                rec["seamRuns"] += 1
                sub = ix[run["idx"]]
                strong = run["seamEdge"] >= SEAM_MARGIN * max(float(ev.edge(pts[sub], fr.n).mean()), 1e-6)
                run_rec = {"rows": run["rows"], "pixels": int(len(sub)), "strong": bool(strong),
                           "normals": alone["normals"][r_i], "retinex": alone["retinex"][r_i]}
                rec["runs"].append(run_rec)
                mine = np.where(run["toA"], left, right) if strong else np.where(P[left, sub] >= P[right, sub], left, right)
                if strong:
                    seam_stats["strong"] += 1
                    seam_stats["seamPixels"] += len(sub)
                    rec["strongRuns"] += 1
                    owner[sub] = mine
                    source[sub] = S_["seam"]
                if alt is not None and "toA" in alt[r_i]:
                    ar = alt[r_i]  # same rows and pixels: the runs depend only on the pixel layout
                    a_strong = ar["seamEdge"] >= SEAM_MARGIN * max(float(cl.edge(pts[ix[ar["idx"]]], fr.n).mean()), 1e-6)
                    seam_stats["classicalStrong"] += int(a_strong)
                    run_rec["luma"] = bool(a_strong)
                    other = np.empty(len(ix), int)
                    other[ar["idx"]] = np.where(ar["toA"], left, right) if a_strong else \
                        np.where(P[left, ix[ar["idx"]]] >= P[right, ix[ar["idx"]]], left, right)
                    seam_stats["classicalCompared"] += len(sub)
                    seam_stats["classicalDiffer"] += int((other[run["idx"]] != mine).sum())
        rows_out.append(rec)
    # logit argmax among claimants with logits (also three or more claimants)
    und = np.flatnonzero(owner < 0)
    if len(und):
        Lc = np.where(cm[:, und] & np.isfinite(L[:, und]), L[:, und], -np.inf)
        has = np.isfinite(Lc).any(0)
        owner[und[has]] = Lc[:, has].argmax(0)
        source[und[has]] = S_["tile-argmax"]
    # fallbacks: nearest exclusive core, then box score x mask score
    und = np.flatnonzero(owner < 0)
    if len(und):
        D = np.full((M, len(und)), np.inf)
        for k, b in enumerate(members):
            core = cores[k] if cores[k].any() else b.m
            d = cv2.distanceTransform(np.pad(~core, 1).astype(np.uint8), cv2.DIST_L2, 5)[1:-1, 1:-1]
            x = pts[und, 0].astype(int) - b.mb[0]
            y = pts[und, 1].astype(int) - b.mb[1]
            ok = (x >= 0) & (y >= 0) & (x < d.shape[1]) & (y < d.shape[0]) & cm[k, und]
            D[k, ok] = d[y[ok], x[ok]] - 1e-6 * members[k].score
        has = np.isfinite(D).any(0)
        owner[und[has]] = D[:, has].argmin(0)
        sc = np.array([m.score for m in members])
        for i in und[~has]:
            owner[i] = int(np.flatnonzero(cm[:, i])[np.argmax(sc[cm[:, i]])])
        source[und] = S_["fallback"]
    for rec, (a, b, ix) in zip(rows_out, pair_ix):
        rec["bySource"] = {SOURCES[s]: int((source[ix] == s).sum()) for s in range(len(SOURCES)) if (source[ix] == s).any()}
        la, lb = L[a, ix], L[b, ix]
        ok = np.isfinite(la) & np.isfinite(lb)
        rec["logitMargin"] = round(float(np.median(np.abs(la[ok] - lb[ok]))), 3) if ok.any() else None
    return {"keys": keys, "owner": owner, "source": source, "cm": cm, "pairs": rows_out, "seam": seam_stats,
            "multi": int((ncl >= 3).sum())}


def end_sources(b: Box, src_code: np.ndarray, W: int) -> dict:
    """For F-0m: did the outline's top or bottom end (along the detection axis; top = up the image) move by more than
    2 px in the partition, and which step moved it (the commonest source among the pixels it lost there)?"""
    u = geometry(rect_of(cv2.boxPoints(b.rect)))["u"]  # points down the image
    o = mask_coords(b, b.orig_m if b.orig_mb == b.mb else None) if b.orig_m is not None else None
    f = mask_coords(b)
    out = {"top": "outline", "bottom": "outline"}
    if o is None or not len(o) or not len(f):
        return out
    ao, af = o @ u, f @ u
    lost = b.orig_m & ~b.m if b.orig_mb == b.mb else np.zeros_like(b.m)
    ly, lx = np.nonzero(lost)
    lp = np.stack([lx + b.mb[0], ly + b.mb[1]], 1).astype(float)
    la = lp @ u if len(lp) else np.zeros(0)
    span = max(ao.max() - ao.min(), 1.0)
    for end, moved, near in (("top", af.min() - ao.min() > 2, la <= ao.min() + 0.05 * span),
                             ("bottom", ao.max() - af.max() > 2, la >= ao.max() - 0.05 * span)):
        if moved and near.any():
            codes = src_code[((ly[near] + b.mb[1]).astype(np.int64)) * W + lx[near] + b.mb[0]]
            out[end] = SOURCES[int(np.bincount(codes, minlength=len(SOURCES)).argmax())]
    return out


def outline_of(mask: np.ndarray, x0: int, y0: int) -> list[list[float]] | None:
    """Largest outer contour, lossless (no simplification), back in photo pixels."""
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    c = max(cnts, key=cv2.contourArea)[:, 0, :]
    return [[float(x + x0), float(y + y0)] for x, y in c] if len(c) >= 3 else None


def clipped_mask(b: Box) -> np.ndarray:
    g = b.rect
    gr = (g[0], (g[1][0] * (1 + (CLIP_ALONG if g[1][0] >= g[1][1] else CLIP_ACROSS)),
                 g[1][1] * (1 + (CLIP_ALONG if g[1][1] > g[1][0] else CLIP_ACROSS))), g[2])
    x0, y0, x1, y1 = b.mb
    return b.m & raster(cv2.boxPoints(gr), x0, y0, x1 - x0, y1 - y0)


# --- per photo ------------------------------------------------------------------------------------------------------

def load_photo(d: dict, keep: set, outlines: dict, decisions: dict) -> list[Box]:
    W, H = d["width"], d["height"]
    out = []
    for i, s in enumerate(d["spines"]):
        bid = f"{d['id']}:{i}"
        if bid not in keep or bid not in outlines or len(outlines[bid]) < 3:
            continue
        out.append(Box(bid, i, s, outlines[bid], decisions.get(bid), W, H))
    return out


def setup(d: dict, keep: set, outlines: dict, decisions: dict):
    boxes = load_photo(d, keep, outlines, decisions)
    row_w = bands_of(d, boxes)
    counts = gate(boxes, row_w)
    pairs = conflicts(boxes)
    alive = {b.idx: b for b in boxes if b.alive}
    groups = components(pairs)
    medw = row_w[-1]
    plans = []
    for g in groups:
        members = [alive[i] for i in g]
        keys, _ = contested(members, pairs, d["width"])
        plan = plan_group(members, keys, d["width"], medw)
        plan["key"] = group_key(d["id"], members, plan["windows"])
        plan["members"] = members
        plans.append(plan)
    return boxes, counts, pairs, plans


def cmd_plan(a, sets) -> None:
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    images = {r["id"]: r["image"] for r in read_jsonl(a.images)}
    n_win = n_grp = 0
    with open(out / "gate.jsonl", "w") as fg, open(out / "groups.jsonl", "w") as fq:
        for d, keep, outlines, decisions in sets:
            t0 = time.time()
            boxes, counts, pairs, plans = setup(d, keep, outlines, decisions)
            for b in boxes:
                fg.write(json.dumps({"id": b.id, "state": b.state, "reason": b.reason, "role": b.role,
                                     "of": f"{d['id']}:{b.of}" if b.of is not None else None,
                                     "children": [f"{d['id']}:{c}" for c in b.children]}) + "\n")
            for k, p in enumerate(plans):
                fq.write(json.dumps({"key": p["key"], "photo": d["id"], "image": images[d["id"]], "group": k,
                                     "members": [m.id for m in p["members"]], "windows": p["windows"]}) + "\n")
                n_win += len(p["windows"])
            n_grp += len(plans)
            log(f"plan {d['id'][:8]}: {len(boxes)} boxes, {sum(not b.alive for b in boxes)} gated, {len(plans)} groups, "
                f"{sum(len(p['windows']) for p in plans)} windows, {time.time() - t0:.1f} s")
    log(f"plan: {n_grp} groups, {n_win} windows")


def cmd_resolve(a, sets) -> None:
    out = Path(a.out)
    (out / "labels").mkdir(parents=True, exist_ok=True)
    images = {r["id"]: r["image"] for r in read_jsonl(a.images)}
    depth = depth_index(a.images)
    logits_dir = out / "logits"
    photos, rows_all = [], []
    gate_counts: dict[str, int] = defaultdict(int)
    prov = defaultdict(int)
    blen = defaultdict(int)
    seam_tot = defaultdict(int)
    fp, fb = open(out / "partition.jsonl", "w"), open(out / "boundaries.jsonl", "w")
    for d, keep, outlines, decisions in sets:
        t0 = time.time()
        W, H = d["width"], d["height"]
        boxes, counts, pairs, plans = setup(d, keep, outlines, decisions)
        for k, v in counts.items():
            gate_counts[k] += v
        ev = Evidence(depth.get(d["id"]), images[d["id"]], W)
        cl = Classical(images[d["id"]]) if a.classical else None
        lost: dict[int, list[np.ndarray]] = defaultdict(list)
        src_px: list[tuple[np.ndarray, np.ndarray]] = []
        missing = 0
        for g_i, p in enumerate(plans):
            lp = logits_dir / f"{p['key']}.npz"
            lg = dict(np.load(lp)) if lp.exists() else None
            if lg is None and p["windows"]:
                missing += 1
            r = resolve_group(p["members"], pairs, p, lg, ev, cl, W, p["key"])
            for k, v in r["seam"].items():
                seam_tot[k] += v
            seam_tot["multiClaimPixels"] += r["multi"]
            for rec in r["pairs"]:
                rec["windows"] = [{"affine": w["affine"], "side": w["side"], "members": [f"{d['id']}:{m}" for m in w["members"]],
                                   "boxes": w["boxes"], "points": w["points"], "labels": w["labels"]}
                                  for w in p["windows"] if {rec["a"], rec["b"]} <= {f"{d['id']}:{m}" for m in w["members"]}]
                rec["model"] = MODEL
                rec["photo"] = d["id"]
                rec["after"] = 0
                fb.write(json.dumps(rec) + "\n")
            for s_i, s in enumerate(SOURCES):
                prov[s] += int((r["source"] == s_i).sum())
            # every claimant that is not the owner loses the pixel
            for k in range(r["cm"].shape[0]):
                gone = r["cm"][k] & (r["owner"] != k)
                if gone.any():
                    lost[p["members"][k].idx].append(r["keys"][gone])
            src_px.append((r["keys"], r["source"]))
        by = {b.idx: b for b in boxes}
        post_gate = {b.idx: (b.mb, b.m.copy(), b.area) for b in boxes if b.alive}
        for idx, ks in lost.items():
            b = by[idx]
            kk = np.concatenate(ks)
            m = b.m.copy()
            ys, xs = kk // W - b.mb[1], kk % W - b.mb[0]
            m[ys, xs] = False
            b.set_mask(m)
        src_code = np.zeros(H * W, np.int8)
        for b in boxes:  # boundaries the gate drew: a remainder's edge against the children taken out of it
            if b.role == "remainder" and b.idx in post_gate:
                x0, y0, x1, y1 = b.orig_mb
                took = b.orig_m & ~crop_to(post_gate[b.idx][1], post_gate[b.idx][0], b.orig_mb) if \
                    overlap_window(b.orig_mb, post_gate[b.idx][0]) == b.orig_mb else b.orig_m.copy()
                ys, xs = np.nonzero(took)
                src_code[(ys + y0).astype(np.int64) * W + xs + x0] = SOURCES.index("gate")
        for keys, src in src_px:
            src_code[keys] = src
        # validity, refit, outlines
        label = np.zeros((H, W), np.uint16)
        recs = []
        for b in boxes:
            rec = {"id": b.id, "state": b.state, "reason": b.reason, "role": b.role, "changed": False, "flagged": False}
            if b.alive:
                _, m0, a0 = post_gate[b.idx]
                b_tmp_m, b.m = b.m, m0
                clip0 = clipped_mask(b)
                b.m = b_tmp_m
                keep_share = float((b.m & clip0).sum() / max(clip0.sum(), 1))
                rec["keptShare"] = round(keep_share, 4)
                rec["lostPx"] = int(a0 - b.area)
                if keep_share < ABSORB_KEEP:
                    sole = b.accepted and sum(1 for o in boxes if o.alive and o.accepted == b.accepted) == 1
                    if sole:
                        rec["flagged"] = True
                        gate_counts["guard: absorbed kept"] += 1
                    else:
                        b.state, b.reason = "dropped", "absorbed"
                        rec["state"], rec["reason"] = "dropped", "absorbed"
                        gate_counts["absorbed"] += 1
                elif keep_share < FLAG_KEEP:
                    rec["flagged"] = True
            if b.alive:
                rec["changed"] = b.role == "remainder" or (a0 - b.area) >= CHANGED_LOSS * max(a0, 1)
                if rec["changed"] and b.area:
                    n, lab, st, _ = cv2.connectedComponentsWithStats(b.m.astype(np.uint8), connectivity=8)
                    big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])) if n > 1 else 0
                    yy, xx = np.nonzero(lab == big)
                    pts = np.stack([xx + b.mb[0], yy + b.mb[1]], 1).astype(np.float32)
                    if len(pts) >= 3:
                        rec["refit"] = [[round(float(x), 1), round(float(y), 1)] for x, y in cv2.boxPoints(cv2.minAreaRect(pts))]
                rec["ends"] = end_sources(b, src_code, W)
                rec["outline"] = outline_of(b.m, b.mb[0], b.mb[1])
                rec["area"] = b.area
                x0, y0, x1, y1 = b.mb
                sub = label[y0:y1, x0:x1]
                sub[b.m & (sub == 0)] = b.idx + 1
            recs.append(rec)
        for rec in recs:
            fp.write(json.dumps(rec) + "\n")
        cv2.imwrite(str(out / "labels" / f"{d['id']}.png"), label)
        # boundary length by source: pixels of a kept book with a 4-neighbour of another, sourced by provenance
        edge = np.zeros((H, W), bool)
        for sh in ((0, 1), (1, 0)):
            a_ = label[: H - sh[0], : W - sh[1]]
            b_ = label[sh[0]:, sh[1]:]
            e = (a_ > 0) & (b_ > 0) & (a_ != b_)
            edge[: H - sh[0], : W - sh[1]] |= e
            edge[sh[0]:, sh[1]:] |= e
        for s_i, c_ in enumerate(np.bincount(src_code[edge.ravel()], minlength=len(SOURCES))):
            blen[SOURCES[s_i]] += int(c_)
        del src_code, edge
        m1 = measure(d, boxes, recs, post_gate)
        m1["groupsWithoutLogits"] = missing
        m1["groups"] = len(plans)
        m1["windows"] = sum(len(p["windows"]) for p in plans)
        photos.append(m1)
        rows_all += m1.pop("rows")
        log(f"resolve {d['id'][:8]}: {len(plans)} groups ({missing} without logits), overlap {m1['before']['multi']}"
            f" -> {m1['after']['multi']} px, {time.time() - t0:.1f} s")
    fp.close(), fb.close()
    with open(out / "photos.jsonl", "w") as f:
        for p in photos:
            f.write(json.dumps(p) + "\n")
    with open(out / "crops.jsonl", "w") as f:
        for r in rows_all:
            f.write(json.dumps(r) + "\n")
    print(json.dumps(aggregate(a.set, photos, rows_all, dict(gate_counts), dict(prov), dict(blen), dict(seam_tot)), indent=1))


def claims(outlines: list[list], W: int, H: int) -> np.ndarray:
    count = np.zeros((H, W), np.uint8)
    for o in outlines:
        if o and len(o) >= 3:
            x0, y0, x1, y1 = bbox(o, W, H)
            if x1 > x0 and y1 > y0:
                count[y0:y1, x0:x1] += raster(o, x0, y0, x1 - x0, y1 - y0)
    return count


def neighbour_rows(d: dict, items: list[tuple[str, np.ndarray, list]], count: np.ndarray) -> list[dict]:
    """F-R1's neighbour-in-crop: pixels of the crop rectangle another outline claims and its own does not."""
    W, H = d["width"], d["height"]
    rows = []
    for bid, poly, outline in items:
        x0, y0, x1, y1 = bbox(poly, W, H)
        if x1 <= x0 or y1 <= y0:
            continue
        r = raster(poly, x0, y0, x1 - x0, y1 - y0)
        own = raster(outline, x0, y0, x1 - x0, y1 - y0) if outline and len(outline) >= 3 else np.zeros_like(r)
        c = count[y0:y1, x0:x1].astype(np.int16) - own
        neigh = r & (c >= 1) & ~own
        rows.append({"id": bid, "rect": int(r.sum()), "neighbour": int(neigh.sum())})
    return rows


def measure(d: dict, boxes: list[Box], recs: list[dict], post_gate: dict) -> dict:
    W, H = d["width"], d["height"]
    before_outlines = [outline_of(b.orig_m, b.orig_mb[0], b.orig_mb[1]) for b in boxes]
    cb = claims(before_outlines, W, H)
    kept = [r for r in recs if r["state"] == "kept"]
    after_outlines = [r.get("outline") for r in kept]
    ca = claims(after_outlines, W, H)
    by = {b.id: b for b in boxes}
    nb = neighbour_rows(d, [(b.id, cv2.boxPoints(rect_of(d["spines"][b.idx]["polygon"])), o) for b, o in zip(boxes, before_outlines)], cb)
    na = neighbour_rows(d, [(r["id"], np.array(r["refit"]) if r.get("refit") else cv2.boxPoints(rect_of(d["spines"][by[r["id"]].idx]["polygon"])),
                             r.get("outline")) for r in kept], ca)
    rows = [{"id": x["id"], "photo": d["id"], "when": "before", "share": x["neighbour"] / max(x["rect"], 1)} for x in nb] + \
           [{"id": x["id"], "photo": d["id"], "when": "after", "share": x["neighbour"] / max(x["rect"], 1)} for x in na]
    return {"photo": d["id"], "boxes": len(boxes), "kept": len(kept),
            "before": {"claimed": int((cb >= 1).sum()), "multi": int((cb >= 2).sum())},
            "after": {"claimed": int((ca >= 1).sum()), "multi": int((ca >= 2).sum())},
            "changed": sum(1 for r in kept if r["changed"]), "refit": sum(1 for r in kept if r.get("refit")),
            "flagged": sum(1 for r in kept if r["flagged"]), "rows": rows}


def paired_boot(per_photo: dict[str, tuple[float, float, float, float]], rng) -> list[float]:
    """Pooled share after minus before (num_a/den_a - num_b/den_b) with a paired photo bootstrap, 2,000 draws."""
    keys = list(per_photo)
    arr = np.array([per_photo[k] for k in keys], float)

    def stat(x):
        return x[:, 2].sum() / max(x[:, 3].sum(), 1) - x[:, 0].sum() / max(x[:, 1].sum(), 1)
    pt = stat(arr)
    draws = [stat(arr[rng.integers(0, len(keys), len(keys))]) for _ in range(2000)]
    lo, hi = np.percentile(draws, [2.5, 97.5])
    return [round(float(pt), 4), round(float(lo), 4), round(float(hi), 4)]


def aggregate(name: str, photos: list[dict], rows: list[dict], gate_counts: dict, prov: dict, blen: dict, seam: dict) -> dict:
    rng = np.random.default_rng(SEED)
    res: dict = {"set": name, "photos": len(photos), "boxCount": sum(p["boxes"] for p in photos),
                 "kept": sum(p["kept"] for p in photos), "changed": sum(p["changed"] for p in photos),
                 "refit": sum(p["refit"] for p in photos), "flagged": sum(p["flagged"] for p in photos),
                 "groups": sum(p["groups"] for p in photos), "windows": sum(p["windows"] for p in photos),
                 "groupsWithoutLogits": sum(p["groupsWithoutLogits"] for p in photos), "gate": gate_counts}
    for when in ("before", "after"):
        res[f"overlapRate_{when}"] = dict(zip(["share", "lo", "hi"], boot({p["photo"]: (p[when]["multi"], p[when]["claimed"]) for p in photos}, rng)))
    acc: dict[str, list[float]] = defaultdict(lambda: [0, 0, 0, 0])
    for r in rows:
        k = 0 if r["when"] == "before" else 2
        acc[r["photo"]][k + 1] += 1
        acc[r["photo"]][k] += r["share"] >= INTRUDE
    res["cropsNeighbour10pct"] = {
        "before": round(sum(v[0] for v in acc.values()) / max(sum(v[1] for v in acc.values()), 1), 4),
        "after": round(sum(v[2] for v in acc.values()) / max(sum(v[3] for v in acc.values()), 1), 4),
        "delta": paired_boot({k: tuple(v) for k, v in acc.items()}, np.random.default_rng(SEED))}
    tot = max(sum(prov.values()), 1)
    res["contestedPixels"] = sum(prov.values())
    res["provenancePixelShare"] = {k: round(v / tot, 4) for k, v in prov.items() if v}
    bt = max(sum(blen.values()), 1)
    res["boundaryLengthShare"] = {k: round(v / bt, 4) for k, v in sorted(blen.items())}
    res["seam"] = seam
    res["thresholds"] = {"dupIou": DUP_IOU, "dupIom": DUP_IOM, "dupRatio": DUP_RATIO, "nestIom": NEST_IOM,
                         "mergedCover": MERGED_COVER, "wholeWidths": WHOLE_WIDTHS, "padPx": PAD_PX, "padWidths": PAD_WIDTHS,
                         "side": [MIN_SIDE, MAX_SIDE], "alongOverlap": ALONG_OVERLAP, "ramp": RAMP, "depthClear": DEPTH_CLEAR,
                         "seamEdgeW": SEAM_EDGE_W, "seamStep": SEAM_STEP, "seamMinRows": SEAM_MIN_ROWS,
                         "seamMargin": SEAM_MARGIN, "alignDeg": ALIGN_DEG, "flagKeep": FLAG_KEEP,
                         "absorbKeep": ABSORB_KEEP, "changedLoss": CHANGED_LOSS, "bootstrap": BOOT, "seed": SEED}
    return res


def cmd_own(a) -> None:
    """The `mask=own` crops. Per request, the polygon's bounding box is cut from the photo and every pixel another kept
    box owns (the label map) is filled with the median colour of the cut's pixels no book owns (the polygon's median
    when those are under 5 % of it). A photo's cuts are packed into one lossless mosaic, so the readers take each
    polygon, shifted by its cut's offset, from one image per photo. One line out per request: the mosaic, the shift
    (mosaic minus photo coordinates) and the pixels filled; then one line per photo with the mosaic's size."""
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    by_photo: dict[str, list[dict]] = defaultdict(list)
    for r in read_jsonl(a.requests):
        by_photo[r["photo"]].append(r)
    for photo, reqs in by_photo.items():
        img = cv2.imread(reqs[0]["image"], cv2.IMREAD_COLOR)
        lab = cv2.imread(reqs[0]["labels"], cv2.IMREAD_UNCHANGED)
        H, W = lab.shape
        cuts = []
        for r in reqs:
            x0, y0, x1, y1 = bbox(r["polygon"], W, H)
            x0, y0, x1, y1 = max(x0 - 2, 0), max(y0 - 2, 0), min(x1 + 2, W), min(y1 + 2, H)
            cut = img[y0:y1, x0:x1].copy()
            l = lab[y0:y1, x0:x1]
            inside = raster(r["polygon"], x0, y0, x1 - x0, y1 - y0)
            other = (l > 0) & (l != r["own"])
            free = inside & (l == 0)
            ref = cut[free] if free.sum() >= 0.05 * max(inside.sum(), 1) else cut[inside]
            fill = np.median(ref, axis=0) if len(ref) else np.median(cut.reshape(-1, 3), axis=0)
            cut[other] = fill.astype(np.uint8)
            cuts.append((r, x0, y0, cut, int((other & inside).sum()), int(inside.sum())))
        # shelf packing, tallest first, 16 px apart
        order = sorted(range(len(cuts)), key=lambda k: -cuts[k][3].shape[0])
        limit = max(4096, max(c[3].shape[1] for c in cuts))
        place, x, y, row_h, width = {}, 0, 0, 0, 0
        for k in order:
            h, w = cuts[k][3].shape[:2]
            if x and x + w > limit:
                x, y, row_h = 0, y + row_h + 16, 0
            place[k] = (x, y)
            x, row_h, width = x + w + 16, max(row_h, h), max(width, x + w)
        mosaic = np.zeros((y + row_h, width, 3), np.uint8)
        path = out / f"{photo}.png"
        for k, (r, x0, y0, cut, filled, rect) in enumerate(cuts):
            px, py = place[k]
            mosaic[py:py + cut.shape[0], px:px + cut.shape[1]] = cut
            print(json.dumps({"id": r["id"], "mosaic": str(path), "dx": px - x0, "dy": py - y0, "filled": filled,
                              "rect": rect}), flush=True)
        cv2.imwrite(str(path), mosaic)
        print(json.dumps({"photo": photo, "mosaic": str(path), "width": int(mosaic.shape[1]), "height": int(mosaic.shape[0])}), flush=True)


def load_sets(a) -> list[tuple[dict, set, dict, dict]]:
    keep = {r["id"] for r in read_jsonl(a.table)}
    outlines = {r["id"]: r["outline"] for r in read_jsonl(a.outlines) if r.get("outline")}
    decisions = {}
    for r in read_jsonl(a.decisions):
        acc = r.get("accepted")
        decisions[r["id"]] = acc if isinstance(acc, str) else (acc or {}).get("workId")
    dets = [d for d in read_jsonl(a.detect) if not d.get("error")]
    if a.only:
        dets = dets[: a.only]
    return [(d, keep, outlines, decisions) for d in dets]


def main() -> None:
    if sys.argv[1:2] == ["own"]:
        ap = argparse.ArgumentParser()
        ap.add_argument("cmd")
        ap.add_argument("--requests", required=True)
        ap.add_argument("--out", required=True)
        cmd_own(ap.parse_args())
        return
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["plan", "resolve"])
    for k in ("set", "detect", "outlines", "table", "decisions", "images", "out"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--only", type=int, default=0, help="first N photos (smoke runs)")
    ap.add_argument("--classical", action="store_true", help="also compute the classical seam arm (reported only)")
    a = ap.parse_args()
    sets = load_sets(a)
    (cmd_plan if a.cmd == "plan" else cmd_resolve)(a, sets)


if __name__ == "__main__":
    main()
