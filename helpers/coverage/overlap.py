"""F-R1: how often detected books overlap, by box and by mask, on cached data only (no model runs).

Boxes are each set's default (detect.jsonl polygons, the shipped not-a-book filter applied via Q-2b's table ids);
masks are the cached SAM 2.1 box-prompted outlines (Q-2b for pilot-000, F-0b for the yardstick). In a photo, two
oriented boxes may overlap legitimately (leaning books, perspective); two masks may not: each visible pixel belongs
to one book. Per-pair and per-box rows go to the data root's private fr1 folder; stdout is aggregates only (metrics JSON).
Optional depth cue: H-2's cached MoGe-2 point maps (looked up by the photo's sha256, as helpers/depth/stage.py keys
them).

    python -I overlap.py --set pilot-000 --detect D --outlines O --table T --faces F --images I > metrics.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
GEOMETRY = DATA / "private" / "h2" / "cache" / "geometry" / "moge-2-vitl-normal@cb0e8bb"
UPRIGHT_DEG, FLAT_DEG = 30, 60  # as detect.py
CONFLICT_IOS = 0.01  # masks sharing at least this share of the smaller one are in pixel conflict
NEST_IOS = 0.8  # this share of the smaller one inside the other: nested
DUP_IOU = 0.5  # this IoU: the same book twice
ADJ_WIDTHS = 0.25  # boxes grown by this many median spine widths that touch are neighbours
INTRUDE = 0.10  # a reader crop with at least this share of neighbour-mask pixels takes in a neighbour
DEPTH_SEP = 0.03  # exclusive parts whose median depths differ by this share are depth-separated
CLIP_ALONG, CLIP_ACROSS = 0.03, 0.08  # U-4's box growth (src/report/display-draw.ts growQuad)
BOOT, SEED = 1000, 1


def read_jsonl(p: str) -> list[dict]:
    return [json.loads(l) for l in open(p) if l.strip()]


def rect_of(poly) -> tuple:
    return cv2.minAreaRect(np.array(poly, dtype=np.float32))


def geometry(rect) -> dict:
    p = cv2.boxPoints(rect)
    e1, e2 = p[1] - p[0], p[2] - p[1]
    v = e1 if np.linalg.norm(e1) >= np.linalg.norm(e2) else e2
    long, short = max(np.linalg.norm(e1), np.linalg.norm(e2)), min(np.linalg.norm(e1), np.linalg.norm(e2))
    v = v / max(np.linalg.norm(v), 1e-6)
    if v[1] < 0 or (v[1] == 0 and v[0] < 0):
        v = -v
    tilt = math.degrees(math.atan2(abs(v[0]), abs(v[1])))
    return {"c": np.array(rect[0]), "u": v, "long": float(long), "short": float(short), "tilt": tilt,
            "lean": math.degrees(math.atan2(float(v[0]), float(v[1])))}


def rect_inter(a, b) -> float:
    kind, inter = cv2.rotatedRectangleIntersection(a, b)
    if kind == cv2.INTERSECT_NONE or inter is None:
        return 0.0
    return float(cv2.contourArea(cv2.convexHull(inter)))


def grow(rect, by: float) -> tuple:
    return (rect[0], (rect[1][0] + 2 * by, rect[1][1] + 2 * by), rect[2])


def orient(t: float) -> str:
    return "upright" if t <= UPRIGHT_DEG else "lying" if t > FLAT_DEG else "oblique"


def raster(poly, x0: int, y0: int, w: int, h: int) -> np.ndarray:
    m = np.zeros((h, w), np.uint8)
    pts = np.round(np.array(poly, dtype=np.float64) - [x0, y0]).astype(np.int32)
    cv2.fillPoly(m, [pts], 1)
    return m.astype(bool)


def bbox(poly, W: int, H: int) -> tuple[int, int, int, int]:
    a = np.array(poly)
    return (max(int(math.floor(a[:, 0].min())), 0), max(int(math.floor(a[:, 1].min())), 0),
            min(int(math.ceil(a[:, 0].max())) + 1, W), min(int(math.ceil(a[:, 1].max())) + 1, H))


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def depth_index(images: str | None) -> dict[str, Path]:
    if not images or not GEOMETRY.exists():
        return {}
    by_sha = {json.load(open(j))["image"]: j.with_suffix(".npz") for j in GEOMETRY.glob("*.json")}
    out = {}
    for r in read_jsonl(images):
        s = sha256(r["image"])
        if s in by_sha:
            out[r["id"]] = by_sha[s]
    return out


def third(y: float, H: int) -> str:
    return "top third" if y < H / 3 else "middle third" if y < 2 * H / 3 else "bottom third"


def elev_band(e) -> str:
    if e is None:
        return "unknown"
    return "below eye level" if e < -10 else "above eye level" if e > 10 else "level"


def photo(d: dict, keep: dict, outlines: dict, faces: dict, depth: Path | None) -> tuple[list[dict], list[dict], dict]:
    W, H = d["width"], d["height"]
    boxes = []
    for i, s in enumerate(d["spines"]):
        bid = f"{d['id']}:{i}"
        if bid not in keep:
            continue
        r = rect_of(s["polygon"])
        g = geometry(r)
        boxes.append({"id": bid, "rect": r, "poly": cv2.boxPoints(r), "g": g, "frag": keep[bid]["fragment"],
                      "rung": keep[bid]["rung"], "outline": outlines.get(bid), "elev": faces.get(bid)})
    n = len(boxes)
    medw = float(np.median([b["g"]["short"] for b in boxes])) if boxes else 0.0
    # Mask rasters in their own boxes, and a per-photo claim count.
    count = np.zeros((H, W), np.uint8)
    for b in boxes:
        if b["outline"] and len(b["outline"]) >= 3:
            x0, y0, x1, y1 = bbox(b["outline"], W, H)
            if x1 > x0 and y1 > y0:
                m = raster(b["outline"], x0, y0, x1 - x0, y1 - y0)
                b["m"], b["mb"] = m, (x0, y0, x1, y1)
                b["marea"] = int(m.sum())
                count[y0:y1, x0:x1] += m
    claimed = int((count >= 1).sum())
    multi = int((count >= 2).sum())
    # Baseline with no model: each mask clipped to its own box, grown as U-4 draws it (3 % along, 8 % across).
    clipped = np.zeros((H, W), np.uint8)
    for b in boxes:
        if "m" in b:
            x0, y0, x1, y1 = b["mb"]
            g = b["rect"]
            gr = (g[0], (g[1][0] * (1 + (CLIP_ALONG if g[1][0] >= g[1][1] else CLIP_ACROSS)),
                         g[1][1] * (1 + (CLIP_ALONG if g[1][1] > g[1][0] else CLIP_ACROSS))), g[2])
            clipped[y0:y1, x0:x1] += b["m"] & raster(cv2.boxPoints(gr), x0, y0, x1 - x0, y1 - y0)
    claimed_c, multi_c = int((clipped >= 1).sum()), int((clipped >= 2).sum())

    pts = nrm = None
    if depth is not None:
        z = np.load(depth)
        pts, nrm, valid = z["points"].astype(np.float32), z["normal"].astype(np.float32), z["mask"]
        pts[~valid] = np.nan
    ds = (pts.shape[1] / W) if pts is not None else 0.0

    def dstats(mask: np.ndarray, x0: int, y0: int) -> tuple[float | None, np.ndarray | None]:
        if pts is None or mask.sum() == 0:
            return None, None
        ys, xs = np.nonzero(mask)
        yy = np.clip(((ys + y0) * ds).astype(int), 0, pts.shape[0] - 1)
        xx = np.clip(((xs + x0) * ds).astype(int), 0, pts.shape[1] - 1)
        zz = pts[yy, xx, 2]
        zz = zz[np.isfinite(zz)]
        if zz.size < 5:
            return None, None
        nn = nrm[yy, xx].reshape(-1, 3)
        nn = nn[np.isfinite(nn).all(1)]
        nv = nn.mean(0) if len(nn) else None
        return float(np.median(zz)), (nv / max(np.linalg.norm(nv), 1e-6) if nv is not None else None)

    pairs = []
    for i in range(n):
        a = boxes[i]
        for j in range(i + 1, n):
            b = boxes[j]
            if np.linalg.norm(a["g"]["c"] - b["g"]["c"]) > (a["g"]["long"] + b["g"]["long"]) / 2 + 2 * medw:
                if not ("mb" in a and "mb" in b and not (a["mb"][2] <= b["mb"][0] or b["mb"][2] <= a["mb"][0] or
                                                        a["mb"][3] <= b["mb"][1] or b["mb"][3] <= a["mb"][1])):
                    continue
            aa, ab = a["g"]["long"] * a["g"]["short"], b["g"]["long"] * b["g"]["short"]
            bi = rect_inter(a["rect"], b["rect"])
            adj = rect_inter(grow(a["rect"], ADJ_WIDTHS * medw), grow(b["rect"], ADJ_WIDTHS * medw)) > 0
            p = {"a": a["id"], "b": b["id"], "adjacent": bool(adj or bi > 0),
                 "boxIou": bi / max(aa + ab - bi, 1e-6), "boxIos": bi / max(min(aa, ab), 1e-6)}
            # arrangement along the pair's mean long axis
            u = a["g"]["u"] + (b["g"]["u"] if a["g"]["u"] @ b["g"]["u"] >= 0 else -b["g"]["u"])
            u = u / max(np.linalg.norm(u), 1e-6)
            off = b["g"]["c"] - a["g"]["c"]
            along, across = abs(off @ u), abs(off @ np.array([-u[1], u[0]]))
            ml, ms = (a["g"]["long"] + b["g"]["long"]) / 2, (a["g"]["short"] + b["g"]["short"]) / 2
            p["arrangement"] = "end to end" if along > 0.5 * ml and across < ms else "side by side"
            p["angleDiff"] = abs(a["g"]["lean"] - b["g"]["lean"])
            p["tiltMax"] = max(a["g"]["tilt"], b["g"]["tilt"])
            p["orient"] = "/".join(sorted([orient(a["g"]["tilt"]), orient(b["g"]["tilt"])]))
            p["frag"] = "/".join(sorted(["whole" if x["frag"] == "whole" else "piece" for x in (a, b)]))
            p["third"] = third((a["g"]["c"][1] + b["g"]["c"][1]) / 2, H)
            ev = [x["elev"] for x in (a, b) if x["elev"] is not None]
            p["elevation"] = elev_band(sum(ev) / len(ev) if ev else None)
            p["boxNested"] = p["boxIos"] >= NEST_IOS
            # masks
            p["hasMasks"] = "m" in a and "m" in b
            p["maskInter"] = 0
            if p["hasMasks"]:
                ax0, ay0, ax1, ay1 = a["mb"]
                bx0, by0, bx1, by1 = b["mb"]
                x0, y0, x1, y1 = max(ax0, bx0), max(ay0, by0), min(ax1, bx1), min(ay1, by1)
                if x1 > x0 and y1 > y0:
                    ma = a["m"][y0 - ay0:y1 - ay0, x0 - ax0:x1 - ax0]
                    mb = b["m"][y0 - by0:y1 - by0, x0 - bx0:x1 - bx0]
                    both = ma & mb
                    inter = int(both.sum())
                    p["maskInter"] = inter
                    if inter and pts is not None:
                        # depth of each mask's exclusive part and of the contested pixels
                        za, na = dstats(a["m"] & ~_paste(both, a["mb"], (x0, y0)), ax0, ay0)
                        zb, nb = dstats(b["m"] & ~_paste(both, b["mb"], (x0, y0)), bx0, by0)
                        zc, _ = dstats(both, x0, y0)
                        if za is not None and zb is not None:
                            p["depthRel"] = abs(za - zb) / max(min(za, zb), 1e-6)
                            if zc is not None:
                                p["contestedNearer"] = abs(zc - min(za, zb)) <= abs(zc - max(za, zb))
                            if na is not None and nb is not None:
                                p["normalDeg"] = math.degrees(math.acos(float(np.clip(na @ nb, -1, 1))))
                ia, ib = a["marea"], b["marea"]
                p["maskIou"] = inter_or0(p) / max(ia + ib - inter_or0(p), 1)
                p["maskIos"] = inter_or0(p) / max(min(ia, ib), 1)
            if p["boxIos"] == 0 and p["maskInter"] == 0 and not p["adjacent"]:
                continue
            pairs.append(p)

    # Box-overlap pixels, and each reader crop's neighbour pixels.
    lap = {"boxOverlapPx": 0, "bothMasks": 0, "oneMask": 0, "noMask": 0}
    rows = []
    for k, b in enumerate(boxes):
        x0, y0, x1, y1 = bbox(b["poly"], W, H)
        if x1 <= x0 or y1 <= y0:
            continue
        r = raster(b["poly"], x0, y0, x1 - x0, y1 - y0)
        own = np.zeros_like(r)
        if "m" in b:
            mx0, my0, mx1, my1 = b["mb"]
            ix0, iy0, ix1, iy1 = max(x0, mx0), max(y0, my0), min(x1, mx1), min(y1, my1)
            if ix1 > ix0 and iy1 > iy0:
                own[iy0 - y0:iy1 - y0, ix0 - x0:ix1 - x0] = b["m"][iy0 - my0:iy1 - my0, ix0 - mx0:ix1 - mx0]
        c = count[y0:y1, x0:x1].astype(np.int16) - own
        neigh = r & (c >= 1) & ~own  # another mask's pixels inside this crop
        shared = own & (c >= 1)  # this book's mask pixels another mask also claims
        rows.append({"id": b["id"], "rect": int(r.sum()), "neighbourInCrop": int(neigh.sum()),
                     "maskArea": int(own.sum()) if "m" in b else None, "maskShared": int(shared.sum()),
                     "frag": b["frag"], "rung": b["rung"], "hasMask": "m" in b,
                     "orient": orient(b["g"]["tilt"]), "elevation": elev_band(b["elev"]),
                     "third": third(b["g"]["c"][1], H)})
    # pixels of box overlaps (union over pairs) and who claims them
    boxcount = np.zeros((H, W), np.uint8)
    for b in boxes:
        x0, y0, x1, y1 = bbox(b["poly"], W, H)
        if x1 > x0 and y1 > y0:
            boxcount[y0:y1, x0:x1] += raster(b["poly"], x0, y0, x1 - x0, y1 - y0)
    ov = boxcount >= 2
    lap["boxOverlapPx"] = int(ov.sum())
    lap["bothMasks"] = int((ov & (count >= 2)).sum())
    lap["oneMask"] = int((ov & (count == 1)).sum())
    lap["noMask"] = int((ov & (count == 0)).sum())
    summary = {"photo": d["id"], "boxes": n, "masks": sum("m" in b for b in boxes), "claimedPx": claimed,
               "multiPx": multi, "claimedPxClipped": claimed_c, "multiPxClipped": multi_c, "medianWidth": medw, **lap}
    return pairs, rows, summary


def inter_or0(p: dict) -> int:
    return p.get("maskInter", 0) or 0


def _paste(sub: np.ndarray, into_bb: tuple, at: tuple) -> np.ndarray:
    x0, y0, x1, y1 = into_bb
    out = np.zeros((y1 - y0, x1 - x0), bool)
    ox, oy = at[0] - x0, at[1] - y0
    out[oy:oy + sub.shape[0], ox:ox + sub.shape[1]] = sub
    return out


# --- aggregates ----------------------------------------------------------------------------------------------------

def boot(by_photo: dict[str, tuple[float, float]], rng) -> tuple[float | None, float | None, float | None]:
    """Pooled share num/den with a 95 % photo bootstrap."""
    keys = list(by_photo)
    num = np.array([by_photo[k][0] for k in keys], float)
    den = np.array([by_photo[k][1] for k in keys], float)
    if den.sum() == 0:
        return None, None, None
    pt = num.sum() / den.sum()
    draws = []
    for _ in range(BOOT):
        idx = rng.integers(0, len(keys), len(keys))
        dd = den[idx].sum()
        if dd > 0:
            draws.append(num[idx].sum() / dd)
    lo, hi = np.percentile(draws, [2.5, 97.5])
    return round(float(pt), 4), round(float(lo), 4), round(float(hi), 4)


def share(items: list[dict], photo_of, num_pred, den_pred=lambda x: True, rng=None) -> dict:
    acc: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for x in items:
        if den_pred(x):
            k = photo_of(x)
            acc[k][1] += 1
            if num_pred(x):
                acc[k][0] += 1
    pt, lo, hi = boot({k: (v[0], v[1]) for k, v in acc.items()}, rng)
    n = int(sum(v[1] for v in acc.values()))
    return {"n": n, "k": int(sum(v[0] for v in acc.values())), "share": pt, "lo": lo, "hi": hi}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", required=True)
    ap.add_argument("--detect", required=True)
    ap.add_argument("--outlines", required=True)
    ap.add_argument("--table", required=True)
    ap.add_argument("--faces")
    ap.add_argument("--images")
    a = ap.parse_args()
    keep = {r["id"]: r for r in read_jsonl(a.table)}
    outlines = {r["id"]: r["outline"] for r in read_jsonl(a.outlines) if r.get("outline")}
    faces = {r["id"]: r.get("elevationDeg") for r in read_jsonl(a.faces)} if a.faces else {}
    depth = depth_index(a.images)
    out_dir = DATA / "private" / "fr1"
    out_dir.mkdir(parents=True, exist_ok=True)
    allp, allr, sums = [], [], []
    for d in read_jsonl(a.detect):
        if d.get("error"):
            continue
        p, r, s = photo(d, keep, outlines, faces, depth.get(d["id"]))
        for x in p:
            x["photo"] = d["id"]
        for x in r:
            x["photo"] = d["id"]
        allp += p
        allr += r
        sums.append(s)
    with open(out_dir / f"pairs-{a.set}.jsonl", "w") as f:
        for x in allp:
            f.write(json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in x.items()}) + "\n")
    with open(out_dir / f"boxes-{a.set}.jsonl", "w") as f:
        for x in allr:
            f.write(json.dumps(x) + "\n")
    with open(out_dir / f"photos-{a.set}.jsonl", "w") as f:
        for x in sums:
            f.write(json.dumps(x) + "\n")
    print(json.dumps(aggregate(a.set, allp, allr, sums, bool(depth)), indent=1))


def aggregate(name: str, pairs: list[dict], rows: list[dict], sums: list[dict], has_depth: bool) -> dict:
    rng = np.random.default_rng(SEED)
    ph = lambda x: x["photo"]  # noqa: E731
    adj = [p for p in pairs if p["adjacent"]]
    mp = [p for p in adj if p["hasMasks"]]
    conflict = lambda p: p.get("maskIos", 0) >= CONFLICT_IOS  # noqa: E731
    boxlap = lambda p: p["boxIos"] > 0  # noqa: E731

    def bins(key: str, edges: list[float], items: list[dict]) -> list[dict]:
        out = []
        for lo, hi in zip(edges[:-1], edges[1:]):
            k = sum(1 for p in items if lo < p.get(key, 0) <= hi)
            out.append({"range": f"({lo}, {hi}]", "pairs": k})
        return out

    res: dict = {"set": name, "photos": len(sums), "boxCount": sum(s["boxes"] for s in sums),
                 "boxesWithMask": sum(s["masks"] for s in sums), "adjacentPairs": len(adj),
                 "adjacentPairsWithMasks": len(mp), "pairsMaskOnly": sum(1 for p in pairs if not p["adjacent"])}
    # the invariant: pixels claimed by two or more masks
    res["pixelOverlapRate"] = dict(zip(["share", "lo", "hi"], boot({s["photo"]: (s["multiPx"], s["claimedPx"]) for s in sums}, rng)))
    res["pixelOverlapRateClippedToBox"] = dict(zip(["share", "lo", "hi"], boot({s["photo"]: (s["multiPxClipped"], s["claimedPxClipped"]) for s in sums}, rng)))
    res["boxOverlapPixels"] = {k: sum(s[k] for s in sums) for k in ("boxOverlapPx", "bothMasks", "oneMask", "noMask")}
    bo = res["boxOverlapPixels"]
    if bo["boxOverlapPx"]:
        res["boxOverlapPixels"].update({f"{k}Share": round(bo[k] / bo["boxOverlapPx"], 4) for k in ("bothMasks", "oneMask", "noMask")})
    res["adjacentPairsBoxOverlap"] = share(adj, ph, boxlap, rng=rng)
    res["adjacentPairsMaskConflict"] = share(mp, ph, conflict, rng=rng)
    res["boxOverlapPairsWithConflict"] = share(mp, ph, conflict, boxlap, rng=rng)
    res["conflictPairsWithoutBoxOverlap"] = share(mp, ph, lambda p: not boxlap(p), conflict, rng=rng)
    res["pairsPerHundredBoxes"] = {
        "boxOverlap": round(100 * sum(map(boxlap, adj)) / max(res["boxCount"], 1), 1),
        "maskConflict": round(100 * sum(map(conflict, mp)) / max(res["boxesWithMask"], 1), 1),
        "boxNested": round(100 * sum(p["boxNested"] for p in adj) / max(res["boxCount"], 1), 1)}
    res["boxIouBins"] = bins("boxIou", [0, 0.05, 0.2, 0.45, 1.0], [p for p in adj if boxlap(p)])
    res["boxIosBins"] = bins("boxIos", [0, 0.05, 0.2, 0.5, 0.8, 1.0], [p for p in adj if boxlap(p)])
    res["maskIouBins"] = bins("maskIou", [0, 0.05, 0.2, 0.5, 1.0], [p for p in mp if p.get("maskInter")])
    res["maskIosBins"] = bins("maskIos", [0, 0.01, 0.05, 0.2, 0.5, 0.8, 1.0], [p for p in mp if p.get("maskInter")])
    # what kind of conflict
    cp = [p for p in mp if conflict(p)]
    res["conflictTypes"] = {
        "duplicate (mask IoU >= 0.5)": sum(p["maskIou"] >= DUP_IOU for p in cp),
        "nested (mask IoS >= 0.8, IoU < 0.5)": sum(p["maskIos"] >= NEST_IOS and p["maskIou"] < DUP_IOU for p in cp),
        "partial (0.2 <= IoS < 0.8)": sum(0.2 <= p["maskIos"] < NEST_IOS and p["maskIou"] < DUP_IOU for p in cp),
        "boundary bleed (IoS < 0.2)": sum(p["maskIos"] < 0.2 for p in cp)}
    kind = lambda p: ("duplicate" if p["maskIou"] >= DUP_IOU else "nested" if p["maskIos"] >= NEST_IOS  # noqa: E731
                      else "partial" if p["maskIos"] >= 0.2 else "boundary bleed")
    px = defaultdict(int)
    for p in cp:
        px[kind(p)] += p["maskInter"]
    tot = max(sum(px.values()), 1)
    res["conflictTypePixelShare"] = {k: round(v / tot, 4) for k, v in sorted(px.items())}
    strata = {}
    for key in ("elevation", "third", "orient", "frag", "arrangement"):
        vals = sorted({p[key] for p in mp})
        strata[key] = {v: {"boxOverlap": share([p for p in adj if p[key] == v], ph, boxlap, rng=rng),
                           "maskConflict": share([p for p in mp if p[key] == v], ph, conflict, rng=rng),
                           "conflictGivenBoxOverlap": share([p for p in mp if p[key] == v], ph, conflict, boxlap, rng=rng)}
                       for v in vals}
    lean_bins = [("< 3 deg", 0, 3), ("3-10 deg", 3, 10), (">= 10 deg", 10, 1e9)]
    strata["angleDiff"] = {lab: {"boxOverlap": share([p for p in adj if lo <= p["angleDiff"] < hi], ph, boxlap, rng=rng),
                                 "maskConflict": share([p for p in mp if lo <= p["angleDiff"] < hi], ph, conflict, rng=rng),
                                 "conflictGivenBoxOverlap": share([p for p in mp if lo <= p["angleDiff"] < hi], ph, conflict, boxlap, rng=rng)}
                           for lab, lo, hi in lean_bins}
    tilt_bins = [("< 5 deg", 0, 5), ("5-15 deg", 5, 15), (">= 15 deg", 15, 1e9)]
    strata["tiltMax"] = {lab: {"boxOverlap": share([p for p in adj if lo <= p["tiltMax"] < hi], ph, boxlap, rng=rng),
                               "maskConflict": share([p for p in mp if lo <= p["tiltMax"] < hi], ph, conflict, rng=rng),
                               "conflictGivenBoxOverlap": share([p for p in mp if lo <= p["tiltMax"] < hi], ph, conflict, boxlap, rng=rng)}
                         for lab, lo, hi in tilt_bins}
    strata["boxNested"] = {str(v): {"maskConflict": share([p for p in mp if p["boxNested"] == v], ph, conflict, rng=rng)}
                           for v in (True, False)}
    res["strata"] = strata
    # per box: masks sharing pixels, crops taking in neighbours
    mb = [r for r in rows if r["hasMask"] and r["maskArea"]]
    res["boxesMaskShared5pct"] = share(mb, ph, lambda r: r["maskShared"] >= 0.05 * r["maskArea"], rng=rng)
    res["cropsNeighbour10pct"] = share(rows, ph, lambda r: r["neighbourInCrop"] >= INTRUDE * r["rect"], rng=rng)
    nb = [r["neighbourInCrop"] / max(r["rect"], 1) for r in rows]
    res["cropNeighbourShare"] = {"p50": round(float(np.median(nb)), 4), "p90": round(float(np.percentile(nb, 90)), 4)}
    rungs = ["spine-found", "text-present", "text-read", "matched", "confirmed"]
    hi_ = [r for r in rows if r["neighbourInCrop"] >= INTRUDE * r["rect"]]
    lo_ = [r for r in rows if r["neighbourInCrop"] < INTRUDE * r["rect"]]
    res["rungByCropNeighbour"] = {
        "neighbour >= 10 %": {"n": len(hi_), "confirmed": share(hi_, ph, lambda r: r["rung"] == "confirmed", rng=rng),
                              "textReadOrAbove": share(hi_, ph, lambda r: r["rung"] in rungs[2:], rng=rng)},
        "neighbour < 10 %": {"n": len(lo_), "confirmed": share(lo_, ph, lambda r: r["rung"] == "confirmed", rng=rng),
                             "textReadOrAbove": share(lo_, ph, lambda r: r["rung"] in rungs[2:], rng=rng)}}
    res["cropsNeighbourByFrag"] = {v: share([r for r in rows if r["frag"] == v], ph, lambda r: r["neighbourInCrop"] >= INTRUDE * r["rect"], rng=rng)
                                   for v in sorted({r["frag"] for r in rows})}
    if has_depth:
        dp = [p for p in cp if "depthRel" in p]
        res["depthCue"] = {
            "conflictPairsWithDepth": len(dp),
            "depthSeparated": share(dp, ph, lambda p: p["depthRel"] >= DEPTH_SEP, rng=rng),
            "depthRelP50": round(float(np.median([p["depthRel"] for p in dp])), 4) if dp else None,
            "normalDegP50": round(float(np.median([p["normalDeg"] for p in dp if "normalDeg" in p])), 2) if dp else None,
            "contestedNearerWhenSeparated": share([p for p in dp if p["depthRel"] >= DEPTH_SEP and "contestedNearer" in p], ph,
                                                  lambda p: p["contestedNearer"], rng=rng)}
    res["thresholds"] = {"conflictIos": CONFLICT_IOS, "nestIos": NEST_IOS, "dupIou": DUP_IOU, "adjacentWidths": ADJ_WIDTHS,
                         "cropNeighbour": INTRUDE, "depthSeparated": DEPTH_SEP, "bootstrap": BOOT, "seed": SEED}
    return res


if __name__ == "__main__":
    main()
