"""F-0m private still study: per photo, F-0i's exclusive outlines before (cyan) and the snapped outlines after
(yellow), each snapped top end's crease (magenta) and bottom end (green: board top; orange: the lip's edge), side by
side, plus full-resolution zooms on the tiles where most ends moved. The owner's examples lead the page, each beside
its photo.

    python -I render_f0m.py --inputs ends-inputs.jsonl --ends ends.jsonl --images '{"id": path}' \\
        --examples '[{"id", "example"}]' --out DIR --label SET

Everything it writes holds private photos and stays under the data root's ``private/``.
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

import cv2
import numpy as np

SIDE = 2000
ZOOM = 1400
GRID = (3, 4)
COL = {"before": (255, 255, 0), "after": (0, 230, 255), "top": (255, 0, 255), "board": (0, 220, 0),
       "lip-level": (0, 220, 0), "lip-edge": (0, 140, 255)}


def end_pts(row: dict, end: str) -> np.ndarray | None:
    """The snapped end as a short segment across the new box (its polygon's end edge)."""
    p = row.get("polygon")
    if not p or row[end]["status"] != "snapped":
        return None
    p = np.float64(p)
    return p[[0, 1]] if end == "top" else p[[2, 3]]


def draw(img: np.ndarray, rows: list[dict], inputs: dict, after: bool, s: float, lw: int) -> np.ndarray:
    out = img.copy()
    boxes = {b["index"]: b for b in inputs["boxes"]}
    for r in rows:
        b = boxes.get(r["index"])
        if not b or not b.get("outline"):
            continue
        o = r.get("outline") if after and r.get("outline") else b["outline"]
        cv2.polylines(out, [np.round(np.float64(o) * s).astype(np.int32)], True, COL["after" if after else "before"], lw, cv2.LINE_AA)
        if after:
            for end in ("top", "bottom"):
                seg = end_pts(r, end)
                if seg is not None:
                    c = COL["top"] if end == "top" else COL.get(r["bottom"].get("source"), COL["board"])
                    cv2.line(out, *[tuple(int(v) for v in np.round(q * s)) for q in seg], c, lw + 1, cv2.LINE_AA)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--ends", required=True)
    ap.add_argument("--images", required=True)
    ap.add_argument("--examples", default="[]")
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", required=True)
    a = ap.parse_args()
    paths = json.loads(a.images)
    examples = json.loads(a.examples)
    inputs = {json.loads(l)["id"]: json.loads(l) for l in open(a.inputs)}
    by_photo: dict[str, list[dict]] = {}
    stats: dict[str, dict] = {}
    for line in open(a.ends):
        r = json.loads(line)
        if r.get("photo"):
            stats[r["id"]] = r
            continue
        by_photo.setdefault(r["id"].rsplit(":", 1)[0], []).append(r)
    out = Path(a.out)
    (out / "img").mkdir(parents=True, exist_ok=True)
    moved = {p: sum(r[e]["status"] == "snapped" for r in rs for e in ("top", "bottom")) for p, rs in by_photo.items()}
    first = [x["id"] for x in examples if x["id"] in by_photo]
    order = list(dict.fromkeys(first + sorted(by_photo, key=lambda p: -moved[p])))
    parts = [f"<!doctype html><meta charset=utf-8><title>F-0m end edges: {html.escape(a.label)}</title>",
             "<style>body{font:14px system-ui;margin:16px;background:#111;color:#ddd}img{max-width:100%}"
             ".pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}h2{margin-top:32px}</style>",
             f"<h1>F-0m end edges, {html.escape(a.label)} (private)</h1>",
             "<p>Left: F-0i's exclusive outlines (cyan). Right: snapped outlines (yellow); top crease magenta, "
             "bottom on the board green, on the lip's edge orange. The owner's examples come first.</p>"]
    for n, pid in enumerate(order, 1):
        rows = by_photo[pid]
        img = cv2.imread(paths[pid], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is None:
            continue
        H, W = img.shape[:2]
        s = SIDE / max(H, W)
        small = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        tag = f"p{n:02d}"
        for k, after in (("b", False), ("a", True)):
            cv2.imwrite(str(out / "img" / f"{tag}-{k}.jpg"), draw(small, rows, inputs[pid], after, s, 1), [cv2.IMWRITE_JPEG_QUALITY, 85])
        ex = [x for x in examples if x["id"] == pid]
        parts.append(f"<h2>Photo {n}{' (owner example)' if ex else ''}: {moved[pid]} ends snapped</h2>")
        for j, x in enumerate(ex):
            e = cv2.imread(x["example"], cv2.IMREAD_COLOR)
            if e is not None:
                cv2.imwrite(str(out / "img" / f"{tag}-ex{j}.jpg"), e, [cv2.IMWRITE_JPEG_QUALITY, 90])
                parts.append(f"<p>Owner's example {j + 1}:</p><img src='img/{tag}-ex{j}.jpg' style='max-width:600px'>")
        parts.append(f"<div class=pair><img src='img/{tag}-b.jpg'><img src='img/{tag}-a.jpg'></div>")
        # Zooms: the grid tiles holding most snapped ends (the owner's example photo gets four).
        gx, gy = GRID
        count = np.zeros((gy, gx), int)
        for r in rows:
            for e in ("top", "bottom"):
                seg = end_pts(r, e)
                if seg is not None:
                    cx, cy = seg.mean(axis=0)
                    count[min(gy - 1, max(0, int(cy / H * gy))), min(gx - 1, max(0, int(cx / W * gx)))] += 1
        best = np.dstack(np.unravel_index(np.argsort(-count.ravel()), count.shape))[0][: 4 if ex else 2]
        for zi, (ty, tx) in enumerate(best):
            x0, y0, x1, y1 = int(tx * W / gx), int(ty * H / gy), int((tx + 1) * W / gx), int((ty + 1) * H / gy)
            crop = img[y0:y1, x0:x1]
            zs = ZOOM / max(crop.shape[:2])
            for k, after in (("b", False), ("a", True)):
                shifted = [{**r, **({"outline": (np.float64(r["outline"]) - [x0, y0]).tolist()} if r.get("outline") else {}),
                            **({"polygon": (np.float64(r["polygon"]) - [x0, y0]).tolist()} if r.get("polygon") else {})} for r in rows]
                inp = {"boxes": [{**b, "outline": (np.float64(b["outline"]) - [x0, y0]).tolist() if b.get("outline") else None}
                                 for b in inputs[pid]["boxes"]]}
                z = cv2.resize(crop, None, fx=zs, fy=zs, interpolation=cv2.INTER_AREA)
                cv2.imwrite(str(out / "img" / f"{tag}-z{zi}{k}.jpg"), draw(z, shifted, inp, after, zs, 2), [cv2.IMWRITE_JPEG_QUALITY, 88])
            parts.append(f"<div class=pair><img src='img/{tag}-z{zi}b.jpg'><img src='img/{tag}-z{zi}a.jpg'></div>")
        print(f"render {n}/{len(order)}", file=sys.stderr)
    (out / "index.html").write_text("\n".join(parts))


if __name__ == "__main__":
    main()
