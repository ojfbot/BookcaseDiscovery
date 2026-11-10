"""S-2 headroom map: what lies between each shelf row's book tops and the board above, from the depth stage's cache.

Per photo, for each S-1 row (``shelf.py`` re-run on F-0i's partition; its frame n_f, u, s = u x n_f, spine-plane
offset c, books' top bt and level), at the depth map's resolution:

**Top curve.** Per map column across the row's standing books, the median of the F-0f top lines (``rowFits`` on the
partition, top ends from the exclusive outlines: src/eval/s2.ts ``partitionTops``) of the row's fitted boxes whose
x-extent covers it; other columns are interpolated (``np.interp``, flat past the ends).

**Board line** (source ``lip``). The row's pitch partner above (S-1's ``pitches``), when its lip is found: its face
is the valid pixels within ``INLIER_M`` of the lip plane, u . P (that row's frame) in its inliers' p5 - ``PAD_M`` to
p95 + ``PAD_M`` and s . P in its side extent +- ``SIDE_PAD_M``. Per column the lowest face pixel above the top curve;
a Theil-Sen line through them, kept when they cover ``MIN_COLS`` of the columns. Otherwise the row is ``open``: the
region runs one row spine height (the fits' median ``h``) above the top curve, and is reported apart.

**Region and book pixels.** Per column, the pixels strictly between the board line and the top curve. A region pixel
is a ``book`` pixel when inside a kept standing box's exclusive outline (long side within ``FLAT_DEG`` of vertical),
or when it faces up (H-1's ``top``), lies at most ``BOOK_TOP_M`` above bt and is not behind the spine plane by more
than faces.py's ``BEHIND_M``: a standing book's own top face. The rest is **headroom**.

**Classes** of a headroom pixel, in order: ``unknown`` (no valid depth); ``occluded`` (on the board above's lip face,
or facing down: faces.py's ``under``); ``empty`` (more than ``BEHIND_M`` behind the spine plane: the back panel or the
case's inside seen past the books); ``unknown`` (more than ``FRONT_M`` in front of it: foreground); else an occupied
candidate. Candidates join into 8-connected components; one of at least max(``MIN_PX``, (``MIN_W`` median spine
widths)^2) map pixels is an **occupied region**, a smaller one ``unknown`` (speckle).

Per region: its outer contour and minimum-area rectangle (working-copy pixels), its pixels, its height above bt and
offset from c (MoGe-2 metres, scale unverified), its class mix, and every box it overlaps with the share of its pixels
inside that box; ``explainedBy`` is the kind of the box holding the largest share when that share is at least
``EXPLAIN``. Per known box (``stacked``, ``not-a-book``, ``on-lip``): its valid pixels, how many are headroom and how
many occupied.

Every threshold above was fixed before the first full run (evals/S2/report.md, Pre-registration).

    python -I headroom.py --inputs inputs.jsonl [--maps DIR] > headroom.jsonl

Known boxes' counts are kept apart for rows with a board line (``headroomPx``, ``occupiedPx``) and open rows
(``openHeadroomPx``, ``openOccupiedPx``).

``inputs.jsonl``: one line per photo, from src/eval/s2-cli.ts: ``{id, width, height, npz, faces, medianWidth,
standing: [{box, outline}], tops: {box: {a, b, h, x0, x1}}, rows: [{band, frame, c, b0, bt, level, elevationDeg,
above: {band, frame, lip: {normal, d, up, side}} | null}], boxes: [{box, kind, why, polygon}]}``, all in working-copy
pixels. stdout: one line per photo. ``--maps`` writes a label PNG per photo at map resolution (1 empty, 2 occluded,
3 occupied, 4 unknown, 5 book). Everything is private photo geometry; stderr carries progress only.
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
sys.path.insert(0, str(HERE))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import faces as F  # noqa: E402
from shelf import theil_sen  # noqa: E402

INLIER_M, PAD_M, SIDE_PAD_M, MIN_COLS = 0.015, 0.01, 0.05, 0.2  # S-1's inlier distance, on-lip face and span bar
FLAT_DEG = 60.0  # F-0c's NOT_A_BOOK.flatDeg: a box lying flat
BOOK_TOP_M = 0.03
FRONT_M = 0.15
MIN_PX, MIN_W = 30, 0.5
EXPLAIN = 0.3
LABELS = {"empty": 1, "occluded": 2, "occupied": 3, "unknown": 4, "book": 5}
UNKNOWN = ("invalid", "foreground", "speckle")


def poly_fill(lab: np.ndarray, poly_map: np.ndarray, value: int) -> None:
    cv2.fillPoly(lab, [np.round(poly_map).astype(np.int32)], value)


def local_mask(poly_map: np.ndarray, H: int, W: int) -> tuple[np.ndarray, tuple[int, int, int, int]] | None:
    """The polygon's pixels in its own bounding window (no erosion: overlaps are measured, not book faces)."""
    x0, y0 = np.floor(poly_map.min(axis=0)).astype(int) - 1
    x1, y1 = np.ceil(poly_map.max(axis=0)).astype(int) + 2
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    m = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(m, [np.round(poly_map - [x0, y0]).astype(np.int32)], 1)
    return m.astype(bool), (x0, y0, x1, y1)


