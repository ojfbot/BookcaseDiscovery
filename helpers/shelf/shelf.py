"""S-1 shelf structure and voids, from the depth stage's cached point maps, normals and band frames (helpers/depth).

Per photo, for each shelf band (F-0's row of boxes) with a frame of its own in the depth stage (``front`` n_f, the
spine-plane normal toward the camera; ``up`` u; ``side`` s = u x n_f):

**Row extent.** The band's book boxes (the boxes the shipped not-a-book filter keeps, on the band's own frame, not
an ``ownPlane`` side case) give the spine-plane offset c (median n_f . P of their ``front`` pixels in the class map),
the books' base b0 and top bt (medians over books of each book's p5 and p95 of u . P on its front pixels) and the
row's side extent (p2–p98 of s . P on those pixels).

**Planes** (RANSAC, three points a draw, ``ITERS`` draws on at most ``SAMPLE`` candidates, inliers within
``INLIER_M`` of the plane; the winner refit by SVD on its inliers, twice; its normal within ``PRIOR_DEG`` of the
prior). Candidates are valid map pixels outside every kept book's outline (or box), with s . P within the row's side
extent widened by ``SIDE_PAD_M`` and n_f . P within ``[c - DEPTH_BACK_M, c + DEPTH_FRONT_M]``:

- **board top**: normal within ``FACE_DEG`` of u (faces up), u . P in ``[b0 - 0.06, b0 + 0.04]`` m;
- **lip** (the board's front edge): normal within ``FACE_DEG`` of n_f, u . P in ``[b0 - 0.08, b0 + 0.01]`` m, not
  more than ``LIP_BEHIND_M`` behind the spine plane;
- **back panel**: normal within ``FACE_DEG`` of n_f, more than faces.py's ``BEHIND_M`` (8 cm) behind the spine plane,
  u . P in ``[b0, bt + 0.10]`` m.

A plane is **found** when its refit keeps at least ``MIN_INLIERS`` map pixels and its inliers span at least
``MIN_SPAN`` of the row's side extent (``MIN_SPAN_BACK`` for the back panel, which shows only in gaps and above the
books). Elevation is the median of the band's boxes' ``elevationDeg`` (H-1's: below under -10 deg, above over 10).

**Voids** (Q-0's coverage-segment unit: arc length along the polyline through the row's book centres, in median
spine widths, ``gaps.medianWidth``; a coverage segment is two of them). The polyline runs through the book centres
sorted along the band, smoothed across by a running median of five, and is extended straight at both ends to the
row's extent: its books, grown past either end only through uncovered bins that are mostly ``behind`` (an empty
end of the shelf), searched as far as the lip's (else the board top's) inliers reach. Books off the centres'
Theil-Sen line by more than ``OFF_LINE`` book heights are left out. Its zone is
the middle half of the books' height about it. Along it, bins of ``BIN_W`` widths: a bin is **uncovered** when under
half its zone pixels are inside a kept book's outline (Q-2b's SAM 2.1 outline, falling back to the box). Runs of
uncovered bins of at least half a width (F-0's gap test) are **candidate voids**. A candidate is a **void** when at
least ``BEHIND_SHARE`` of its uncovered valid pixels are ``behind`` (faces.py's classify with the row's frame: front-
facing and more than 8 cm behind the spine plane: the back panel shows). Disagreements are kept apart: a candidate
that is not behind (``outline-gap``, with its dominant class), and a run of covered bins whose zone is mostly behind
(``behind-under-outline``: an outline over a void).

**Lip features per box** (for S-1's ``on-lip`` rule, ``ON_LIP`` in src/eval/s1.ts): for every spine-path and
cover-pass box, the row with a found lip whose face holds most of the box's valid pixels. The face: u . P from the
lip inliers' p5 minus ``ZONE_PAD_M`` to max(board-top level, their p95) plus ``ZONE_PAD_M``, and s . P within the
lip's side extent widened by ``SIDE_PAD_M``. The board-top level is the board's inliers' median u . P, else the
lip's p95. Features: ``inZone`` (share of the box's pixels on the face), ``belowBoard`` (share below the level),
``dLip`` (median signed distance to the lip plane, + toward the camera), ``dSpine`` (median n_f . P minus the row's
c), ``lipHeightM`` and ``lipBoardGapM`` (level minus the lip's p95). Metres are MoGe-2's metric scale, which is
unverified (H-1).

Every threshold above was fixed before the first full run (evals/S1/report.md, Pre-registration).

    python -I shelf.py --inputs inputs.jsonl [--maps DIR] > shelf.jsonl

``inputs.jsonl``: one line per photo, from src/eval/s1-cli.ts: ``{id, width, height, npz, faces, classmap, spines:
[{polygon, kept}], outlines: {box: polygon}, covers: [{polygon}], bands: [{polygon}], medianWidth}``; S-2's
(src/eval/s2-cli.ts) adds ``anyBoxes: [polygon]``, and each stretch then carries ``boxShare``, the share of its
uncovered zone pixels inside any of them. stdout: one
line per photo (rows, boxes, covers). ``--maps`` writes a label PNG per photo at map resolution (1 board top, 2 lip,
3 back panel, 4 void, 5 outline-gap, 6 behind-under-outline). Everything is private photo geometry; stderr carries
progress only.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "depth"))  # -I leaves script folders off the path; faces.py is H-1's

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import faces as F  # noqa: E402

ITERS, SAMPLE, INLIER_M = 200, 20000, 0.015
PRIOR_DEG, FACE_DEG = 20.0, 30.0
MIN_INLIERS, MIN_SPAN, MIN_SPAN_BACK = 150, 0.2, 0.05
SIDE_PAD_M, DEPTH_BACK_M, DEPTH_FRONT_M = 0.05, 0.6, 0.3
LIP_BEHIND_M = 0.03
WINDOWS = {"board": (-0.06, 0.04), "lip": (-0.08, 0.01)}
BACK_ABOVE_M = 0.10
BIN_W, MIN_RUN_W, COVERED, BEHIND_SHARE = 0.25, 0.5, 0.5, 0.5
ZONE_PAD_M = 0.01
OFF_LINE = 0.5
SEGMENT_W = 2.0  # Q-0's coverage segment: two median spine widths
PLANES = ("board", "lip", "back")
LABELS = {"board": 1, "lip": 2, "back": 3, "void": 4, "outline-gap": 5, "behind-under-outline": 6}


def ransac_plane(X: np.ndarray, prior: np.ndarray, rng: np.random.Generator) -> dict | None:
    """Plane n . P = d through X (N, 3), normal within PRIOR_DEG of ``prior`` and oriented along it."""
    if len(X) < MIN_INLIERS:
        return None
    S = X if len(X) <= SAMPLE else X[rng.choice(len(X), SAMPLE, replace=False)]
    cmax = math.cos(math.radians(PRIOR_DEG))
    best_n, best_d, best_k = None, 0.0, -1
    for _ in range(ITERS):
        a, b, c = S[rng.choice(len(S), 3, replace=False)]
        n = np.cross(b - a, c - a)
        ln = np.linalg.norm(n)
        if ln < 1e-9:
            continue
        n = n / ln
        if n @ prior < 0:
            n = -n
        if n @ prior < cmax:
            continue
        d = float(n @ a)
        k = int((np.abs(S @ n - d) < INLIER_M).sum())
        if k > best_k:
            best_n, best_d, best_k = n, d, k
    if best_n is None:
        return None
    n, d = best_n, best_d
    for _ in range(2):
        inl = np.abs(X @ n - d) < INLIER_M
        if inl.sum() < 3:
            return None
        Y = X[inl]
        mu = Y.mean(axis=0)
        m = np.linalg.svd(Y - mu, full_matrices=False)[2][-1]
        if m @ prior < 0:
            m = -m
        if m @ prior >= cmax:
            n = m
        d = float(np.median(Y @ n))
    inl = np.abs(X @ n - d) < INLIER_M
    return {"n": n, "d": d, "inliers": inl, "rms": float(np.sqrt(np.mean((X[inl] @ n - d) ** 2))) if inl.any() else None}


def fill(mask: np.ndarray, poly_map: np.ndarray) -> None:
    cv2.fillPoly(mask, [np.round(poly_map).astype(np.int32)], 1)


_GRID: dict[tuple[int, int], np.ndarray] = {}


def pixel_grid(H: int, W: int) -> np.ndarray:
    """(H*W, 2) pixel centres (x, y), built once per map size."""
    if (H, W) not in _GRID:
        yy, xx = np.mgrid[0:H, 0:W]
        _GRID.clear()
        _GRID[(H, W)] = np.stack([xx.ravel(), yy.ravel()], 1).astype(np.float64)
    return _GRID[(H, W)]


def theil_sen(x: np.ndarray, y: np.ndarray) -> float:
    """Median of pairwise slopes (0 when x does not vary)."""
    i, j = np.triu_indices(len(x), 1)
    dx = x[j] - x[i]
    ok = np.abs(dx) > 1e-6
    return float(np.median((y[j] - y[i])[ok] / dx[ok])) if ok.any() else 0.0


def running_median(v: np.ndarray, k: int = 5) -> np.ndarray:
    h = k // 2
    return np.array([np.median(v[max(0, i - h): i + h + 1]) for i in range(len(v))])


def project_polyline(pts: np.ndarray, line: np.ndarray, cum: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Arc length along ``line`` (M, 2) of the nearest point, and the signed offset (+ to the right of travel)."""
    best_t = np.zeros(len(pts))
    best_o = np.zeros(len(pts))
    best_dist = np.full(len(pts), np.inf)
    for i in range(len(line) - 1):
        a, b = line[i], line[i + 1]
        ab = b - a
        L2 = float(ab @ ab)
        if L2 < 1e-9:
            continue
        t = np.clip(((pts - a) @ ab) / L2, 0.0, 1.0)
        q = a + t[:, None] * ab
        dist = np.linalg.norm(pts - q, axis=1)
        nrm = np.array([-ab[1], ab[0]]) / math.sqrt(L2)  # image y down: +offset is below the line for travel to +x
        o = (pts - q) @ nrm
        upd = dist < best_dist
        best_dist[upd], best_t[upd], best_o[upd] = dist[upd], cum[i] + t[upd] * math.sqrt(L2), o[upd]
    return best_t, best_o


