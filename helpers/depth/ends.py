"""F-0m spine end edges: each kept box's top end snapped to the depth stage's front-to-top normal crease, and its
bottom end to S-1's board-top plane or the lip that hides it, on F-0i's instance partition (helpers/coverage).

Per kept box (F-0i's partition), with its detection rectangle's long axis ``a`` (pointing down the image), its centre
``c``, length ``L`` and width ``W``; ``t`` is the coordinate along ``a`` from ``c``. A box tilted more than
``UPRIGHT_DEG`` from vertical is left alone. The box's exclusive outline (F-0i) gives its current ends ``t_top0``
(the outline's least ``t``) and ``t_bot0`` (its greatest).

**Top: the front-to-top crease.** On a strip of the depth map along the axis, ``STRIP`` of the width either side of
it, from ``t_top0 - TOP_BEYOND * L`` to ``t_top0 + TOP_INSIDE * L``, each map pixel is classed by faces.py's
``classify`` in the box's own frame (the depth stage's band frame, or its ``ownPlane`` frame) with the box's own
spine-plane offset (the median ``n_f . P`` of its front pixels). Per bin of one map pixel along the axis: the share of
``front`` and of ``top`` pixels. The crease is the bin boundary that maximises the mean of (top - front) over the
``WIN`` bins above it plus the mean of (front - top) over the ``WIN`` bins below it, ``WIN = max(WIN_MIN_PX map px,
WIN_SHARE * L)``. It is **found** when the top share above it is at least ``TOP_MIN`` and the front share below it
at least ``FRONT_MIN``. Only a top face the camera sees from above makes one; a box above eye level shows no top.

**Bottom: the board top, or the lip that hides it.** For a box in a band with an S-1 row on its band frame (not an
``ownPlane`` side case) whose row has a found board top or lip (``levelSource`` board or lip), with ``a_i`` and
``c_i`` the median ``s . P`` and ``n_f . P`` of its front pixels on the strip:

- the **contact** is the 3D point ``a_i s + level u + c_i n_f`` (the spine face meets the board's top);
- the **lip edge** (when the lip is found) is the point at side ``a_i`` and height the lip's p95 on the lip plane.

Each is projected with MoGe-2's intrinsics. The bottom end is the one of them higher in the image (least ``t``): from
above, the contact; from below, the lip's top edge, which hides the books' feet. Each end line runs through its point
along the projected side direction ``s`` (perspective-correct). It **snaps** when the move from ``t_bot0`` is at most
``BOTTOM_MAX * L`` either way.

**Outline and box.** The new mask is the exclusive outline cut to the inside of each snapped end line and, where an
end line lies past the outline, grown to it: the growth is the band between the outline's across extent (p5-p95 of
its pixels' across coordinate on the middle ``SIDE_ZONE`` of its length, where the spine's sides are straight; a
mask tapers at its ends), on the box's half nearer that end, out to the line. A grown pixel another kept box owns in F-0i's label map is never taken, and a pixel two boxes grow into goes to
the one whose axis is nearer. The new outline is the mask's largest outer contour, lossless (F-0i's rule). The new
box is the detection rectangle with each snapped end moved to where its end line crosses the axis (its width and axis
unchanged; an end that did not snap keeps the rectangle's own end).

Every threshold is a module constant, fixed before the first full run (evals/F0m/report.md, Pre-registration).

    python -I ends.py --inputs inputs.jsonl --out DIR [--only ID ...] > ends.jsonl

``inputs.jsonl``: one line per photo from src/eval/f0m-cli.ts: ``{id, width, height, npz, faces, labels, rows,
boxes: [{index, polygon, outline}]}`` (``rows``: S-2's shelf.py rows on the partition). stdout: one line per kept
box, then one per photo (overlap counts before and after, seconds). ``--out`` gets the new label map per photo
(``labels/<id>.png``, 16-bit, box index + 1). Everything is private photo geometry; stderr carries progress only.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # -I leaves the script's folder off the path

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import faces as F  # noqa: E402

UPRIGHT_DEG = 30.0
STRIP = 0.3
TOP_BEYOND, TOP_INSIDE = 0.25, 0.5
WIN_MIN_PX, WIN_SHARE = 3, 0.06
TOP_MIN, FRONT_MIN = 0.4, 0.5
BOTTOM_MAX = 0.25
SIDE_ZONE = 0.5
SIDE_STEP_M = 0.05
MOVED_PX = 2.0


def axis_of(poly: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, float, float, float]:
    """Centre, unit long axis (pointing down the image), unit across axis, long side, short side, tilt from vertical."""
    e0, e1 = poly[1] - poly[0], poly[2] - poly[1]
    lon, sho = (e0, e1) if np.linalg.norm(e0) >= np.linalg.norm(e1) else (e1, e0)
    L, W = float(np.linalg.norm(lon)), float(np.linalg.norm(sho))
    a = lon / max(L, 1e-9)
    if a[1] < 0:
        a = -a
    n = np.array([-a[1], a[0]])
    tilt = math.degrees(math.acos(min(1.0, abs(float(a[1])))))
    return poly.mean(axis=0), a, n, L, W, tilt


def project_pt(X: np.ndarray, K: np.ndarray, Wm: int, Hm: int, scale: float) -> np.ndarray | None:
    if X[2] <= 0.01:
        return None
    return np.array([(K[0, 0] * X[0] / X[2] + K[0, 2]) * Wm / scale, (K[1, 1] * X[1] / X[2] + K[1, 2]) * Hm / scale])


def end_line(X: np.ndarray, s: np.ndarray, K, Wm, Hm, scale) -> tuple[np.ndarray, np.ndarray] | None:
    """The image line through X's projection along the projected side direction: (point, unit direction)."""
    p, q = project_pt(X, K, Wm, Hm, scale), project_pt(X + SIDE_STEP_M * s, K, Wm, Hm, scale)
    if p is None or q is None or np.linalg.norm(q - p) < 1e-6:
        return None
    return p, (q - p) / np.linalg.norm(q - p)


