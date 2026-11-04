"""H-1 private renders: depth, normals, spine-face splits, trims and book cuboids per photo, plus an index.html.

For each photo (in --images order, so the owner's example can come first), six JPEGs at the geometry map's size:

- ``photo``: the working copy;
- ``normals``: MoGe-2 normals as colour (x right red, y up green, z toward the camera blue);
- ``depth``: MoGe-2 depth, near warm, far cool, 2–98 % range;
- ``faces``: each detected box's pixels by face (faces.py classes) over the dimmed photo;
- ``trim``: each box (thin grey) and its spine-face trim (green when feasible, orange when not);
- ``cuboids``: each book cuboid's wireframe, front face solid and the receding edges faint, coloured by band.

--out must be a private folder under the data root: the renders hold photos and never enter the repo.

    python -I render.py --images images.jsonl --detect detect.jsonl --faces faces.jsonl --geometry DIR \\
        --classmaps DIR --out DIR [--summary summary.json]
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery")).resolve()
# BGR per faces.py class: front, edge, top, under, cover, behind
CLASS_BGR = [(235, 160, 70), (150, 150, 150), (90, 220, 90), (120, 40, 160), (40, 140, 255), (200, 80, 200)]
CLASS_NAMES = ["front (spine face)", "edge", "top", "under", "cover", "behind"]
BAND_BGR = [(255, 210, 80), (80, 220, 255), (140, 255, 120), (255, 140, 200), (120, 160, 255), (220, 220, 220)]


def load_photo(path: str, W: int, H: int) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_REDUCED_COLOR_2)
    return cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)


def pts(poly, s: float) -> np.ndarray:
    return np.round(np.float64(poly) * s).astype(np.int32)


def main() -> None:
    ap = argparse.ArgumentParser()
    for k in ("images", "detect", "faces", "geometry", "classmaps", "out"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--summary", default=None)
    args = ap.parse_args()
    out = Path(args.out).resolve()
    if DATA / "private" not in out.parents:
        sys.exit(f"--out must be under {DATA / 'private'}")
    out.mkdir(parents=True, exist_ok=True)

    det = {json.loads(l)["id"]: json.loads(l) for l in open(args.detect)}
    boxes: dict[str, list[dict]] = {}
    for line in open(args.faces):
        r = json.loads(line)
        if "box" in r:
            boxes.setdefault(r["id"], []).append(r)

    cards = []
    order = [json.loads(l) for l in open(args.images)]
    for k, rec in enumerate(order):
        pid = rec["id"]
        g = Path(args.geometry) / f"{pid}.npz"
        if pid not in det or not g.exists() or pid not in boxes:
            continue
        z = np.load(g)
        N = z["normal"].astype(np.float32)
        P = z["points"].astype(np.float32)
        s = float(z["scale"])
        H, W = N.shape[:2]
        photo = load_photo(rec["image"], W, H)
        name = f"p{k:02d}"
        files = {}

        files["photo"] = photo
        nrm = ((N * np.array([1, -1, -1]) + 1) / 2 * 255).clip(0, 255).astype(np.uint8)[..., ::-1]
        files["normals"] = np.ascontiguousarray(nrm)
        d = P[..., 2]
        lo, hi = np.nanpercentile(d, [2, 98])
        d8 = (np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1) * 255).astype(np.uint8)
        files["depth"] = cv2.applyColorMap(255 - d8, cv2.COLORMAP_TURBO)

        cm = cv2.imread(str(Path(args.classmaps) / f"{pid}.png"), cv2.IMREAD_GRAYSCALE)
        faces = (photo * 0.35).astype(np.uint8)
        for j, c in enumerate(CLASS_BGR):
            m = cm == j
            faces[m] = (0.35 * photo[m] + 0.65 * np.array(c)).astype(np.uint8)
        files["faces"] = faces

        trim = (photo * 0.6).astype(np.uint8)
        cub = (photo * 0.45).astype(np.uint8)
        for r in boxes[pid]:
            sp = det[pid]["spines"][r["box"]]
            cv2.polylines(trim, [pts(sp["polygon"], s)], True, (170, 170, 170), 1, cv2.LINE_AA)
            if "trim" in r:
                col = (90, 230, 90) if r.get("trimFeasible") else (40, 140, 255)
                cv2.polylines(trim, [pts(r["trim"]["polygon"], s)], True, col, 2, cv2.LINE_AA)
            cb = r.get("cuboid")
            if cb and "corners" in cb:
                c = pts(cb["corners"], s)
                col = BAND_BGR[r["band"] % len(BAND_BGR)]
                faint = tuple(int(v * 0.55) for v in col)
                for a, b in ((4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)):
                    cv2.line(cub, tuple(c[a]), tuple(c[b]), faint, 1, cv2.LINE_AA)
                cv2.polylines(cub, [c[:4]], True, col, 2, cv2.LINE_AA)
        files["trim"], files["cuboids"] = trim, cub

        for kind, im in files.items():
            cv2.imwrite(str(out / f"{name}-{kind}.jpg"), im, [cv2.IMWRITE_JPEG_QUALITY, 85])
        ok = [r for r in boxes[pid] if "pixels" in r]
        over = sum(r["overSelects"] for r in ok)
        feas = sum(r.get("trimFeasible", False) for r in ok)
        title = "owner's example" if k == 0 else f"photo {k}"
        cards.append((name, title, len(ok), over, feas))
        print(f"{name} rendered", file=sys.stderr)

    legend = "".join(
        f'<span style="background:rgb({c[2]},{c[1]},{c[0]});padding:2px 8px;margin-right:6px;color:#111">{html.escape(n)}</span>'
        for c, n in zip(CLASS_BGR, CLASS_NAMES))
    summary = ""
    if args.summary and Path(args.summary).exists():
        summary = f"<pre style='white-space:pre-wrap'>{html.escape(Path(args.summary).read_text())}</pre>"
    kinds = ["photo", "normals", "depth", "faces", "trim", "cuboids"]
    body = [f"<h1>H-1 · 3D book volumes (private)</h1><p>{legend}</p>"
            "<p>trim: green = feasible, orange = not; grey = detected box. cuboids: solid = spine face, faint = receding edges.</p>",
            "<p>View: " + " ".join(f"<button onclick=\"show('{k}')\">{k}</button>" for k in kinds) + "</p>", summary]
    for name, title, n, over, feas in cards:
        imgs = "".join(f"<img class='v {k}' src='{name}-{k}.jpg' loading='lazy' style='max-width:100%;{'' if k == 'faces' else 'display:none'}'>"
                       for k in kinds)
        body.append(f"<section><h2>{html.escape(title)}</h2><p>{n} boxes · {over} over-select · {feas} trim feasible</p>{imgs}</section>")
    script = ("<script>function show(k){document.querySelectorAll('img.v').forEach(i=>{i.style.display="
              "i.classList.contains(k)?'':'none'})}</script>")
    (out / "index.html").write_text(
        "<!doctype html><meta charset='utf-8'><title>H-1 renders</title>"
        "<body style='font-family:sans-serif;background:#222;color:#eee;margin:16px'>" + "".join(body) + script + "</body>")
    print(f"{len(cards)} photos -> {out / 'index.html'}", file=sys.stderr)


if __name__ == "__main__":
    main()
