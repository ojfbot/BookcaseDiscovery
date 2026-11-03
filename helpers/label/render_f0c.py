"""Private review page for card F-0c (cover-out arm). Writes under the output folder only (the runner passes the data
root's private/f0c/renders/<set>/): an index.html with, per photo, an overview of every box by kind (green: a kept
face-out cover; yellow: spine; grey: not a book; thin green: a spine-path box absorbed into a cover; dotted red: a
cover-pass box dropped as a group of spines or not cover-shaped), and below it each kept cover's crop as the readers
saw it, beside its reads, Qwen's title / author / imprint, each reader's top candidate and F-0's decision. Never run
with an output folder inside the repository.

Usage: render_f0c.py --spec render.jsonl --out <dir> --label <set>
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))  # read.py's crop, as the readers cut it
from read import crop  # noqa: E402

OVERVIEW_SIDE = 1800
CROP_SIDE = 420
COLOURS = {  # BGR
    "face-out": (60, 200, 60),
    "spine": (0, 215, 255),
    "not-a-book": (150, 150, 150),
    "absorbed": (60, 200, 60),
    "dropped": (60, 60, 230),
}


def fit(img: np.ndarray, side: int) -> np.ndarray:
    s = min(1.0, side / max(1, max(img.shape[:2])))
    return cv2.resize(img, (max(1, int(img.shape[1] * s)), max(1, int(img.shape[0] * s))), interpolation=cv2.INTER_AREA)


def dotted(img: np.ndarray, pts: np.ndarray, colour: tuple, thick: int) -> None:
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        n = max(2, int(np.hypot(*(b - a)) / 12))
        for k in range(0, n, 2):
            p, q = a + (b - a) * k / n, a + (b - a) * min(n, k + 1) / n
            cv2.line(img, tuple(int(v) for v in p), tuple(int(v) for v in q), colour, thick, cv2.LINE_AA)


def overview(img: np.ndarray, photo: dict) -> np.ndarray:
    s = OVERVIEW_SIDE / max(img.shape[:2])
    out = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    pts = lambda p: (np.array(p, dtype=np.float64) * s).astype(np.int32)  # noqa: E731
    for d in photo["dropped"]:
        dotted(out, pts(d["polygon"]), COLOURS["dropped"], 1)
    for b in photo["spines"]:
        key = "absorbed" if b["why"] == "absorbed" else b["kind"]
        cv2.polylines(out, [pts(b["polygon"])], True, COLOURS[key], 1 if key in ("spine", "absorbed") else 3, cv2.LINE_AA)
    for k, c in enumerate(photo["covers"]):
        p = pts(c["polygon"])
        cv2.polylines(out, [p], True, COLOURS["face-out"], 4, cv2.LINE_AA)
        x, y = p[:, 0].min(), p[:, 1].min()
        cv2.putText(out, f"C{k + 1}", (int(x) + 4, int(y) + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 4, cv2.LINE_AA)
        cv2.putText(out, f"C{k + 1}", (int(x) + 4, int(y) + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (30, 120, 30), 2, cv2.LINE_AA)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    (out / "img").mkdir(parents=True, exist_ok=True)
    e = html.escape
    sections: list[str] = []
    totals = {"covers": 0, "confirmed": 0, "new": 0, "notabook": 0}
    for line in open(args.spec):
        if not line.strip():
            continue
        photo = json.loads(line)
        img = cv2.imread(photo["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is None:
            continue
        n = photo["n"]
        cv2.imwrite(str(out / f"img/p{n:02d}.jpg"), overview(img, photo), [cv2.IMWRITE_JPEG_QUALITY, 82])
        kinds: dict[str, int] = {}
        for b in photo["spines"]:
            kinds[b["why"]] = kinds.get(b["why"], 0) + 1
        totals["notabook"] += sum(1 for b in photo["spines"] if b["kind"] == "not-a-book")
        rows = []
        for k, c in enumerate(photo["covers"]):
            totals["covers"] += 1
            totals["confirmed"] += bool(c["accepted"])
            totals["new"] += bool(c["newWork"])
            crops = []
            if c["crop"]:
                for r, rot in enumerate(c["crop"]["rotations"]):
                    name = f"img/p{n:02d}-c{k + 1}-r{r}.jpg"
                    cv2.imwrite(str(out / name), fit(crop(img, c["crop"]["polygon"], rot), CROP_SIDE), [cv2.IMWRITE_JPEG_QUALITY, 85])
                    crops.append(f"<img src={name}>")
            q = c["qwen"] or {}
            reads = "".join(f"<li><b>{e(r)}</b>: {e(t)[:400]}</li>" for r, t in c["reads"].items())
            tops = ", ".join(f"{e(r)}: {'✔ ' if c['confirmed'].get(r) else ''}{e(str(w))}" for r, w in c["top"].items())
            if c["accepted"]:
                a = c["accepted"]
                verdict = (f"<b class=ok>confirmed</b> {'<b class=new>new work</b>' if c['newWork'] else '(also on a spine)'}<br>"
                           f"{e(a['title'])} — {e(', '.join(a['authors']))}<br><small>score {a['score']}, readers {e('+'.join(a['agreeing']))}</small>")
            else:
                verdict = f"unknown: {e(str(c['reason']))}"
            rows.append(
                f"<tr><td><b>C{k + 1}</b><br>{''.join(crops)}<br><small>box score {c['boxScore']}; absorbs {c['absorbed']} spine box(es)</small></td>"
                f"<td>Qwen: <b>{e(q.get('title') or '–')}</b> / {e(q.get('author') or '–')} / imprint {e(q.get('imprint') or '–')}"
                f"<ul>{reads}</ul><small>top candidates: {tops}</small></td><td>{verdict}</td></tr>"
            )
        summary = ", ".join(f"{k} {v}" for k, v in sorted(kinds.items()))
        sections.append(
            f"<h2 id=p{n}>Photo {n}</h2><p>{len(photo['covers'])} face-out cover(s); spine-path boxes: {e(summary)}; "
            f"{len(photo['dropped'])} cover-pass box(es) dropped.</p><img class=ov src=img/p{n:02d}.jpg>"
            + (f"<table><tr><th>cover crop (as read)</th><th>reads</th><th>decision</th></tr>{''.join(rows)}</table>" if rows else "")
        )
    page = (
        f"<!doctype html><meta charset=utf-8><title>F-0c cover-out · {e(args.label)}</title>"
        "<style>body{font:13px system-ui;margin:16px;max-width:1900px}td{vertical-align:top;border-top:1px solid #ccc;padding:6px}"
        "td img{max-height:420px;margin:2px}img.ov{max-width:100%}ul{margin:4px 0;padding-left:16px}.ok{color:#1a7f37}.new{color:#fff;background:#1a7f37;padding:0 4px}"
        ".key span{display:inline-block;padding:0 6px;margin-right:6px;border:3px solid}</style>"
        f"<h1>F-0c cover-out arm · {e(args.label)} (private)</h1>"
        f"<p>{totals['covers']} face-out covers kept, {totals['confirmed']} confirmed, {totals['new']} new works (confirmed by no spine box of the "
        f"default); {totals['notabook']} spine-path boxes flagged not-a-book. Machine agreement, never accuracy.</p>"
        "<p class=key><span style='border-color:#3cc83c'>face-out (thick) / absorbed spine box (thin)</span>"
        "<span style='border-color:#ffd700'>spine</span><span style='border-color:#969696'>not-a-book</span>"
        "<span style='border-color:#e63c3c;border-style:dotted'>cover-pass box dropped</span></p>"
        + "".join(sections)
    )
    (out / "index.html").write_text(page)
    print(f"render: {len(sections)} photos -> {out / 'index.html'}", file=sys.stderr)


if __name__ == "__main__":
    main()
