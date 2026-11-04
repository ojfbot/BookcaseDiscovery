"""F-0j private review page (evals/F0j/report.md): book regions with their detected lines coloured by zone role, each OCR
reader's title and author fields, Qwen's fields, and the decision in A0 and each arm. It holds photos and reader text,
so it is written under the data root's private/f0j/renders/<set>/ only, never to the repo.

Usage: render_f0j.py --items items.jsonl --out <dir> --label <set>
Item: {"id", "image", "polygon", "lines": [{"quad", "role"}], "flags": [...], "fields": {reader: {"title", "author"}},
"decisions": {arm: "work title — author" | "unknown: reason"}, "why"}. stderr carries progress only.
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

import cv2
import numpy as np

COLOURS = {"title": (60, 180, 75), "author": (230, 130, 40), "imprint": (200, 60, 200), "unassigned": (150, 150, 150),
           "neighbour": (40, 40, 220)}  # BGR
PAD = 0.15


def order_corners(pts: np.ndarray) -> np.ndarray:
    c = pts.mean(axis=0)
    cw = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    return np.roll(cw, -int(np.argmin(cw[:, 0] + cw[:, 1])), axis=0)


def region_view(img: np.ndarray, polygon, lines) -> np.ndarray:
    """The region cut upright with a margin, turned so the spine runs left to right, lines drawn in role colours."""
    p = order_corners(np.array(polygon, dtype=np.float32))
    w = max(np.linalg.norm(p[1] - p[0]), np.linalg.norm(p[2] - p[3]))
    h = max(np.linalg.norm(p[3] - p[0]), np.linalg.norm(p[2] - p[1]))
    m = PAD * min(w, h)
    W, H = int(round(w + 2 * m)), int(round(h + 2 * m))
    dst = np.array([[m, m], [m + w - 1, m], [m + w - 1, m + h - 1], [m, m + h - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(p, dst)
    out = cv2.warpPerspective(img, M, (W, H), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
    cv2.polylines(out, [np.round(dst).astype(np.int32)], True, (255, 255, 255), 1)
    for ln in lines:
        q = cv2.perspectiveTransform(np.array([ln["quad"]], dtype=np.float32), M)[0]
        cv2.polylines(out, [np.round(q).astype(np.int32)], True, COLOURS.get(ln["role"], (0, 0, 0)), 2)
    if H > W:
        out = cv2.rotate(out, cv2.ROTATE_90_CLOCKWISE)
    s = min(1.0, 900 / out.shape[1])
    if s < 1:
        out = cv2.resize(out, (int(out.shape[1] * s), max(2, int(out.shape[0] * s))), interpolation=cv2.INTER_AREA)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    (out / "regions").mkdir(parents=True, exist_ok=True)
    items = [json.loads(x) for x in open(args.items) if x.strip()]
    cache: tuple[str, np.ndarray] | None = None
    rows = []
    for n, it in enumerate(items):
        if cache is None or cache[0] != it["image"]:
            cache = (it["image"], cv2.imread(it["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION))
        name = f"r{n:04d}.jpg"
        cv2.imwrite(str(out / "regions" / name), region_view(cache[1], it["polygon"], it["lines"]), [cv2.IMWRITE_JPEG_QUALITY, 88])
        fields = "".join(
            f"<tr><td>{html.escape(k)}</td><td>{html.escape(v.get('title') or '—')}</td><td>{html.escape(v.get('author') or '—')}</td></tr>"
            for k, v in it.get("fields", {}).items())
        decs = "".join(f"<li><b>{html.escape(a)}</b>: {html.escape(d)}</li>" for a, d in it.get("decisions", {}).items())
        flags = " ".join(f"<span class=flag>{html.escape(f)}</span>" for f in it.get("flags", []))
        rows.append(f"<section><h3>{n + 1}. {html.escape(it.get('why', ''))} {flags}</h3><img src='regions/{name}'>"
                    f"<table><tr><th>reader</th><th>title field</th><th>author field</th></tr>{fields}</table><ul>{decs}</ul></section>")
        if (n + 1) % 100 == 0:
            print(f"render: {n + 1} regions", file=sys.stderr, flush=True)
    legend = " ".join(f"<span style='color:rgb({c[2]},{c[1]},{c[0]})'>■ {k}</span>" for k, c in COLOURS.items())
    page = f"""<!doctype html><meta charset=utf-8><title>F-0j zones and fields: {html.escape(args.label)}</title>
<style>body{{font:14px system-ui;margin:16px;max-width:960px}}section{{border-top:1px solid #ccc;padding:8px 0}}
img{{max-width:100%;display:block;margin:4px 0}}table{{border-collapse:collapse}}td,th{{border:1px solid #ddd;padding:2px 6px;text-align:left}}
.flag{{background:#fde68a;padding:0 4px;border-radius:3px;font-size:12px}}</style>
<h1>F-0j zones and fields: {html.escape(args.label)}</h1><p>Private: photos and reader text. Line colours: {legend}.
Regions shown: every one whose outcome an arm changed, then multi-book and no-line flags, then a seeded sample.</p>
{''.join(rows)}"""
    (out / "index.html").write_text(page)


if __name__ == "__main__":
    main()