def top_curve(cols: np.ndarray, fits: list[dict], scale: float) -> np.ndarray:
    """Per column, the median top line of the fits covering it; uncovered columns interpolated."""
    y = np.full(len(cols), np.nan)
    vals: list[list[float]] = [[] for _ in cols]
    for f in fits:
        lo, hi = f["x0"] * scale, f["x1"] * scale
        k = np.flatnonzero((cols >= lo) & (cols <= hi))
        yy = f["a"] * cols[k] + f["b"] * scale
        for i, v in zip(k, yy):
            vals[i].append(float(v))
    for i, v in enumerate(vals):
        if v:
            y[i] = float(np.median(v))
    ok = np.isfinite(y)
    if not ok.any():
        return y
    return np.interp(cols, cols[ok], y[ok])


def lip_face(P: np.ndarray, valid: np.ndarray, lip: dict, frame: dict) -> np.ndarray:
    """Boolean over P's leading dims: on the lip's face (within INLIER_M of its plane, inside its up and side range)."""
    nf, u = F.unit(np.array(frame["front"])), F.unit(np.array(frame["up"]))
    s = F.unit(np.cross(u, nf))
    n = np.array(lip["normal"])
    uu, ss = P @ u, P @ s
    return valid & (np.abs(P @ n - lip["d"]) <= INLIER_M) & (uu >= lip["up"][0] - PAD_M) & (uu <= lip["up"][1] + PAD_M) & \
        (ss >= lip["side"][0] - SIDE_PAD_M) & (ss <= lip["side"][1] + SIDE_PAD_M)


def sample_line(cols: np.ndarray, y: np.ndarray, scale: float, every: int = 24) -> list[list[float]]:
    k = np.unique(np.concatenate([np.arange(0, len(cols), every), [len(cols) - 1]]))
    return [[round(float(cols[i]) / scale, 1), round(float(y[i]) / scale, 1)] for i in k]