def cross2(u: np.ndarray, v: np.ndarray) -> float:
    return float(u[0] * v[1] - u[1] * v[0])


def axis_t(c: np.ndarray, a: np.ndarray, line: tuple[np.ndarray, np.ndarray]) -> float | None:
    """t where the line crosses the axis c + t a."""
    q, d = line
    den = cross2(a, d)
    if abs(den) < 1e-6:
        return None
    return cross2(q - c, d) / den


def strip_samples(c, a, n, t0, t1, half, step) -> tuple[np.ndarray, np.ndarray]:
    """Working-copy sample points on a grid along [t0, t1] and across [-half, half]; their bin index along t."""
    ts = np.arange(t0, t1 + 1e-9, step)
    ws = np.arange(-half, half + 1e-9, step) if half > step else np.array([0.0])
    T, Wg = np.meshgrid(ts, ws, indexing="ij")
    pts = c + T.reshape(-1, 1) * a + Wg.reshape(-1, 1) * n
    bins = np.repeat(np.arange(len(ts)), len(ws))
    return pts, bins


def crease(f: np.ndarray, g: np.ndarray, win: int) -> tuple[int, float, float] | None:
    """Bin boundary j (bins < j above, >= j below) maximising mean(g - f) above + mean(f - g) below over ``win`` bins."""
    best = None
    for j in range(win, len(f) - win + 1):
        up, dn = slice(j - win, j), slice(j, j + win)
        score = float(np.mean(g[up] - f[up]) + np.mean(f[dn] - g[dn]))
        if best is None or score > best[0]:
            best = (score, j, float(np.mean(g[up])), float(np.mean(f[dn])))
    return None if best is None else (best[1], best[2], best[3])


