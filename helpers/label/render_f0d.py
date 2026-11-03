"""Private review page for card F-0d (imprint read). Writes under the output folder only (the runner passes the data
root's private/f0d/renders/<set>/): an index.html with, per read box, the crop as the imprint reader saw it (both
rotations), a context window (green: the box), the read imprint and its source, each reader's candidates with whether
their editions carry that imprint, and F-0's decision before and after the tie-break. Never run with an output folder
inside the repository.

Usage: render_f0d.py --boxes boxes.jsonl --out <dir> --label <set>
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

import cv2
import numpy as np

from read import crop

LIMIT = 700  # boxes shown: changed outcomes, then fired tie-breaks, then every box with an imprint, then the rest
CROP_SIDE = 360
CONTEXT_SIDE = 320
GREEN = (60, 200, 60)


def fit(img: np.ndarray, side: int) -> np.ndarray:
    s = min(1.0, side / max(1, max(img.shape[:2])))
    return cv2.resize(img, (max(1, int(img.shape[1] * s)), max(1, int(img.shape[0] * s))), interpolation=cv2.INTER_AREA)


def context(img: np.ndarray, polygon: list[list[float]]) -> np.ndarray:
    pts = np.array(polygon, dtype=np.float64)
    h, w = img.shape[:2]
    m = 0.25 * max(np.ptp(pts[:, 0]), np.ptp(pts[:, 1]))
    x0, y0 = int(max(0, pts[:, 0].min() - m)), int(max(0, pts[:, 1].min() - m))
    x1, y1 = int(min(w, pts[:, 0].max() + m)), int(min(h, pts[:, 1].max() + m))
    win = img[y0:y1, x0:x1].copy()
    k = min(1.0, CONTEXT_SIDE / max(1, max(win.shape[:2])))
    win = cv2.resize(win, (max(1, int(win.shape[1] * k)), max(1, int(win.shape[0] * k))), interpolation=cv2.INTER_AREA)
    p = np.array([[(x - x0) * k, (y - y0) * k] for x, y in polygon], dtype=np.int32)
    cv2.polylines(win, [p], True, GREEN, 2, cv2.LINE_AA)
    return win


def rank(b: dict) -> int:
    if b["before"] != b["after"]:
        return 0
    if b["fired"]:
        return 1
    return 2 if b["imprint"]["key"] else 3


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boxes", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    (out / "img").mkdir(parents=True, exist_ok=True)
    boxes = sorted((json.loads(l) for l in open(args.boxes) if l.strip()), key=lambda b: (rank(b), b["role"], b["id"]))[:LIMIT]
    rows: list[str] = []
    cache: tuple[str, np.ndarray] | None = None
    for n, b in enumerate(sorted(boxes, key=lambda b: b["image"])):
        if cache is None or cache[0] != b["image"]:
            cache = (b["image"], cv2.imread(b["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION))
        img = cache[1]
        if img is None:
            continue
        names = []
        for k, rot in enumerate(b["rotations"]):
            name = f"img/{n:04d}-r{k}.jpg"
            cv2.imwrite(str(out / name), fit(crop(img, b["polygon"], rot), CROP_SIDE), [cv2.IMWRITE_JPEG_QUALITY, 85])
            names.append(name)
        ctx = f"img/{n:04d}-ctx.jpg"
        cv2.imwrite(str(out / ctx), context(img, b["polygon"]), [cv2.IMWRITE_JPEG_QUALITY, 85])
        b["_imgs"], b["_ctx"] = names, ctx
    for b in boxes:
        if "_ctx" not in b:
            continue
        e = html.escape
        im = b["imprint"]
        reads = "<br>".join(
            f"{v['rotation']}°: {e(str(v.get('imprint')))} ({e(str(v.get('imprintFrom')))}) · {e(str(v.get('title')))} / {e(str(v.get('author')))}"
            for v in b["variants"]
        )
        cands = "".join(
            f"<li><b>{e(reader)}</b>: "
            + "; ".join(
                f"{'✔' if c['carries'] else '·'} {e(c['title'])} — {e(', '.join(c['authors']))} ({c['score']}{', passes' if c['passes'] else ''})"
                for c in cs
            )
            + "</li>"
            for reader, cs in b["candidates"].items()
        )
        rows.append(
            f"<tr><td>{''.join(f'<img src={src}>' for src in b['_imgs'])}<br><img src={b['_ctx']}></td>"
            f"<td><b>{e(b['role'])}</b><br>imprint: <b>{e(str(im['name']))}</b> → <code>{e(str(im['key']))}</code> ({e(str(im['from']))})"
            f"{' conflict' if im['conflict'] else ''}<br><small>{reads}</small></td>"
            f"<td><ul>{cands}</ul></td><td>{e(b['before'])} → <b>{e(b['after'])}</b>{' (fired)' if b['fired'] else ''}"
            f"<br>{e(str(b.get('accepted') or ''))}</td></tr>"
        )
    page = (
        f"<!doctype html><meta charset=utf-8><title>F-0d imprint read · {html.escape(args.label)}</title>"
        "<style>body{font:13px system-ui;margin:16px}td{vertical-align:top;border-top:1px solid #ccc;padding:6px}"
        "img{max-height:360px;margin:2px}ul{margin:0;padding-left:16px}</style>"
        f"<h1>F-0d imprint read · {html.escape(args.label)} (private)</h1>"
        f"<p>{len(rows)} boxes: changed outcomes first, then fired tie-breaks, then boxes with an imprint. ✔ = the candidate's editions carry the read imprint.</p>"
        "<table><tr><th>crop (both rotations) and context</th><th>imprint read</th><th>candidates (top 3 per reader)</th><th>F-0 → tie-break</th></tr>"
        + "".join(rows)
        + "</table>"
    )
    (out / "index.html").write_text(page)
    print(f"render: {len(rows)} boxes -> {out / 'index.html'}")


if __name__ == "__main__":
    main()
