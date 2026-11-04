"""F-0i reported strata (evals/F0i/report.md, addendum): cover-kind conflicts, low-contrast neighbours (with the
top-face cause apart), merged-mask splits there, seam evidence by source, and end provenance for F-0m. Reads the
partition resolve.py wrote, F-R1's pair table, H-2's face shares and the working copies; nothing here changes the
partition. stdout is aggregates only.

    python -I strata.py --set S --detect D --outlines O --table T --images I --faces F --pairs P --part DIR > strata.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from overlap import CONFLICT_IOS, SEED, bbox, boot, raster, read_jsonl  # noqa: E402

LOW_DE = 10.0  # ΔE76 between the exclusive cores' mean CIELAB colours: a low-contrast pair below this
TOP_SHARE = 0.15  # either member's H-2 top share at least this: the top-face cause
COVER_SHARE = 0.15  # a member's H-2 cover share at least this, and its dominant extra face: cover-kind
EXTRA = ("top", "under", "cover", "behind")
SOURCES = ("outline", "gate", "tile-argmax", "seam", "depth", "fallback")


def mask_in(o: list | None, win: tuple) -> np.ndarray:
    x0, y0, x1, y1 = win
    if not o or len(o) < 3:
        return np.zeros((y1 - y0, x1 - x0), bool)
    return raster(o, x0, y0, x1 - x0, y1 - y0)


def cover_kind(sh: dict | None) -> bool:
    if not sh:
        return False
    best = max(EXTRA, key=lambda k: sh.get(k, 0))
    return best == "cover" and sh.get("cover", 0) >= COVER_SHARE


def main() -> None:
    ap = argparse.ArgumentParser()
    for k in ("set", "detect", "outlines", "table", "images", "faces", "pairs", "part"):
        ap.add_argument(f"--{k}", required=True)
    a = ap.parse_args()
    keep = {r["id"] for r in read_jsonl(a.table)}
    outlines = {r["id"]: r["outline"] for r in read_jsonl(a.outlines) if r.get("outline")}
    images = {r["id"]: r["image"] for r in read_jsonl(a.images)}
    faces = {r["id"]: r.get("shares") for r in read_jsonl(a.faces)}
    part_dir = Path(a.part)
    part = {r["id"]: r for r in read_jsonl(str(part_dir / "partition.jsonl"))}
    gate = {r["id"]: r for r in read_jsonl(str(part_dir / "gate.jsonl"))}
    bounds = {frozenset((r["a"], r["b"])): r for r in read_jsonl(str(part_dir / "boundaries.jsonl"))}
    pairs_by_photo: dict[str, list[dict]] = defaultdict(list)
    for p in read_jsonl(a.pairs):
        if p.get("adjacent") and p.get("hasMasks") and p["a"] in keep and p["b"] in keep:
            pairs_by_photo[p["photo"]].append(p)
    dets = {d["id"]: d for d in read_jsonl(a.detect) if not d.get("error")}
    rows, merges = [], []
    for pid, d in dets.items():
        if pid not in images or pid not in pairs_by_photo:
            continue
        img = cv2.imread(images[pid], cv2.IMREAD_COLOR)
        if img is None:
            continue
        W, H = d["width"], d["height"]
        def lab_of(win: tuple) -> np.ndarray:
            x0, y0, x1, y1 = win
            return cv2.cvtColor(img[y0:y1, x0:x1].astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)

        def de(ma: np.ndarray, mb: np.ndarray, win: tuple) -> float | None:
            L = lab_of(win)
            A = L[ma].mean(0) if ma.sum() >= 20 else None
            B = L[mb].mean(0) if mb.sum() >= 20 else None
            return float(np.linalg.norm(A - B)) if A is not None and B is not None else None

        def union_win(*ids: str) -> tuple:
            bbs = [bbox(outlines[i], W, H) for i in ids]
            return (min(b[0] for b in bbs), min(b[1] for b in bbs), max(b[2] for b in bbs), max(b[3] for b in bbs))

        for p in pairs_by_photo[pid]:
            ia, ib = p["a"], p["b"]
            if ia not in outlines or ib not in outlines:
                continue
            win = union_win(ia, ib)
            ma, mb = mask_in(outlines[ia], win), mask_in(outlines[ib], win)
            dE = de(ma & ~mb, mb & ~ma, win)
            ra, rb = part.get(ia, {}), part.get(ib, {})
            both_kept = ra.get("state") == "kept" and rb.get("state") == "kept"
            after = 0
            area_a = area_b = 0
            if both_kept:
                ea, eb = mask_in(ra.get("outline"), win), mask_in(rb.get("outline"), win)
                after, area_a, area_b = int((ea & eb).sum()), int(ea.sum()), int(eb.sum())
            fa, fb = faces.get(ia), faces.get(ib)
            top = max((fa or {}).get("top", 0), (fb or {}).get("top", 0))
            b = bounds.get(frozenset((ia, ib)))
            rows.append({
                "photo": pid, "dE": dE, "low": dE is not None and dE < LOW_DE, "topFace": top >= TOP_SHARE,
                "cover": cover_kind(fa) or cover_kind(fb),
                "conflictBefore": p.get("maskIos", 0) >= CONFLICT_IOS, "interBefore": int(p.get("maskInter", 0)),
                "unionBefore": int(ma.sum() + mb.sum() - (ma & mb).sum()),
                "interAfter": after, "conflictAfter": both_kept and after / max(min(area_a, area_b), 1) >= CONFLICT_IOS,
                "dropped": [x for x, r in ((ia, ra), (ib, rb)) if r.get("state") == "dropped"],
                "dropReasons": [r.get("reason") for r in (ra, rb) if r.get("state") == "dropped"],
                "bySource": (b or {}).get("bySource", {}), "runs": (b or {}).get("runs", []),
            })
        # merged-mask splits: two-book parents the gate dropped, and remainders, with their children's contrast
        for gid, g in gate.items():
            if not gid.startswith(pid + ":") or gid not in outlines:
                continue
            if g["reason"] == "merged-parent" or g["role"] == "remainder":
                pw = bbox(outlines[gid], W, H)
                pm = mask_in(outlines[gid], pw)
                if g["role"] == "remainder":
                    kids = [c for c in g["children"] if c in outlines]
                else:  # the kept boxes nested in it (IoM >= 0.8), as the gate found them
                    kids = []
                    for cid, r in part.items():
                        if cid == gid or not cid.startswith(pid + ":") or r["state"] != "kept" or cid not in outlines:
                            continue
                        cm = mask_in(outlines[cid], pw)
                        full = mask_in(outlines[cid], bbox(outlines[cid], W, H)).sum()
                        if full and (cm & pm).sum() / full >= 0.8:
                            kids.append(cid)
                if not kids:
                    continue
                ks = sorted(kids, key=lambda c: -mask_in(outlines[c], pw).sum())
                m0 = mask_in(outlines[ks[0]], pw) & pm
                m1 = (mask_in(outlines[ks[1]], pw) & pm) if len(ks) >= 2 else pm & ~m0
                dE = de(m0 & ~m1, m1 & ~m0, pw)
                fp = faces.get(gid) or {}
                merges.append({"photo": pid, "kind": "merged-parent" if g["reason"] == "merged-parent" else "remainder",
                               "low": dE is not None and dE < LOW_DE, "topFace": fp.get("top", 0) >= TOP_SHARE})
        print(f"[strata] {pid[:8]}: {len(pairs_by_photo[pid])} pairs", file=sys.stderr, flush=True)

    rng = np.random.default_rng(SEED)

    def stratum(sel: list[dict]) -> dict:
        per = defaultdict(lambda: [0, 0, 0, 0, 0])
        for r in sel:
            x = per[r["photo"]]
            x[0] += r["conflictBefore"]
            x[1] += 1
            x[2] += r["conflictAfter"]
            x[3] += r["interBefore"]
            x[4] += r["unionBefore"]
        inter_after = sum(r["interAfter"] for r in sel)
        src = defaultdict(int)
        for r in sel:
            for k, v in r["bySource"].items():
                src[k] += v
        tot = max(sum(src.values()), 1)
        runs = [u for r in sel for u in r["runs"]]
        pass_ = lambda k: round(sum(1 for u in runs if u.get(k)) / max(len(runs), 1), 4)  # noqa: E731
        return {
            "pairs": len(sel),
            "conflictBefore": dict(zip(["share", "lo", "hi"], boot({k: (v[0], v[1]) for k, v in per.items()}, rng))),
            "conflictAfter": dict(zip(["share", "lo", "hi"], boot({k: (v[2], v[1]) for k, v in per.items()}, rng))),
            "pairOverlapBefore": round(sum(v[3] for v in per.values()) / max(sum(v[4] for v in per.values()), 1), 4),
            "pairOverlapAfter": round(inter_after / max(sum(v[4] for v in per.values()), 1), 4),
            "contestedBefore": int(sum(v[3] for v in per.values())), "contestedAfter": int(inter_after),
            "pairsWithADroppedMember": sum(1 for r in sel if r["dropped"]),
            "dropReasons": dict(sorted(((k, sum(1 for r in sel for x in r["dropReasons"] if x == k)) for k in
                                        {x for r in sel for x in r["dropReasons"]}))),
            "provenancePixelShare": {k: round(src[k] / tot, 4) for k in SOURCES if src[k]},
            "seamRuns": len(runs),
            "seamStrong": {"combined": pass_("strong"), "normals": pass_("normals"), "retinex": pass_("retinex"),
                           "luma": pass_("luma")},
        }

    def merge_counts(sel: list[dict]) -> dict:
        return {k: sum(1 for m in sel if m["kind"] == k) for k in ("merged-parent", "remainder")}

    low = [r for r in rows if r["low"]]
    res = {
        "set": a.set, "neighbourPairs": len(rows), "pairsWithColour": sum(r["dE"] is not None for r in rows),
        "thresholds": {"lowDeltaE76": LOW_DE, "topShare": TOP_SHARE, "coverShare": COVER_SHARE},
        "lowContrast": stratum(low), "otherContrast": stratum([r for r in rows if r["dE"] is not None and not r["low"]]),
        "lowContrastTopFace": stratum([r for r in low if r["topFace"]]),
        "lowContrastToneOnly": stratum([r for r in low if not r["topFace"]]),
        "coverKind": stratum([r for r in rows if r["cover"]]),
        "coverKindConflicting": stratum([r for r in rows if r["cover"] and r["conflictBefore"]]),
        "mergedSplits": {"lowContrast": merge_counts([m for m in merges if m["low"]]),
                         "lowContrastTopFace": merge_counts([m for m in merges if m["low"] and m["topFace"]]),
                         "other": merge_counts([m for m in merges if not m["low"]])},
        "ends": {e: {s: sum(1 for r in part.values() if r["state"] == "kept" and (r.get("ends") or {}).get(e) == s)
                     for s in SOURCES if any((r.get("ends") or {}).get(e) == s for r in part.values())}
                 for e in ("top", "bottom")},
    }
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