def run_photo(rec: dict) -> tuple[dict, np.ndarray]:
    z = dict(np.load(rec["npz"]))
    N = F.unit(z["normal"].astype(np.float32))
    P = z["points"].astype(np.float32)
    valid = z["mask"] & np.isfinite(P).all(-1) & np.isfinite(N).all(-1)
    scale = float(z["scale"])
    H, W = N.shape[:2]
    frows = {r["box"]: r for r in json.loads(Path(rec["faces"]).read_text())["rows"]}
    mw = float(rec.get("medianWidth") or 0) * scale
    min_px = max(MIN_PX, (MIN_W * mw) ** 2)

    standing = np.zeros((H, W), np.int32)  # box index + 1 of the kept standing outline holding the pixel
    row_of_box: dict[int, int] = {}
    xext: dict[int, tuple[float, float]] = {}
    for sb in rec["standing"]:
        poly = np.float64(sb["outline"]) * scale
        poly_fill(standing, poly, sb["box"] + 1)
        fr = frows.get(sb["box"], {})
        if fr.get("band") is not None and fr.get("frame") == str(fr["band"]) and not fr.get("skip"):
            row_of_box[sb["box"]] = fr["band"]
        xext[sb["box"]] = (float(poly[:, 0].min()), float(poly[:, 0].max()))
    std_px = np.bincount(standing.ravel(), minlength=max(standing.max() + 1, 1))

    labels = np.zeros((H, W), np.uint8)
    rowmap = np.full((H, W), -1, np.int16)  # which row's headroom a pixel is, for its candidates' components
    cand = np.zeros((H, W), bool)
    tops = {int(k): v for k, v in (rec.get("tops") or {}).items()}
    rows_out = []
    row_ctx: dict[int, dict] = {}
    for row in rec["rows"]:
        b = row["band"]
        out: dict = {"band": b, "elevationDeg": row.get("elevationDeg")}
        members = [i for i, rb in row_of_box.items() if rb == b]
        fits = [tops[i] for i in members if i in tops]
        if not members or not fits:
            out["skip"] = "no-top-line"
            rows_out.append(out)
            continue
        xlo = max(0, math.ceil(min(xext[i][0] for i in members)))
        xhi = min(W - 1, math.floor(max(xext[i][1] for i in members)))
        if xhi <= xlo:
            out["skip"] = "no-columns"
            rows_out.append(out)
            continue
        cols = np.arange(xlo, xhi + 1)
        top = top_curve(cols, fits, scale)
        if not np.isfinite(top).all():
            out["skip"] = "no-top-line"
            rows_out.append(out)
            continue
        nf, u = F.unit(np.array(row["frame"]["front"])), F.unit(np.array(row["frame"]["up"]))
        s = F.unit(np.cross(u, nf))
        c, bt = row["c"], row["bt"]
        above = row.get("above")
        board = None
        face_sub = None
        if above and above.get("lip"):
            ytop = int(min(H, math.ceil(np.nanmax(top))))
            if ytop > 0:
                face_sub = lip_face(P[:ytop, xlo:xhi + 1], valid[:ytop, xlo:xhi + 1], above["lip"], above["frame"])
                face_sub &= np.arange(ytop)[:, None] < top[None, :]
                has = face_sub.any(axis=0)
                if has.sum() >= MIN_COLS * len(cols):
                    low = ytop - 1 - np.argmax(face_sub[::-1], axis=0)
                    xs, ys = cols[has].astype(np.float64), low[has].astype(np.float64)
                    k = slice(None, None, max(1, len(xs) // 400))
                    sl = theil_sen(xs[k], ys[k])
                    ic = float(np.median(ys - sl * xs))
                    board = sl * cols + ic
                    fp = P[:ytop, xlo:xhi + 1][face_sub]
                    ceil_m = float(np.percentile(fp @ u, 5))
                    out["gapM"] = round(ceil_m - bt, 4)
                    out["pitchUpM"] = round(ceil_m - row["level"], 4)
                    out["aboveBand"] = above["band"]
        if board is None:
            h = float(np.median([f["h"] for f in fits])) * scale
            board = top - h
            out["source"] = "open"
        else:
            out["source"] = "lip"
        # Region pixels: strictly between the board line and the top curve, per column.
        y0 = np.clip(np.floor(board).astype(int) + 1, 0, H)
        y1 = np.clip(np.ceil(top).astype(int), 0, H)
        n = np.maximum(y1 - y0, 0)
        out["cols"] = int(len(cols))
        out["topLine"] = sample_line(cols, top, scale)
        out["boardLine"] = sample_line(cols, board, scale)
        if n.sum() == 0:
            out.update({"regionPx": 0, "bookPx": 0, "headroomPx": 0, "standingPx": int(sum(std_px[i + 1] for i in members)),
                        "classes": {k: 0 for k in ("empty", "occluded", "occupied", *(f"unknown-{x}" for x in UNKNOWN))}})
            rows_out.append(out)
            continue
        ry = np.concatenate([np.arange(a, a + m) for a, m in zip(y0, n) if m > 0])
        rx = np.repeat(cols, n)
        free = rowmap[ry, rx] < 0  # a pixel already in an earlier row's region stays there
        ry, rx = ry[free], rx[free]
        vv = valid[ry, rx]
        Pp, Np = P[ry, rx], N[ry, rx]
        cls = np.full(len(ry), -1, np.int8)
        frame = {"front": nf, "up": u, "side": s, "offset": c}
        if vv.any():
            cls[vv] = F.classify(Np[vv], Pp[vv], frame)
        dd, uu = Pp @ nf, Pp @ u
        book = (standing[ry, rx] > 0) | (vv & (cls == 2) & (uu <= bt + BOOK_TOP_M) & (dd >= c - F.BEHIND_M))
        on_lip = np.zeros(len(ry), bool)
        if face_sub is not None:
            inside = ry < face_sub.shape[0]
            on_lip[inside] = face_sub[ry[inside], rx[inside] - xlo]
        hr = ~book
        k_inv = hr & ~vv
        k_occ = hr & vv & (on_lip | (cls == 3))
        k_emp = hr & vv & ~k_occ & (dd < c - F.BEHIND_M)
        k_fg = hr & vv & ~k_occ & ~k_emp & (dd > c + FRONT_M)
        k_cand = hr & vv & ~k_occ & ~k_emp & ~k_fg
        rowmap[ry, rx] = len(rows_out)
        labels[ry[book], rx[book]] = LABELS["book"]
        labels[ry[k_emp], rx[k_emp]] = LABELS["empty"]
        labels[ry[k_occ], rx[k_occ]] = LABELS["occluded"]
        labels[ry[k_inv | k_fg], rx[k_inv | k_fg]] = LABELS["unknown"]
        cand[ry[k_cand], rx[k_cand]] = True
        out.update({"regionPx": int(len(ry)), "bookPx": int(book.sum()), "headroomPx": int(hr.sum()),
                    "standingPx": int(sum(std_px[i + 1] for i in members)),
                    "classes": {"empty": int(k_emp.sum()), "occluded": int(k_occ.sum()), "occupied": 0,
                                "unknown-invalid": int(k_inv.sum()), "unknown-foreground": int(k_fg.sum()), "unknown-speckle": 0}})
        row_ctx[len(rows_out)] = {"nf": nf, "u": u, "c": c, "bt": bt}
        rows_out.append(out)

    # Occupied regions: 8-connected components of the candidates, per row.
    regions = []
    ncomp, comp, stats, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), connectivity=8)
    box_masks = []
    for bx in rec.get("boxes") or []:
        lm = local_mask(np.float64(bx["polygon"]) * scale, H, W)
        if lm is not None:
            box_masks.append((bx, lm))
    for k in range(1, ncomp):
        x, y, w, h, area = (int(v) for v in stats[k])
        sub = comp[y:y + h, x:x + w] == k
        rid = int(np.bincount(rowmap[y:y + h, x:x + w][sub].astype(np.int64)).argmax())
        ro = rows_out[rid]
        if area < min_px:
            labels[y:y + h, x:x + w][sub] = LABELS["unknown"]
            ro["classes"]["unknown-speckle"] += area
            continue
        labels[y:y + h, x:x + w][sub] = LABELS["occupied"]
        ro["classes"]["occupied"] += area
        ctx = row_ctx[rid]
        yy, xx = np.nonzero(sub)
        Pr, Nr = P[yy + y, xx + x], N[yy + y, xx + x]
        cl = F.classify(Nr, Pr, {"front": ctx["nf"], "up": ctx["u"], "side": F.unit(np.cross(ctx["u"], ctx["nf"])), "offset": ctx["c"]})
        mix = np.bincount(cl.astype(np.int64), minlength=6)
        cnts, _ = cv2.findContours(sub.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnt = max(cnts, key=cv2.contourArea)
        rect = cv2.boxPoints(cv2.minAreaRect((cnt + [x, y]).astype(np.float32)))
        overlaps = []
        for bx, (m, (bx0, by0, bx1, by1)) in box_masks:
            ix0, iy0, ix1, iy1 = max(x, bx0), max(y, by0), min(x + w, bx1), min(y + h, by1)
            if ix1 <= ix0 or iy1 <= iy0:
                continue
            inter = int((sub[iy0 - y:iy1 - y, ix0 - x:ix1 - x] & m[iy0 - by0:iy1 - by0, ix0 - bx0:ix1 - bx0]).sum())
            if inter:
                overlaps.append({"box": bx["box"], "kind": bx["kind"], "why": bx.get("why"), "share": round(inter / area, 3)})
        overlaps.sort(key=lambda o: -o["share"])
        best = overlaps[0] if overlaps and overlaps[0]["share"] >= EXPLAIN else None
        regions.append({
            "band": ro["band"], "source": ro.get("source"), "px": area,
            "contour": [[round((float(px) + x) / scale, 1), round((float(py) + y) / scale, 1)] for px, py in cnt[:, 0, :]],
            "rect": [[round(float(px) / scale, 1), round(float(py) / scale, 1)] for px, py in rect],
            "aboveTopM": round(float(np.median(Pr @ ctx["u"]) - ctx["bt"]), 4),
            "dSpineM": round(float(np.median(Pr @ ctx["nf"]) - ctx["c"]), 4),
            "classes": {F.CLASSES[i]: int(mix[i]) for i in range(6) if mix[i]},
            "dominant": F.CLASSES[int(mix.argmax())],
            "overlaps": overlaps,
            "explainedBy": None if best is None else best["kind"],
        })

    # Known boxes, counted apart in rows with a board line and in open rows (reported apart).
    lip_rows = np.array([i for i, r in enumerate(rows_out) if r.get("source") == "lip"], np.int16)
    known = []
    for bx, (m, (bx0, by0, bx1, by1)) in box_masks:
        if bx["kind"] not in ("stacked", "not-a-book", "on-lip"):
            continue
        lab = labels[by0:by1, bx0:bx1][m]
        vm = valid[by0:by1, bx0:bx1][m]
        rm = rowmap[by0:by1, bx0:bx1][m]
        hr = (lab >= 1) & (lab <= 4) & vm
        occ = (lab == LABELS["occupied"]) & vm
        lip = np.isin(rm, lip_rows)
        known.append({"box": bx["box"], "kind": bx["kind"], "why": bx.get("why"), "validPx": int(vm.sum()),
                      "headroomPx": int((hr & lip).sum()), "occupiedPx": int((occ & lip).sum()),
                      "openHeadroomPx": int((hr & ~lip).sum()), "openOccupiedPx": int((occ & ~lip).sum())})
    return {"id": rec["id"], "photo": True, "mapSize": [W, H], "scale": scale, "rows": rows_out, "regions": regions,
            "known": known}, labels


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--maps", default=None, help="private folder for per-photo label PNGs")
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
        print(f"{rec['id'][:8]} {len(out['rows'])} rows {len(out['regions'])} regions {out['seconds']}s", file=sys.stderr)


if __name__ == "__main__":
    main()