def plane_out(fit: dict | None, X: np.ndarray, s: np.ndarray, side: tuple[float, float], up: np.ndarray, kind: str) -> dict:
    if fit is None:
        return {"found": False, "inliers": 0}
    inl = fit["inliers"]
    k = int(inl.sum())
    span = 0.0
    if k:
        lo, hi = np.percentile(X[inl] @ s, [2, 98])
        span = float((hi - lo) / max(side[1] - side[0], 1e-6))
    need = MIN_SPAN_BACK if kind == "back" else MIN_SPAN
    out = {"found": bool(k >= MIN_INLIERS and span >= need), "inliers": k, "span": round(span, 3),
           "normal": [round(float(v), 4) for v in fit["n"]], "d": round(fit["d"], 4),
           "rmsM": None if fit["rms"] is None else round(fit["rms"], 4)}
    if k:
        uu = X[inl] @ up
        ss = X[inl] @ s
        out["up"] = [round(float(v), 4) for v in np.percentile(uu, [5, 95])]
        out["upMedian"] = round(float(np.median(uu)), 4)
        out["side"] = [round(float(v), 4) for v in np.percentile(ss, [2, 98])]
    return out


def run_photo(rec: dict) -> tuple[dict, np.ndarray]:
    z = dict(np.load(rec["npz"]))
    N = F.unit(z["normal"].astype(np.float32))
    P = z["points"].astype(np.float32)
    valid = z["mask"] & np.isfinite(P).all(-1) & np.isfinite(N).all(-1)
    scale = float(z["scale"])
    H, W = N.shape[:2]
    faces = json.loads(Path(rec["faces"]).read_text())
    classmap = cv2.imread(rec["classmap"], cv2.IMREAD_UNCHANGED)
    frows = {r["box"]: r for r in faces["rows"]}
    frames = faces["frames"]
    rng = np.random.default_rng(0)
    labels = np.zeros((H, W), np.uint8)

    spines = rec["spines"]
    outlines = {int(k): v for k, v in (rec.get("outlines") or {}).items()}
    books = [i for i, sp in enumerate(spines) if sp.get("kept")]
    cover_mask = np.zeros((H, W), np.uint8)
    book_masks: dict[int, tuple[np.ndarray, tuple[int, int, int, int]]] = {}
    for i in books:
        poly = np.float64(outlines.get(i) or spines[i]["polygon"]) * scale
        fill(cover_mask, poly)
        bm = F.box_mask(np.float64(spines[i]["polygon"]) * scale, H, W)
        if bm is not None:
            book_masks[i] = bm
    covered = cover_mask.astype(bool)
    # Optional (S-2): every detection box of any kind or partition state, so each stretch can say how much of it some
    # box holds (Q-3's box-less `front` faces). Absent in S-1's inputs; the stretches are unchanged either way.
    any_box = None
    if rec.get("anyBoxes") is not None:
        any_mask = np.zeros((H, W), np.uint8)
        for poly in rec["anyBoxes"]:
            fill(any_mask, np.float64(poly) * scale)
        any_box = any_mask.astype(bool)

    flat_idx = np.flatnonzero(valid.ravel())
    Pv = P.reshape(-1, 3)[flat_idx]
    Nv = N.reshape(-1, 3)[flat_idx]
    cov_v = covered.ravel()[flat_idx]
    ys, xs = np.divmod(flat_idx, W)

    rows_out = []
    row_planes = []
    mw = float(rec.get("medianWidth") or 0) * scale
    for b, band in enumerate(rec.get("bands") or []):
        fr = frames.get(str(b))
        mine = [i for i in books if frows.get(i, {}).get("band") == b and frows.get(i, {}).get("frame") == str(b)
                and not frows[i].get("skip")]
        row: dict = {"band": b, "books": len(mine)}
        if fr is None or len(mine) < 3:
            row["skip"] = "no-frame" if fr is None else "few-books"
            rows_out.append(row)
            continue
        nf, u = F.unit(np.array(fr["front"])), F.unit(np.array(fr["up"]))
        s = F.unit(np.cross(u, nf))
        fronts, bases, tops, elev = [], [], [], []
        for i in mine:
            if i not in book_masks:
                continue
            m, (x0, y0, x1, y1) = book_masks[i]
            sel = m & valid[y0:y1, x0:x1] & (classmap[y0:y1, x0:x1] == 0)
            p = P[y0:y1, x0:x1][sel]
            if len(p) < 10:
                continue
            fronts.append(p)
            uu = p @ u
            bases.append(np.percentile(uu, 5))
            tops.append(np.percentile(uu, 95))
            if frows[i].get("elevationDeg") is not None:
                elev.append(frows[i]["elevationDeg"])
        if len(fronts) < 3:
            row["skip"] = "few-faces"
            rows_out.append(row)
            continue
        Fp = np.concatenate(fronts)
        c = float(np.median(Fp @ nf))
        b0, bt = float(np.median(bases)), float(np.median(tops))
        side = tuple(float(v) for v in np.percentile(Fp @ s, [2, 98]))
        row.update({"elevationDeg": round(float(np.median(elev)), 1) if elev else None, "spineOffset": round(c, 4),
                    "base": round(b0, 4), "top": round(bt, 4), "side": [round(v, 4) for v in side],
                    "bookHeightM": round(bt - b0, 4)})

        ss, uu, dd = Pv @ s, Pv @ u, Pv @ nf
        near = (~cov_v) & (ss >= side[0] - SIDE_PAD_M) & (ss <= side[1] + SIDE_PAD_M) & \
               (dd >= c - DEPTH_BACK_M) & (dd <= c + DEPTH_FRONT_M)
        cface = math.cos(math.radians(FACE_DEG))
        cand = {
            "board": near & (Nv @ u > cface) & (uu >= b0 + WINDOWS["board"][0]) & (uu <= b0 + WINDOWS["board"][1]),
            "lip": near & (Nv @ nf > cface) & (uu >= b0 + WINDOWS["lip"][0]) & (uu <= b0 + WINDOWS["lip"][1])
                   & (dd >= c - LIP_BEHIND_M),
            "back": near & (Nv @ nf > cface) & (dd < c - F.BEHIND_M) & (uu >= b0) & (uu <= bt + BACK_ABOVE_M),
        }
        planes = {}
        for kind in PLANES:
            X = Pv[cand[kind]]
            fit = ransac_plane(X, u if kind == "board" else nf, rng)
            planes[kind] = plane_out(fit, X, s, side, u, kind)
            if fit is not None and fit["inliers"].any():
                planes[kind]["depthMedian"] = round(float(np.median(X[fit["inliers"]] @ nf)), 4)
            if planes[kind]["found"]:
                idx = np.flatnonzero(cand[kind])[fit["inliers"]]
                labels[ys[idx], xs[idx]] = LABELS[kind]
        row["planes"] = planes
        lip, back, board = planes["lip"], planes["back"], planes["board"]
        if lip["found"] and back["found"]:
            # Board depth along n_f: the lip's inliers' median n_f . P minus the back panel's.
            row["boardDepthM"] = round(lip["depthMedian"] - back["depthMedian"], 4)
        if board["found"]:
            row["level"], row["levelSource"] = board["upMedian"], "board"
        elif lip["found"]:
            row["level"], row["levelSource"] = lip["up"][1], "lip"
        else:
            row["level"], row["levelSource"] = round(b0, 4), "base"
        row["frame"] = {"front": [round(float(v), 4) for v in nf], "up": [round(float(v), 4) for v in u]}
        row_planes.append({"band": b, "nf": nf, "u": u, "s": s, "c": c, "planes": planes, "b0": b0})

        # Voids along the row, in median spine widths.
        if mw > 0:
            row["voids"] = voids(rec, b, mine, spines, scale, H, W, covered, valid, N, P, nf, u, s, c, planes, mw, labels, any_box)
        rows_out.append(row)

    boxes = [lip_features(np.float64(sp["polygon"]) * scale, H, W, valid, P, row_planes) for sp in spines]
    covers = [lip_features(np.float64(cv["polygon"]) * scale, H, W, valid, P, row_planes) for cv in rec.get("covers") or []]
    return {"id": rec["id"], "photo": True, "mapSize": [W, H], "scale": scale, "rows": rows_out, "boxes": boxes,
            "covers": covers}, labels


