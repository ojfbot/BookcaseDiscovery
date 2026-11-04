"""F-0h private review page: neighbour context on pilot-000 photos.

Usage: render_f0h.py --spec render.jsonl --out <dir> [--examples <dir>]
Each spec line is one photo: every box with its state (anchor, confirmed-by-copy, confirmed-by-context, hypothesis,
tried and left unknown, not a book, other), its work or hypothesis, and the detection-gap flags. Every book is a
coloured mask fill, never a glow: books of one author share a hue (so author runs show), other books get their own
hue, and the outline colour says the state. The owner's example photos come first, after the examples themselves.
The page holds photos, titles and author names: it is written under the data root and never committed.
"""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import html
import json
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

OVERVIEW_SIDE = 2400
OUTLINE = {  # BGR
    "anchor": (60, 180, 60),
    "copy": (230, 60, 230),
    "context": (255, 0, 255),
    "hypothesis": (0, 140, 255),
    "tried": (150, 150, 150),
    "other": (200, 200, 200),
    "not-a-book": (60, 60, 60),
}
FILL_ALPHA = 0.42
EXAMPLES = ("owner-2026-11-03-neighbour-context.png", "owner-2026-11-03-author-run-infill.webp")


def hue_colour(key: str, sat: float = 0.85, val: float = 0.95) -> tuple[int, int, int]:
    h = int(hashlib.sha1(key.encode()).hexdigest()[:6], 16) / 0xFFFFFF
    r, g, b = colorsys.hsv_to_rgb(h, sat, val)
    return int(b * 255), int(g * 255), int(r * 255)


def author_of(b: dict) -> str | None:
    if b.get("hypothesis"):
        return b["hypothesis"]["author"]
    if b.get("work") and " — " in b["work"]:
        return b["work"].split(" — ", 1)[1]
    return None