def run_photo(rec: dict, out_dir: Path | None) -> tuple[list[dict], dict]:
    z = dict(np.load(rec["npz"]))
    N = F.unit(z["normal"].astype(np.float32))
    P = z["points"].astype(np.float32)
    valid = z["mask"] & np.isfinite(P).all(-1) & np.isfinite(N).all(-1)
    K, scale = z["intrinsics"], float(z["scale"])
    Hm, Wm = N.shape[:2]
    faces = json.loads(Path(rec["faces"]).read_text())
    frows = {r["box"]: r for r in faces["rows"]}
    frames = faces["frames"]
    rows = {r["band"]: r for r in rec.get("rows") or [] if r.get("planes")}
    labels = cv2.imread(rec["labels"], cv2.IMREAD_UNCHANGED)
    Hw, Ww = int(rec["height"]), int(rec["width"])
    step = 1.0 / scale

    def frame_of(i: int) -> dict | None:
        fr = frows.get(i)
        if not fr or fr.get("skip"):
            return None
        f = frames.get(fr["frame"])
        if not f:
            return None
        nf, u = F.unit(np.array(f["front"])), F.unit(np.array(f["up"]))
        return {"front": nf, "up": u, "side": F.unit(np.cross(u, nf)), "offset": None}

    def sample(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        xm = np.clip(np.round(pts[:, 0] * scale).astype(int), 0, Wm - 1)
        ym = np.clip(np.round(pts[:, 1] * scale).astype(int), 0, Hm - 1)
        inside = (pts[:, 0] >= 0) & (pts[:, 0] < Ww) & (pts[:, 1] >= 0) & (pts[:, 1] < Hw)
        return N[ym, xm], P[ym, xm], valid[ym, xm] & inside

    out_rows: list[dict] = []
    plans: list[dict] = []
    for b in rec["boxes"]:
        i = int(b["index"])
        poly = np.float64(b["polygon"])
        outline = np.float64(b["outline"]) if b.get("outline") and len(b["outline"]) >= 3 else None
        c, a, n, L, W, tilt = axis_of(poly)
        row = {"id": f"{rec['id']}:{i}", "index": i, "tilt": round(tilt, 1), "length": round(L, 1),
               "top": {"status": "untouched"}, "bottom": {"status": "untouched"}}
        fr = frows.get(i) or {}
        row["elevationDeg"] = fr.get("elevationDeg")
        plan = {"index": i, "poly": poly, "outline": outline, "c": c, "a": a, "n": n, "L": L, "W": W, "top": None, "bottom": None}
        plans.append(plan)
        out_rows.append(row)
        if outline is None:
            row["top"]["status"] = row["bottom"]["status"] = "no-outline"
            continue
        if tilt > UPRIGHT_DEG:
            row["top"]["status"] = row["bottom"]["status"] = "lying"
            continue
        frame = frame_of(i)
        if frame is None:
            row["top"]["status"] = row["bottom"]["status"] = "no-frame"
            continue
        ot = (outline - c) @ a
        t_top0, t_bot0 = float(ot.min()), float(ot.max())
        row["outlineEnds"] = [round(t_top0, 1), round(t_bot0, 1)]

        # The box's own spine-plane offset and side position from its front pixels on the strip inside its outline ends.
        pts, bins = strip_samples(c, a, n, t_top0, t_bot0, STRIP * W, step)
        nn, pp, ok = sample(pts)
        cls0 = F.classify(nn[ok], pp[ok], frame)
        fp = pp[ok][cls0 == 0]
        if len(fp) < 20:
            row["top"]["status"] = row["bottom"]["status"] = "few-front"
            continue
        frame = {**frame, "offset": float(np.median(fp @ frame["front"]))}
        a_i = float(np.median(fp @ frame["side"]))

        # Top: the front-to-top crease.
        t0, t1 = t_top0 - TOP_BEYOND * L, t_top0 + TOP_INSIDE * L
        pts, bins = strip_samples(c, a, n, t0, t1, STRIP * W, step)
        nn, pp, ok = sample(pts)
        nb = int(bins.max()) + 1
        cls = np.full(len(pts), -1, np.int8)
        cls[ok] = F.classify(nn[ok], pp[ok], frame)
        cnt = np.maximum(np.bincount(bins, weights=ok, minlength=nb), 1)
        f = np.bincount(bins, weights=cls == 0, minlength=nb) / cnt
        g = np.bincount(bins, weights=cls == 2, minlength=nb) / cnt
        win = max(WIN_MIN_PX, int(round(WIN_SHARE * L / step)))
        cr = crease(f, g, win)
        if cr is None:
            row["top"]["status"] = "short"
        else:
            j, top_share, front_share = cr
            row["top"].update({"topShare": round(top_share, 3), "frontShare": round(front_share, 3)})
            if top_share >= TOP_MIN and front_share >= FRONT_MIN:
                t_star = t0 + (j - 0.5) * step
                q = c + t_star * a
                xm, ym = int(round(q[0] * scale)), int(round(q[1] * scale))
                X = P[min(max(ym, 0), Hm - 1), min(max(xm, 0), Wm - 1)].astype(np.float64)
                line = end_line(X, frame["side"], K, Wm, Hm, scale) if np.isfinite(X).all() else None
                if line is None:  # no usable 3D point: a line across the axis
                    line = (q, n.copy())
                else:
                    line = (q, line[1])  # through the crease on the axis, along the projected side direction
                tn = axis_t(c, a, line)
                if tn is not None:
                    plan["top"] = line
                    row["top"].update({"status": "snapped", "t": round(tn, 1), "moveOutline": round(tn - t_top0, 1),
                                       "moveBox": round(tn + L / 2, 1)})
                else:
                    row["top"]["status"] = "parallel"
            else:
                row["top"]["status"] = "no-crease"

        # Bottom: the board top, or the lip that hides it.
        r = rows.get(fr.get("band"))
        if fr.get("ownPlane") or r is None:
            row["bottom"]["status"] = "no-row"
        elif r.get("levelSource") not in ("board", "lip"):
            row["bottom"]["status"] = "no-plane"
        else:
            nf = F.unit(np.array(r["frame"]["front"]))
            u = F.unit(np.array(r["frame"]["up"]))
            s = F.unit(np.cross(u, nf))
            fpr = fp  # front pixels in the band's frame: the same frame for a box that is not ownPlane
            ai, ci = float(np.median(fpr @ s)), float(np.median(fpr @ nf))
            cands = []
            contact = end_line(ai * s + r["level"] * u + ci * nf, s, K, Wm, Hm, scale)
            if contact is not None:
                cands.append(("board" if r["levelSource"] == "board" else "lip-level", contact))
            lip = r["planes"]["lip"]
            if lip.get("found"):
                nl = np.array(lip["normal"])
                h = lip["up"][1]
                den = float(nl @ nf)
                if abs(den) > 1e-6:
                    cl = (lip["d"] - ai * float(nl @ s) - h * float(nl @ u)) / den
                    le = end_line(ai * s + h * u + cl * nf, s, K, Wm, Hm, scale)
                    if le is not None:
                        cands.append(("lip-edge", le))
            ts = [(axis_t(c, a, ln), k, ln) for k, ln in cands]
            ts = [x for x in ts if x[0] is not None]
            if not ts:
                row["bottom"]["status"] = "no-line"
            else:
                tb, kind, line = min(ts, key=lambda x: x[0])
                row["bottom"].update({"source": kind, "t": round(tb, 1), "moveOutline": round(tb - t_bot0, 1),
                                      "moveBox": round(tb - L / 2, 1)})
                if abs(tb - t_bot0) <= BOTTOM_MAX * L:
                    plan["bottom"] = line
                    row["bottom"]["status"] = "snapped"
                else:
                    row["bottom"]["status"] = "implausible"
        row["a_i"] = round(a_i, 4)

    # New masks: cut to each snapped line, grown to it where it lies past the outline.
    own = labels.astype(np.int32)
    grow_best = np.full((Hw, Ww), np.inf, np.float32)
    grow_owner = np.zeros((Hw, Ww), np.int32)
    masks: dict[int, tuple[np.ndarray, tuple[int, int, int, int]]] = {}
    for p in plans:
        if p["outline"] is None:
            continue
        c, a, n, L = p["c"], p["a"], p["n"], p["L"]
        reach = 0.3 * L
        pts = np.vstack([p["poly"], p["outline"]])
        x0, y0 = np.floor(pts.min(axis=0) - reach).astype(int)
        x1, y1 = np.ceil(pts.max(axis=0) + reach).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, Ww), min(y1, Hw)
        m = np.zeros((y1 - y0, x1 - x0), np.uint8)
        cv2.fillPoly(m, [np.round(p["outline"] - [x0, y0]).astype(np.int32)], 1)
        m = m.astype(bool)
        if p["top"] is None and p["bottom"] is None:
            masks[p["index"]] = (m, (x0, y0, x1, y1))
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        rel = np.stack([xx - c[0], yy - c[1]], -1).astype(np.float64)
        T, A = rel @ a, rel @ n
        ys, xs = np.nonzero(m)
        mt, ma = T[ys, xs], A[ys, xs]
        lo_t, hi_t = float(mt.min()), float(mt.max())
        for end in ("top", "bottom"):
            line = p[end]
            if line is None:
                continue
            q, d = line
            side_c = math.copysign(1.0, cross2(c - q, d)) if abs(cross2(c - q, d)) > 1e-9 else 1.0
            sgn = ((xx - q[0]) * d[1] - (yy - q[1]) * d[0]) * side_c
            inside = sgn >= 0
            mid = (lo_t + hi_t) / 2
            zone = np.abs(mt - mid) <= SIDE_ZONE * (hi_t - lo_t) / 2
            if zone.sum() >= 10:
                alo, ahi = np.percentile(ma[zone], [5, 95])
            else:
                alo, ahi = -p["W"] / 2, p["W"] / 2
            # The spine's column on this end's half, so a mask's tapered end is filled out to the line too.
            beyond = (T < mid) if end == "top" else (T > mid)
            grow = beyond & inside & (A >= alo) & (A <= ahi)
            o = own[y0:y1, x0:x1]
            grow &= (o == 0) | (o == p["index"] + 1)
            m = (m & inside) | grow
            gy, gx = np.nonzero(grow)
            dist = np.abs(A[gy, gx]).astype(np.float32)
            gb = grow_best[y0:y1, x0:x1]
            go = grow_owner[y0:y1, x0:x1]
            better = dist < gb[gy, gx]
            gb[gy[better], gx[better]] = dist[better]
            go[gy[better], gx[better]] = p["index"] + 1
        masks[p["index"]] = (m, (x0, y0, x1, y1))

    count_before = np.zeros((Hw, Ww), np.uint8)
    count_after = np.zeros((Hw, Ww), np.uint8)
    new_labels = np.zeros((Hw, Ww), np.uint16)
    for p, row in zip(plans, out_rows):
        if p["outline"] is None:
            continue
        i = p["index"]
        m, (x0, y0, x1, y1) = masks[i]
        mb = np.zeros_like(m, np.uint8)
        cv2.fillPoly(mb, [np.round(p["outline"] - [x0, y0]).astype(np.int32)], 1)
        count_before[y0:y1, x0:x1] += mb
        if p["top"] is not None or p["bottom"] is not None:
            go = grow_owner[y0:y1, x0:x1]
            # A grown pixel another box grew into from nearer its axis is that box's.
            m = m & ~((go != 0) & (go != i + 1) & (mb == 0))
            k, comp, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
            if k > 1:
                m = comp == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            if not cs:
                row["lost"] = True
                continue
            cont = max(cs, key=cv2.contourArea)[:, 0, :] + [x0, y0]
            row["outline"] = cont.astype(float).tolist()
            mo = np.zeros_like(m, np.uint8)
            cv2.fillPoly(mo, [np.round(cont - [x0, y0]).astype(np.int32)], 1)
            count_after[y0:y1, x0:x1] += mo
            sub = new_labels[y0:y1, x0:x1]
            sub[(mo > 0) & (sub == 0)] = i + 1
            # The box: the detection rectangle with each snapped end moved to its line's crossing of the axis.
            c, a, n, L, W = p["c"], p["a"], p["n"], p["L"], p["W"]
            tt = row["top"]["t"] if p["top"] is not None else -L / 2
            tb = row["bottom"]["t"] if p["bottom"] is not None else L / 2
            quad = [c + tt * a - W / 2 * n, c + tt * a + W / 2 * n, c + tb * a + W / 2 * n, c + tb * a - W / 2 * n]
            row["polygon"] = [[round(float(x), 1), round(float(y), 1)] for x, y in quad]
            row["areaBefore"], row["areaAfter"] = int(mb.sum()), int(mo.sum())
        else:
            count_after[y0:y1, x0:x1] += mb
            sub = new_labels[y0:y1, x0:x1]
            sub[(mb > 0) & (sub == 0)] = i + 1
    photo = {"id": rec["id"], "photo": True,
             "overlapBefore": [int((count_before >= 2).sum()), int((count_before >= 1).sum())],
             "overlapAfter": [int((count_after >= 2).sum()), int((count_after >= 1).sum())]}
    if out_dir is not None:
        (out_dir / "labels").mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out_dir / "labels" / f"{rec['id']}.png"), new_labels)
    return out_rows, photo


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--out", default=None, help="private folder for the new label maps")
    ap.add_argument("--only", nargs="*", default=None)
    args = ap.parse_args()
    out_dir = Path(args.out) if args.out else None
    for line in open(args.inputs):
        rec = json.loads(line)
        if args.only and rec["id"] not in args.only:
            continue
        t = time.time()
        rows, photo = run_photo(rec, out_dir)
        photo["seconds"] = round(time.time() - t, 2)
        for r in rows:
            sys.stdout.write(json.dumps(r) + "\n")
        sys.stdout.write(json.dumps(photo) + "\n")
        sys.stdout.flush()
        snapped = sum(r["top"]["status"] == "snapped" for r in rows), sum(r["bottom"]["status"] == "snapped" for r in rows)
        print(f"{rec['id'][:8]} {len(rows)} boxes, snapped top {snapped[0]} bottom {snapped[1]}, {photo['seconds']}s", file=sys.stderr)


if __name__ == "__main__":
    main()