def voids(rec, b, mine, spines, scale, H, W, covered, valid, N, P, nf, u, s, c, planes, mw, labels, any_box=None) -> dict:
    band = np.float64(rec["bands"][b]["polygon"]) * scale
    e = band[1] - band[0] if np.linalg.norm(band[1] - band[0]) >= np.linalg.norm(band[2] - band[1]) else band[2] - band[1]
    v = e / np.linalg.norm(e)
    if v[0] < 0:
        v = -v
    w = np.array([-v[1], v[0]])  # image-down across the band
    polys = [np.float64(spines[i]["polygon"]) * scale for i in mine]
    cen = np.array([p.mean(axis=0) for p in polys])
    origin = cen.mean(axis=0)
    a = (cen - origin) @ v
    o = (cen - origin) @ w
    # Books off the row's line (a side case's books sharing the band) are left out: Theil-Sen line through the
    # centres, books further across than OFF_LINE of the median book height dropped.
    hgt = float(np.median([np.ptp((p - origin) @ w) for p in polys]))
    slope = theil_sen(a, o)
    icpt = float(np.median(o - slope * a))
    on = np.abs(o - (icpt + slope * a)) <= OFF_LINE * hgt
    if on.sum() >= 3:
        polys = [p for p, k in zip(polys, on) if k]
        a, o = a[on], o[on]
    order = np.argsort(a)
    a, o = a[order], running_median(o[order])
    books_ext = [min(((p - origin) @ v).min() for p in polys), max(((p - origin) @ v).max() for p in polys)]
    # Search past the books' ends as far as the lip's (else the board top's) inliers reach along this row; bins
    # there count only while they are behind (an empty end of the shelf), so the case's uprights never do.
    ext = list(books_ext)
    for kind in ("lip", "board"):
        if planes[kind]["found"]:
            yy, xx = np.nonzero(labels == LABELS[kind])
            if len(xx):
                q = np.stack([xx, yy], 1).astype(np.float64) - origin
                keep = np.abs(q @ w - (icpt + slope * (q @ v))) < 2 * hgt
                if keep.any():
                    pa = q[keep] @ v
                    ext = [min(ext[0], float(np.percentile(pa, 2))), max(ext[1], float(np.percentile(pa, 98)))]
            break
    line = np.concatenate([[[ext[0] - 1, o[0]]], np.stack([a, o], 1), [[ext[1] + 1, o[-1]]]])
    line_xy = origin + line[:, :1] * v + line[:, 1:] * w
    seg = np.linalg.norm(np.diff(line_xy, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    # Zone: the middle half of the books' height about the polyline.
    tops, bots = [], []
    for p in polys:
        pt, po = project_polyline(p, line_xy, cum)
        tops.append(po.min())
        bots.append(po.max())
    top, bot = float(np.median(tops)), float(np.median(bots))
    hz = bot - top
    z0, z1 = top + 0.25 * hz, bot - 0.25 * hz
    # Candidate pixels: inside a rotated rectangle around the band, then exact offsets.
    pts_all = pixel_grid(H, W)
    rel = pts_all - origin
    pre = (rel @ v >= ext[0] - 2) & (rel @ v <= ext[1] + 2) & (np.abs(rel @ w - np.median(o)) <= 1.5 * hz + np.ptp(o))
    idx = np.flatnonzero(pre)
    t, off = project_polyline(pts_all[idx], line_xy, cum)
    inz = (off >= z0) & (off <= z1)
    idx, t = idx[inz], t[inz]
    py, px = np.divmod(idx, W)
    tw = t / mw  # median widths from the polyline's start
    nb = int(math.ceil(cum[-1] / mw / BIN_W))
    bins = np.clip((tw / BIN_W).astype(int), 0, max(nb - 1, 0))
    val = valid[py, px]
    cov = covered[py, px]
    cls = np.full(len(idx), -1, np.int8)
    if val.any():
        frame = {"front": nf, "up": u, "side": s, "offset": c}
        cls[val] = F.classify(N[py[val], px[val]], P[py[val], px[val]], frame)
    zone_n = np.bincount(bins, minlength=nb)
    cov_n = np.bincount(bins, weights=cov, minlength=nb)
    unc_val = val & ~cov
    beh = cls == 5
    unc_v_n = np.bincount(bins, weights=unc_val, minlength=nb)
    unc_beh_n = np.bincount(bins, weights=unc_val & beh, minlength=nb)
    cov_v_n = np.bincount(bins, weights=val & cov, minlength=nb)
    cov_beh_n = np.bincount(bins, weights=val & cov & beh, minlength=nb)
    inside = zone_n > 0
    uncovered = inside & (cov_n < COVERED * np.maximum(zone_n, 1))
    # The row: the books' own extent, grown past either end only through bins that are uncovered and behind (an
    # empty end of the shelf); the first bin that is not (the case's upright, a neighbouring case) ends it.
    bstart = max(0, min(nb - 1, int(((books_ext[0] - ext[0] + 1) / mw) / BIN_W)))
    bend = max(bstart + 1, min(nb, int(math.ceil(((books_ext[1] - ext[0] + 1) / mw) / BIN_W))))
    end_void = inside & uncovered & (unc_v_n > 0) & (unc_beh_n >= BEHIND_SHARE * np.maximum(unc_v_n, 1))
    lo, hi = bstart, bend
    while lo > 0 and end_void[lo - 1]:
        lo -= 1
    while hi < nb and end_void[hi]:
        hi += 1
    in_row = np.zeros(nb, bool)
    in_row[lo:hi] = True
    inside &= in_row
    uncovered &= in_row

    def runs(flag: np.ndarray) -> list[tuple[int, int]]:
        out, i = [], 0
        while i < len(flag):
            if flag[i]:
                j = i
                while j + 1 < len(flag) and flag[j + 1]:
                    j += 1
                out.append((i, j + 1))
                i = j + 1
            else:
                i += 1
        return out

    min_bins = int(round(MIN_RUN_W / BIN_W))
    stretches = []
    for i, j in runs(uncovered):
        if j - i < min_bins:
            continue
        uv = unc_v_n[i:j].sum()
        bs = float(unc_beh_n[i:j].sum() / uv) if uv else None
        sel = (bins >= i) & (bins < j) & unc_val
        counts = np.bincount(cls[sel].astype(np.int64), minlength=6) if sel.any() else np.zeros(6)
        dom = F.CLASSES[int(np.argmax(counts))] if sel.any() else "invalid"
        kind = "void" if bs is not None and bs >= BEHIND_SHARE else "outline-gap"
        where = "end" if j <= bstart or i >= bend else "interior"
        f0, f1 = (i - lo) * BIN_W, (j - lo) * BIN_W  # median widths from the row's start
        stretches.append({"from": round(f0, 2), "to": round(f1, 2), "kind": kind, "behind": None if bs is None else round(bs, 3),
                          "dominant": dom, "where": where, "segments": [int(f0 // SEGMENT_W), int((f1 - 1e-9) // SEGMENT_W)]})
        lab = (bins >= i) & (bins < j) & ~cov
        if any_box is not None:
            stretches[-1]["boxShare"] = round(float(any_box[py[lab], px[lab]].mean()), 3) if lab.any() else None
        labels[py[lab], px[lab]] = LABELS[kind]
    under = []
    covered_bins = inside & ~uncovered & (cov_v_n > 0) & (cov_beh_n >= BEHIND_SHARE * np.maximum(cov_v_n, 1))
    for i, j in runs(covered_bins):
        if j - i < min_bins:
            continue
        under.append({"from": round((i - lo) * BIN_W, 2), "to": round((j - lo) * BIN_W, 2), "kind": "behind-under-outline",
                      "behind": round(float(cov_beh_n[i:j].sum() / max(cov_v_n[i:j].sum(), 1)), 3)})
        lab = (bins >= i) & (bins < j) & cov & beh
        labels[py[lab], px[lab]] = LABELS["behind-under-outline"]
    inside_bins = int(inside.sum())
    behind_bins = int((inside & (unc_v_n + cov_v_n > 0) &
                       ((unc_beh_n + cov_beh_n) >= BEHIND_SHARE * np.maximum(unc_v_n + cov_v_n, 1))).sum())
    return {"lengthW": round(inside_bins * BIN_W, 2), "booksW": [round((bstart - lo) * BIN_W, 2), round((bend - lo) * BIN_W, 2)],
            "uncoveredW": round(float(uncovered.sum()) * BIN_W, 2), "behindW": round(behind_bins * BIN_W, 2),
            "stretches": stretches, "under": under,
            "line": [[round(float(x) / scale, 1), round(float(y) / scale, 1)] for x, y in line_xy],
            "zone": [round(z0 / scale, 1), round(z1 / scale, 1)]}


def lip_features(poly_map: np.ndarray, H: int, W: int, valid: np.ndarray, P: np.ndarray, rows: list[dict]) -> dict | None:
    bm = F.box_mask(poly_map, H, W)
    if bm is None:
        return None
    m, (x0, y0, x1, y1) = bm
    p = P[y0:y1, x0:x1][m & valid[y0:y1, x0:x1]]
    if len(p) < 10:
        return {"pixels": int(len(p))}
    best = None
    for r in rows:
        lip, board = r["planes"]["lip"], r["planes"]["board"]
        if not lip["found"]:
            continue
        u, s, nf = r["u"], r["s"], r["nf"]
        level = board["upMedian"] if board["found"] else lip["up"][1]
        uu, ss = p @ u, p @ s
        zone = (uu >= lip["up"][0] - ZONE_PAD_M) & (uu <= max(level, lip["up"][1]) + ZONE_PAD_M) & \
               (ss >= lip["side"][0] - SIDE_PAD_M) & (ss <= lip["side"][1] + SIDE_PAD_M)
        f = {"band": r["band"], "inZone": round(float(zone.mean()), 3), "belowBoard": round(float((uu < level).mean()), 3),
             "dLip": round(float(np.median(p @ np.array(lip["normal"]) - lip["d"])), 4),
             "dSpine": round(float(np.median(p @ nf) - r["c"]), 4), "pixels": int(len(p)),
             "lipHeightM": round(lip["up"][1] - lip["up"][0], 4), "lipBoardGapM": round(level - lip["up"][1], 4)}
        if best is None or f["inZone"] > best["inZone"]:
            best = f
    return best or {"pixels": int(len(p)), "inZone": None}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--maps", default=None, help="private folder for per-photo label PNGs (render.py)")
    ap.add_argument("--only", nargs="*", default=None)
    args = ap.parse_args()
    for line in open(args.inputs):
        rec = json.loads(line)
        if args.only and rec["id"] not in args.only:
            continue
        t = time.time()
        out, labels = run_photo(rec)
        out["seconds"] = round(time.time() - t, 2)
        if args.maps:
            Path(args.maps).mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(Path(args.maps) / f"{rec['id']}.png"), labels)
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()
        print(f"{rec['id'][:8]} {len(out['rows'])} rows {out['seconds']}s", file=sys.stderr)


if __name__ == "__main__":
    main()
