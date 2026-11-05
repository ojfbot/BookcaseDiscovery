"""NS-10 Stage B, geometry half (CPU): the boxes of each capture group lifted onto the group's shelf plane.

From Stage A's cache (``stage.py``) and the boxes ``src/eval/ns10-cli.ts prepare`` wrote, per group:

1. Each box's outline (working-copy pixels) is rasterised on its view's map and keeps the pixels the teacher marks
   valid with a confidence at or above the group's median over the boxes' pixels.
2. One plane is fitted (RANSAC, 2,000 draws, inlier distance 1 % of the median depth) to those points in the common
   frame. A view whose box points lie more than 15 % of the median depth off the plane in median is ``off-plane``; its
   boxes are not lifted. The plane's normal points toward the first view's camera.
3. In the plane's basis (``v`` the plane projection of the first view's up, ``u`` along the shelf, increasing to the
   first view's right) a lifted box is the rectangle between the 5th and 95th percentile of its points' ``u`` and ``v``.
   Fewer than 50 points: not lifted.
4. Consistency with H-2's MoGe-2 plane for the same still (a check, not truth): the angle between the two normals and
   the median relative difference of the two planes' depths along the box pixels' rays, after matching scale by the
   median depth ratio. Reported per view; the scale ratio too.

stdout: nothing. ``--out`` gets the footprints (one row per box), ``--summary`` one row per group. The folders hold
private geometry. Thresholds are prereg §2 and §3 (evals/NS10/prereg.md).

    python -I lift.py --groups groups.jsonl --boxes boxes.jsonl --cache DIR --runs RUNS_DIR --h2 H2_DIR \\
                      --out footprints.jsonl --summary geometry.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stage as S  # noqa: E402

MIN_PIXELS = 50
INLIER_FRAC = 0.01
OFF_PLANE = 0.15
POSE_CONF = 0.5
DRAWS = 2000
RNG_SEED = 20261105


def fit_plane(pts: np.ndarray, thr: float, rng: np.random.Generator) -> tuple[np.ndarray, float] | None:
    """RANSAC plane ``n . p + d = 0`` (unit n) through (N, 3) points; refitted on the inliers by SVD."""
    if len(pts) < 3:
        return None
    if len(pts) > 30000:
        pts = pts[rng.choice(len(pts), 30000, replace=False)]
    best, best_n = None, -1
    for _ in range(DRAWS):
        a, b, c = pts[rng.choice(len(pts), 3, replace=False)]
        n = np.cross(b - a, c - a)
        nn = np.linalg.norm(n)
        if nn < 1e-9:
            continue
        n = n / nn
        inl = np.abs((pts - a) @ n) < thr
        k = int(inl.sum())
        if k > best_n:
            best, best_n = inl, k
    if best is None or best_n < 3:
        return None
    q = pts[best]
    c = q.mean(0)
    n = np.linalg.svd(q - c, full_matrices=False)[2][-1]
    return n, float(-n @ c)


def box_pixels(polygon, scale, offset, size) -> np.ndarray:
    """Mask of the map the box covers, from its working-copy outline (scaled, then moved by the view's padding offset)."""
    h, w = size
    pts = np.round(np.array(polygon, dtype=np.float64) * [scale[0], scale[1]] + [offset[0], offset[1]]).astype(np.int32)
    m = np.zeros((h, w), np.uint8)
    cv2.fillPoly(m, [pts], 1)
    return m.astype(bool)


def load_group(cache_dir: Path, views: list[dict]) -> list[dict]:
    out = []
    for v in views:
        z = np.load(cache_dir / f"{v['id'][:16]}.npz")
        out.append({"id": v["id"], **{k: z[k] for k in z.files}})
    return out


def moge_check(view: dict, boxes: list[dict], plane_cam: tuple[np.ndarray, float], own_n: np.ndarray | None, h2: Path, geometry_key: str, rng) -> dict | None:
    """Angle, relative depth difference and scale ratio of the teacher's plane against MoGe-2's, for one still."""
    hits = sorted((h2 / "cache" / "geometry").glob(f"*/{geometry_key}.npz"))
    if not hits:
        return None
    z = np.load(hits[0])
    pts, mask, kn, mscale = z["points"].astype(np.float64), z["mask"].astype(bool), z["intrinsics"].astype(np.float64), float(z["scale"])
    hm, wm = mask.shape
    sel = np.zeros((hm, wm), bool)
    for b in boxes:
        p = np.round(np.array(b["polygon"], dtype=np.float64) * mscale).astype(np.int32)
        m = np.zeros((hm, wm), np.uint8)
        cv2.fillPoly(m, [p], 1)
        sel |= m.astype(bool)
    sel &= mask & np.isfinite(pts).all(-1)
    q = pts[sel]
    if len(q) < MIN_PIXELS:
        return None
    thr = INLIER_FRAC * float(np.median(q[:, 2]))
    fit = fit_plane(q, thr, rng)
    if fit is None:
        return None
    nm, dm = fit
    na, da = plane_cam
    angle = float(np.degrees(np.arccos(min(1.0, abs(float(nm @ na))))))
    # Sample rays through box pixels (normalised image coordinates), and intersect each plane with them.
    ys, xs = np.nonzero(sel)
    pick = rng.choice(len(xs), min(2000, len(xs)), replace=False)
    xn, yn = (xs[pick] + 0.5) / wm, (ys[pick] + 0.5) / hm
    rm = np.stack([(xn - kn[0, 2]) / kn[0, 0], (yn - kn[1, 2]) / kn[1, 1], np.ones_like(xn)], 1)
    ka = view["intrinsics"].astype(np.float64)
    hi, wi = (int(x) for x in view["image"])  # the view's own pixels on the canvas, past the padding
    xa, ya = xn * wi + view["offset"][0], yn * hi + view["offset"][1]
    ra = np.stack([(xa - ka[0, 2]) / ka[0, 0], (ya - ka[1, 2]) / ka[1, 1], np.ones_like(xn)], 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        zm = -dm / (rm @ nm)
        za = -da / (ra @ na)
    ok = np.isfinite(zm) & np.isfinite(za) & (zm > 0) & (za > 0)
    if ok.sum() < MIN_PIXELS:
        return None
    ratio = float(np.median(zm[ok] / za[ok]))
    rel = float(np.median(np.abs(za[ok] * ratio - zm[ok]) / zm[ok]))
    out = {"angleDeg": angle, "relDepth": rel, "scaleRatio": ratio}
    if own_n is not None:  # supplementary (not pre-registered): the teacher's plane fitted to this still alone
        out["ownAngleDeg"] = float(np.degrees(np.arccos(min(1.0, abs(float(nm @ own_n))))))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--groups", required=True)
    ap.add_argument("--boxes", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--runs", required=True, help="folder of stage.py's stdout files (timing and memory per group)")
    ap.add_argument("--h2", required=True, help="the data root's private/h2 folder (MoGe-2 cache)")
    ap.add_argument("--h2-stage", required=True, help="private/h2/pilot-000/stage-latest.jsonl (geometry keys per still)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--summary", required=True)
    args = ap.parse_args()

    rng = np.random.default_rng(RNG_SEED)
    pin = S.weights_pin()
    gdir = Path(args.cache) / "geometry" / f"map-anything-apache@{(pin['revision'] or pin['weightsSha256'] or 'unpinned')[:7]}"
    boxes_by_photo: dict[str, list[dict]] = {}
    for line in open(args.boxes):
        b = json.loads(line)
        boxes_by_photo.setdefault(b["photo"], []).append(b)
    h2_keys = {}
    for line in open(args.h2_stage):
        r = json.loads(line)
        if r.get("photo"):
            h2_keys[r["id"]] = r["geometryKey"]
    runs = {}
    for f in sorted(Path(args.runs).glob("*.jsonl")):
        for line in open(f):
            r = json.loads(line)
            if not r.get("hit"):
                runs[r["group"]] = r

    foot, summary = [], []
    for line in open(args.groups):
        g = json.loads(line)
        views = g["views"]
        # the group's cache folder is named by its key: find it from the sidecars rather than recompute the key
        code = S.sha256_file(Path(S.__file__))[:16]
        sidecars = ((d, json.loads((d / "group.json").read_text())) for d in gdir.glob("*") if (d / "group.json").exists())
        folder = next((d for d, j in sidecars if j.get("viewIds") == [v["id"] for v in views] and j.get("code") == code), None)
        if folder is None:
            summary.append({"group": g["group"], "views": len(views), "poseOk": False, "viewsUsable": 0, "why": "no-geometry"})
            continue
        vs = load_group(folder, views)
        # 1. box pixels with valid, confident points
        per_view = []
        all_conf = []
        for v in vs:
            bs = boxes_by_photo.get(v["id"], [])
            masks = [box_pixels(b["polygon"], v["scale"], v["offset"], tuple(int(x) for x in v["size"])) for b in bs]
            valid = v["mask"] & np.isfinite(v["pts3d"]).all(-1)
            inbox = np.zeros_like(valid)
            for m in masks:
                inbox |= m
            all_conf.append(v["conf"][inbox & valid])
            per_view.append((bs, masks, valid))
        conf_all = np.concatenate(all_conf) if all_conf else np.zeros(0)
        thr_conf = float(np.median(conf_all)) if len(conf_all) else 0.0
        # 2. one plane for the group, in the common frame
        pts_all = np.concatenate([v["pts3d"][pv[2] & (v["conf"] >= thr_conf) & np.any([m for m in pv[1]], axis=0)].reshape(-1, 3) for v, pv in zip(vs, per_view) if pv[1]] or [np.zeros((0, 3))])
        zs = np.concatenate([v["pts3d_cam"][..., 2][pv[2]].ravel() for v, pv in zip(vs, per_view)]) if vs else np.zeros(0)
        med_depth = float(np.median(np.abs(zs))) if len(zs) else 1.0
        fit = fit_plane(pts_all, INLIER_FRAC * med_depth, rng) if len(pts_all) >= MIN_PIXELS else None
        if fit is None:
            summary.append({"group": g["group"], "views": len(vs), "poseOk": False, "viewsUsable": 0, "why": "no-plane"})
            continue
        n, d = fit
        cam0 = vs[0]["pose"][:3, 3]
        if n @ cam0 + d < 0:
            n, d = -n, -d
        # 3. basis: v = first view's up on the plane, u along the shelf (increasing to the first view's right)
        r0 = vs[0]["pose"][:3, :3]
        up = -r0[:, 1]
        ev = up - (up @ n) * n
        ev = ev / np.linalg.norm(ev)
        eu = np.cross(ev, n)
        if eu @ r0[:, 0] < 0:
            eu = -eu
        origin = -d * n
        ups = [float(np.degrees(np.arccos(np.clip((-v["pose"][:3, :3][:, 1]) @ up, -1, 1)))) for v in vs]
        usable, poses_ok, moge = 0, True, {"angleDeg": [], "relDepth": [], "scaleRatio": [], "ownAngleDeg": []}
        for v, (bs, masks, valid) in zip(vs, per_view):
            conf_v = v["conf"][np.any(masks, axis=0) & valid] if masks else np.zeros(0)
            poses_ok &= bool(np.isfinite(v["pose"]).all()) and len(conf_v) > 0 and float(np.median(conf_v)) > POSE_CONF
            vz = np.abs(v["pts3d_cam"][..., 2][valid & np.any(masks, axis=0)]) if masks else np.zeros(0)
            vmed = float(np.median(vz)) if len(vz) else 1.0
            sel_pts = v["pts3d"][valid & np.any(masks, axis=0)] if masks else np.zeros((0, 3))
            off = float(np.median(np.abs((sel_pts - origin) @ n))) / vmed if len(sel_pts) else float("inf")
            on_plane = off <= OFF_PLANE
            usable += int(on_plane)
            for b, m in zip(bs, masks):
                sel = m & valid & (v["conf"] >= thr_conf)
                row = {"id": b["id"], "photo": v["id"], "group": g["group"], "lifted": False, "u0": 0.0, "u1": 0.0, "v0": 0.0, "v1": 0.0, "n": int(sel.sum())}
                if on_plane and sel.sum() >= MIN_PIXELS:
                    q = v["pts3d"][sel].astype(np.float64) - origin
                    u, vv = q @ eu, q @ ev
                    row.update(lifted=True, u0=float(np.percentile(u, 5)), u1=float(np.percentile(u, 95)), v0=float(np.percentile(vv, 5)), v1=float(np.percentile(vv, 95)))
                foot.append(row)
            # 4. consistency with MoGe-2
            if bs and v["id"] in h2_keys:
                R, t = v["pose"][:3, :3].astype(np.float64), v["pose"][:3, 3].astype(np.float64)
                plane_cam = (R.T @ n, float(n @ t + d))
                own = None
                pc = v["pts3d_cam"][valid & np.any(masks, axis=0)].astype(np.float64)
                if len(pc) >= MIN_PIXELS:
                    f_own = fit_plane(pc, INLIER_FRAC * float(np.median(np.abs(pc[:, 2]))), rng)
                    own = f_own[0] if f_own else None
                c = moge_check(v, bs, plane_cam, own, Path(args.h2), h2_keys[v["id"]], rng)
                if c:
                    for k in moge:
                        if k in c:
                            moge[k].append(c[k])
        run = runs.get(g["group"], {})
        summary.append({
            "group": g["group"], "views": len(vs), "poseOk": bool(poses_ok), "viewsUsable": usable, "planeInliersMedianDepth": med_depth,
            "upSpreadDegMax": max(ups), "confThreshold": thr_conf,
            "seconds": (run.get("seconds") or {}).get("infer"), "peakRssMb": run.get("peakRssMb"), "peakMpsMb": run.get("peakMpsMb"),
            "amp": run.get("amp"), "moge": moge,
        })
        print(f"group {g['index']}: {len(vs)} views, usable {usable}, pose ok {poses_ok}", file=sys.stderr)

    Path(args.out).write_text("".join(json.dumps(r) + "\n" for r in foot))
    Path(args.summary).write_text("".join(json.dumps(r) + "\n" for r in summary))


if __name__ == "__main__":
    main()
