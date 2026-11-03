"""Private before/after renders for card F-0b (reader-crop geometry). Writes under the output folder only (the
runner passes the data root's private/f0b/renders/<set>/): an index.html, per-photo overviews with every changed
box drawn (orange: F-0's crop, green: the variant's crop, cyan: the mask outline), and per-box crop pairs as the
readers see them (the first requested rotation). Never run with an output folder inside the repository.

Usage: render_f0b.py --boxes boxes.jsonl --out <dir> --label <set>
"""

from __future__ import annotations

import argparse
import html
import json
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

from read import crop

PER_VARIANT = 160  # boxes shown per variant: every changed outcome first, then trimmed or edge boxes
OVERVIEW_SIDE = 1600
CONTEXT_SIDE = 420
ORANGE, GREEN, CYAN = (0, 140, 255), (60, 200, 60), (255, 220, 0)


def thumb(img: np.ndarray, side: int) -> np.ndarray:
    s = side / max(img.shape[:2])
    return cv2.resize(img, (max(1, int(img.shape[1] * s)), max(1, int(img.shape[0] * s))), interpolation=cv2.INTER_AREA) if s < 1 else img


def poly(img: np.ndarray, pts, color, k: float, ox: float = 0, oy: float = 0, width: int = 2) -> None:
    if pts:
        p = np.array([[(x - ox) * k, (y - oy) * k] for x, y in pts], dtype=np.int32)
        cv2.polylines(img, [p], True, color, width, cv2.LINE_AA)


def context(img: np.ndarray, b: dict) -> np.ndarray:
    pts = np.array(b["before"]["polygon"] + (b["after"]["polygon"] if b["after"] else []), dtype=np.float64)
    h, w = img.shape[:2]
    m = 0.2 * max(np.ptp(pts[:, 0]), np.ptp(pts[:, 1]))
    x0, y0 = int(max(0, pts[:, 0].min() - m)), int(max(0, pts[:, 1].min() - m))
    x1, y1 = int(min(w, pts[:, 0].max() + m)), int(min(h, pts[:, 1].max() + m))
    win = img[y0:y1, x0:x1].copy()
    k = min(1.0, CONTEXT_SIDE / max(1, max(win.shape[:2])))
    win = cv2.resize(win, (max(1, int(win.shape[1] * k)), max(1, int(win.shape[0] * k))), interpolation=cv2.INTER_AREA)
    poly(win, b["outline"], CYAN, k, x0, y0, 1)
    poly(win, b["before"]["polygon"], ORANGE, k, x0, y0)
    if b["after"]:
        poly(win, b["after"]["polygon"], GREEN, k, x0, y0)
    return win


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boxes", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    (out / "img").mkdir(parents=True, exist_ok=True)
    boxes = [json.loads(l) for l in open(args.boxes) if l.strip()]
    by_variant: dict[str, list[dict]] = defaultdict(list)
    for b in boxes:
        by_variant[b["variant"]].append(b)
    shown: dict[str, list[dict]] = {}
    for v, bs in by_variant.items():
        changed = [b for b in bs if b["after"] and b["after"]["outcome"] != b["before"]["outcome"]]
        rest = [b for b in bs if b not in changed and ((b["trim"] and max(b["trim"]) > 0) or b["edge"] or not b["inFrame"])]
        shown[v] = (changed + rest)[:PER_VARIANT]
    by_image: dict[str, list[dict]] = defaultdict(list)
    for v, bs in shown.items():
        for b in bs:
            by_image[b["image"]].append(b)
    sections: dict[str, list[str]] = defaultdict(list)
    overviews: list[str] = []
    for n, (path, bs) in enumerate(sorted(by_image.items())):
        img = cv2.imread(path, cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is None:
            continue
        ov = thumb(img, OVERVIEW_SIDE).copy()
        k = ov.shape[1] / img.shape[1]
        for b in bs:
            if b["variant"] in ("face", "pad"):
                continue
            poly(ov, b["before"]["polygon"], ORANGE, k)
            if b["after"]:
                poly(ov, b["after"]["polygon"], GREEN, k)
        for b in bs:
            if b["variant"] == "face":
                poly(ov, b["outline"], CYAN, k, width=1)
                poly(ov, b["before"]["polygon"], ORANGE, k)
                if b["after"]:
                    poly(ov, b["after"]["polygon"], GREEN, k)
        cv2.imwrite(str(out / "img" / f"photo-{n}.jpg"), ov, [cv2.IMWRITE_JPEG_QUALITY, 82])
        overviews.append(f'<figure><img loading="lazy" src="img/photo-{n}.jpg"><figcaption>photo {n}: {len(bs)} boxes shown</figcaption></figure>')
        for j, b in enumerate(bs):
            stem = f"p{n}-{b['variant']}-{j}"
            cv2.imwrite(str(out / "img" / f"{stem}-ctx.jpg"), context(img, b), [cv2.IMWRITE_JPEG_QUALITY, 85])
            cells = [f'<img loading="lazy" src="img/{stem}-ctx.jpg">']
            for side in ("before", "after"):
                c = b[side]
                if not c:
                    cells.append("<div>not in frame: not read</div>")
                    continue
                cv2.imwrite(str(out / "img" / f"{stem}-{side}.jpg"), thumb(crop(img, c["polygon"], c["rotations"][0]), 360),
                            [cv2.IMWRITE_JPEG_QUALITY, 85])
                cells.append(f'<figure><img loading="lazy" src="img/{stem}-{side}.jpg"><figcaption>{side}: '
                             f'{html.escape(c["outcome"])}<br>rotations {c["rotations"]}</figcaption></figure>')
            flags = ", ".join(f for f, on in (("edge", b["edge"]), ("oblique", b["oblique"]), ("out of frame", not b["inFrame"])) if on)
            trim = f" trim {b['trim'][0]:.2f}/{b['trim'][1]:.2f}" if b["trim"] else ""
            sections[b["variant"]].append(f'<div class="row"><div class="meta">photo {n} · {flags or "-"}{trim}</div>{"".join(cells)}</div>')
    body = [f"<h1>F-0b crop geometry: {html.escape(args.label)}</h1>",
            "<p>Private. Orange: F-0's crop. Green: the variant's crop. Cyan: the re-derived mask outline. Crops are shown "
            "at their first rotation. Changed outcomes first, then edge, out-of-frame and trimmed boxes.</p>"]
    for v, rows in sections.items():
        body.append(f"<h2>{html.escape(v)} ({len(rows)} shown)</h2>" + "".join(rows))
    body.append("<h2>Photos</h2>" + "".join(overviews))
    (out / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>F-0b renders</title><style>body{font:14px system-ui;margin:16px}"
        ".row{display:flex;gap:12px;align-items:flex-start;border-top:1px solid #ccc;padding:8px 0;flex-wrap:wrap}"
        ".meta{width:180px}figure{margin:0}img{max-width:100%}figure img{max-height:420px}</style>" + "".join(body))
    print(f"render: {args.label} {sum(len(r) for r in sections.values())} boxes, {len(overviews)} photos")


if __name__ == "__main__":
    main()
