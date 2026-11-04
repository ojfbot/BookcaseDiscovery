"""H-1 aggregates: counts, shares and runtimes only (no ids, positions, titles or paths), for evals/H1/.

Reads faces.py's rows, geometry.py's two runs (EXIF field of view where known, and MoGe's own estimate) and,
optionally, Q-2's top seam per box (helpers/coverage/geometry.py on the same detect file).
The first photo in --images is the owner's example; it is reported on its own and inside the whole set.
Intervals are 95 % photo bootstraps (2,000 draws, seed 7).

    python -I summarize.py --images images.jsonl --faces faces.jsonl --geometry geometry.jsonl \\
        --estimated geometry-estfov.jsonl [--topseam topseam.jsonl] --out metrics.json [--text summary.txt]
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict

import numpy as np

EXTRA = ("top", "under", "cover", "behind")
SEAM_OVER, SEAM_CUT = 0.05, -0.05
ELEV_BAND = 10.0


def boot(per_photo: list[tuple[float, float]], draws: int = 2000) -> list[float] | None:
    """Ratio of sums over photos, with a 95 % photo bootstrap; per_photo holds (numerator, denominator)."""
    if not per_photo:
        return None
    a = np.array(per_photo, float)
    rng = np.random.default_rng(7)
    est = a[:, 0].sum() / max(a[:, 1].sum(), 1e-9)
    idx = rng.integers(0, len(a), (draws, len(a)))
    s = a[idx].sum(axis=1)
    r = s[:, 0] / np.maximum(s[:, 1], 1e-9)
    return [round(float(est), 4), round(float(np.percentile(r, 2.5)), 4), round(float(np.percentile(r, 97.5)), 4)]


def pct(v: list[float], qs=(10, 50, 90), nd: int = 1) -> list[float] | None:
    return [round(float(x), nd) for x in np.percentile(v, qs)] if v else None


def share_by_photo(rows: list[dict], pred) -> list[tuple[float, float]]:
    g = defaultdict(lambda: [0, 0])
    for r in rows:
        g[r["id"]][0] += bool(pred(r))
        g[r["id"]][1] += 1
    return [tuple(v) for v in g.values()]


def block(rows: list[dict], seam: dict) -> dict:
    ok = [r for r in rows if "pixels" in r]
    over = [r for r in ok if r["overSelects"]]
    out = {
        "count": len(rows),
        "measured": len(ok),
        "skipped": {k: sum(r.get("skip") == k for r in rows) for k in ("no-pixels", "no-frame", "small")},
        "ownPlane": sum(bool(r.get("ownPlane")) for r in ok),
        "overSelectShare": boot(share_by_photo(ok, lambda r: r["overSelects"])),
        "pixelShare": {k: round(sum(r[k] for r in ok) / max(sum(r["pixels"] for r in ok), 1), 4)
                       for k in ("front", "edge", *EXTRA)},
        "overSelectBy": {k: round(sum(max(EXTRA, key=lambda e: r[e]) == k for r in over) / max(len(over), 1), 3) for k in EXTRA},
        "trimFeasibleShare": boot(share_by_photo(ok, lambda r: r.get("trimFeasible"))),
        "trimFeasibleShareOfOverSelecting": boot(share_by_photo(over, lambda r: r.get("trimFeasible"))),
        "trimKeptAreaOfOverSelecting": pct([r["trim"]["areaShare"] for r in over if "trim" in r and r.get("trimFeasible")], (25, 50, 75), 3),
    }
    elev = {"below": lambda e: e < -ELEV_BAND, "level": lambda e: -ELEV_BAND <= e <= ELEV_BAND, "above": lambda e: e > ELEV_BAND}
    out["byElevation"] = {}
    for k, f in elev.items():
        sub = [r for r in ok if f(r["elevationDeg"])]
        out["byElevation"][k] = {
            "count": len(sub),
            "overSelectShare": boot(share_by_photo(sub, lambda r: r["overSelects"])),
            "topPixelShare": round(sum(r["top"] for r in sub) / max(sum(r["pixels"] for r in sub), 1), 4),
            "coverPixelShare": round(sum(r["cover"] for r in sub) / max(sum(r["pixels"] for r in sub), 1), 4),
        }
    out["byCut"] = {k: {"count": len([r for r in ok if r["cut"] == v]),
                        "overSelectShare": boot(share_by_photo([r for r in ok if r["cut"] == v], lambda r: r["overSelects"]))}
                    for k, v in (("whole", False), ("cut", True))}
    cub = [r for r in ok if "cuboid" in r]
    out["cuboids"] = {
        "count": len(cub),
        "depthSource": {k: sum(r["cuboid"]["depthSource"] == k for r in cub) for k in ("seen", "band", "default")},
        "spineHeightCm": pct([r["heightM"] * 100 for r in cub]),
        "spineThicknessCm": pct([r["widthM"] * 100 for r in cub]),
        "seenDepthCm": pct([r["cuboid"]["depthM"] * 100 for r in cub if r["cuboid"]["depthSource"] == "seen"]),
    }
    if seam:
        buckets = {"overshoot": lambda t: t > SEAM_OVER, "atEdge": lambda t: SEAM_CUT <= t <= SEAM_OVER, "cut": lambda t: t < SEAM_CUT}
        out["topSeamCrossCheck"] = {}
        for k, f in buckets.items():
            sub = [r for r in ok if (r["id"], r["box"]) in seam and f(seam[(r["id"], r["box"])])]
            out["topSeamCrossCheck"][k] = {
                "count": len(sub),
                "topPixelShare": round(sum(r["top"] for r in sub) / max(sum(r["pixels"] for r in sub), 1), 4),
                "overSelectShare": boot(share_by_photo(sub, lambda r: r["overSelects"])),
            }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    for k in ("images", "faces", "geometry", "estimated", "out"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--topseam", default=None)
    ap.add_argument("--text", default=None)
    args = ap.parse_args()

    order = [json.loads(l)["id"] for l in open(args.images)]
    owner = order[0]
    rows, photos = [], []
    for line in open(args.faces):
        r = json.loads(line)
        (photos if r.get("photo") else rows).append(r)
    seam = {}
    if args.topseam:
        # Q-2's geometry.py keys each box "<image id>:<index in the detect record>".
        for line in open(args.topseam):
            t = json.loads(line)
            if t.get("topSeam") is not None:
                seam[(t["imageId"], int(t["id"].rsplit(":", 1)[1]))] = t["topSeam"]
    geo = {json.loads(l)["id"]: json.loads(l) for l in open(args.geometry)}
    est = {json.loads(l)["id"]: json.loads(l) for l in open(args.estimated)}
    fov_err = [abs(est[i]["fovX"] - g["fovX"]) for i, g in geo.items() if g["fovGiven"] and i in est]
    spreads = [f["offsetSpreadM"] * 100 for p in photos for f in p["frames"].values() if f["offsetSpreadM"] is not None]

    m = {
        "card": "H-1",
        "set": "pilot-000 (real use); machine measurements, no labels (INV-17)",
        "detector": "F-0e bands+strips boxes (B2), unchanged",
        "geometryModel": "Ruicheng/moge-2-vitl-normal (MIT), long side 2048 px, MPS",
        "photos": len(photos),
        "thresholds": {"frontDeg": 30, "edgeDeg": 45, "behindM": 0.08, "overShare": 0.15, "overMinPx": 15,
                       "trimComponent": 0.80, "trimPurity": 0.85, "trimKeep": 0.5, "elevationBandDeg": ELEV_BAND,
                       "topSeamOvershoot": SEAM_OVER, "topSeamCut": SEAM_CUT},
        "ownerExample": block([r for r in rows if r["id"] == owner], seam),
        "all": block(rows, seam),
        "spinePlaneSpreadCm": pct(spreads, (25, 50, 75), 2),
        "upFromSurfaces": sum(f["upSource"] == "surfaces" for p in photos for f in p["frames"].values()),
        "bands": sum(len(p["frames"]) for p in photos),
        "fieldOfView": {"photosWithExif": len(fov_err), "moge2AbsErrorDeg": pct(fov_err, (50, 90, 100))},
        "runtime": {
            "moge2SecondsPerPhoto": pct([g["seconds"] for g in geo.values()], (50, 90, 100), 2),
            "facesSecondsPerPhoto": pct([p["facesSeconds"] for p in photos], (50, 90, 100), 2),
            "note": "GPU shared with other card sessions during the run",
        },
    }
    with open(args.out, "w") as f:
        json.dump(m, f, indent=2)
        f.write("\n")
    if args.text:
        with open(args.text, "w") as f:
            f.write(json.dumps(m, indent=1))


if __name__ == "__main__":
    main()