def overview(img: np.ndarray, photo: dict) -> np.ndarray:
    s = OVERVIEW_SIDE / max(img.shape[:2])
    out = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    pts = [(np.array(b["polygon"], dtype=np.float64) * s).astype(np.int32) for b in photo["spines"]]
    # Two passes: other books a light fill of their own, then anchors, copies, context and hypotheses in their author's hue.
    for strong, alpha in ((False, FILL_ALPHA / 2), (True, FILL_ALPHA * 1.4)):
        fill = out.copy()
        for i, (p, b) in enumerate(zip(pts, photo["spines"])):
            if b["state"] == "not-a-book":
                continue
            a = author_of(b)
            mine = bool(a) and b["state"] in ("anchor", "copy", "context", "hypothesis")
            if mine != strong:
                continue
            cv2.fillPoly(fill, [p], hue_colour(f"author:{a}") if mine else hue_colour(f"box:{i}", 0.3, 0.9), cv2.LINE_AA)
        out = cv2.addWeighted(fill, alpha, out, 1 - alpha, 0)
    for i, (p, b) in enumerate(zip(pts, photo["spines"])):
        heavy = b["state"] in ("context", "hypothesis")
        cv2.polylines(out, [p], True, OUTLINE[b["state"]], 4 if heavy else 2 if b["state"] in ("anchor", "copy") else 1, cv2.LINE_AA)
        if b["state"] in ("context", "hypothesis", "anchor"):
            x, y = p[:, 0].min(), p[:, 1].min()
            cv2.putText(out, str(i), (int(x), int(y) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 3, cv2.LINE_AA)
            cv2.putText(out, str(i), (int(x), int(y) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, OUTLINE[b["state"]], 1, cv2.LINE_AA)
    for g in photo["gaps"]:
        a, c = (pts[g["between"][0]], pts[g["between"][1]])
        ca = (int(a[:, 0].mean()), int(a[:, 1].max()) + 8)
        cc = (int(c[:, 0].mean()), int(c[:, 1].max()) + 8)
        cv2.line(out, ca, cc, (0, 0, 230), 3, cv2.LINE_AA)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--examples")
    args = ap.parse_args()
    out = Path(args.out)
    (out / "img").mkdir(parents=True, exist_ok=True)
    e = html.escape
    head: list[str] = []
    if args.examples:
        for name in EXAMPLES:
            f = Path(args.examples) / name
            if f.exists():
                shutil.copy(f, out / "img" / f.name)
                head.append(f"<figure><img class=ex src='img/{e(f.name)}'><figcaption>owner example: {e(f.stem)}</figcaption></figure>")
    sections: list[str] = []
    totals = {"context": 0, "hypothesis": 0, "gaps": 0}
    for line in open(args.spec):
        if not line.strip():
            continue
        photo = json.loads(line)
        img = cv2.imread(photo["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is None:
            continue
        n = photo["n"]
        cv2.imwrite(str(out / f"img/p{n:02d}.jpg"), overview(img, photo), [cv2.IMWRITE_JPEG_QUALITY, 82])
        spines = photo["spines"]
        ctx = [(i, b) for i, b in enumerate(spines) if b["state"] == "context"]
        hyp = [(i, b) for i, b in enumerate(spines) if b["state"] == "hypothesis"]
        tried = [(i, b) for i, b in enumerate(spines) if b["state"] == "tried"]
        totals["context"] += len(ctx)
        totals["hypothesis"] += len(hyp)
        totals["gaps"] += len(photo["gaps"])
        rows = [f"<tr><td>box {i}</td><td><b class=ctx>confirmed-by-context</b></td><td>{e(b['work'] or '')}</td><td>anchors {e(', '.join(a.split(':')[-1] for a in b['anchors']))}</td></tr>" for i, b in ctx]
        rows += [
            f"<tr><td>box {i}</td><td><b class=hyp>hypothesis</b> (author {e(b['hypothesis']['author'])}, prior {b['hypothesis']['prior']})</td>"
            f"<td>{e('; '.join(b['hypothesis']['works']))}</td><td>anchors {e(', '.join(a.split(':')[-1] for a in b['anchors']))}</td></tr>"
            for i, b in hyp
        ]
        rows += [f"<tr><td>box {i}</td><td>unknown</td><td>{e(b['why'] or '')}</td><td>anchors {e(', '.join(a.split(':')[-1] for a in b['anchors']))}</td></tr>" for i, b in tried]
        tag = f" · <b>owner example photo</b> ({e(photo['example'])})" if photo.get("example") else ""
        sections.append(
            f"<h2 id=p{n}>Photo {n} (half {photo['half']}){tag}</h2><p>{len(ctx)} confirmed-by-context, {len(hyp)} hypotheses, "
            f"{len(tried)} tried and left unknown, {len(photo['gaps'])} detection-gap flag(s).</p>"
            f"<img class=ov src=img/p{n:02d}.jpg>"
            + (f"<table><tr><th>box</th><th>state</th><th>work / ranked works / why</th><th>context</th></tr>{''.join(rows)}</table>" if rows else "")
        )
    page = (
        "<!doctype html><meta charset=utf-8><title>F-0h neighbour context · pilot-000</title>"
        "<style>body{font:13px system-ui;margin:16px;max-width:2400px}td{vertical-align:top;border-top:1px solid #ccc;padding:4px 8px}"
        "img.ov{max-width:100%}img.ex{max-width:640px}.ctx{color:#c000c0}.hyp{color:#e07800}"
        ".key span{display:inline-block;padding:0 6px;margin-right:6px;border:3px solid}figure{margin:0 0 16px}</style>"
        "<h1>F-0h neighbour context · pilot-000 (private)</h1>"
        f"<p>{totals['context']} boxes confirmed-by-context, {totals['hypothesis']} hypotheses, {totals['gaps']} detection-gap flags. "
        "Machine agreement, never accuracy. Fills: one hue per author for anchors, context and hypotheses (author runs share a "
        "hue); other books a pale hue of their own.</p>"
        "<p class=key><span style='border-color:#3cb43c'>anchor (two readers)</span><span style='border-color:#e63ce6'>confirmed-by-copy</span>"
        "<span style='border-color:#ff00ff'>confirmed-by-context</span><span style='border-color:#ff8c00'>hypothesis</span>"
        "<span style='border-color:#969696'>tried, unknown</span><span style='border-color:#e60000'>detection gap (line under)</span></p>"
        + "".join(head)
        + "".join(sections)
    )
    (out / "index.html").write_text(page)
    print(f"render: {len(sections)} photos -> {out / 'index.html'}", file=sys.stderr)


if __name__ == "__main__":
    main()
