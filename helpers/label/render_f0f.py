"""F-0f private before/after renders: each photo twice, side by side. Left, the default as F-0c draws it: spine
boxes yellow (F-0e's colour), F-0c's kept face-out covers green, F-0c's not-a-book flags grey. Right, with F-0f:
boxes the perspective arm changed in cyan (the box it replaced as a thin red outline), shelf labels and cards the
filter removed in magenta with their sub-reason, everything else as on the left. The owner's example photos come
first. Writes JPEGs (each half's long edge 1600 px) and an index.html to --out, which must be a private folder
under the data root (never the repo).

    python -I render_f0f.py --spec render.jsonl --out DIR --arm tops
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys

import cv2
import numpy as np

LONG_EDGE = 1600
SPINE, COVER, FLAG = (0, 200, 255), (60, 200, 60), (150, 150, 150)  # BGR: F-0e yellow, F-0c green, grey
GROWN, REPLACED, LABEL = (255, 220, 0), (40, 40, 230), (220, 60, 230)  # cyan, red, magenta


def key(p: list) -> str:
    return json.dumps(p)


def draw(img: np.ndarray, boxes: list[tuple[list, tuple, int]], scale: float, notes: list[tuple[list, str]] = ()) -> np.ndarray:
    base = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    layer = base.copy()
    polys = [((np.array(p) * scale).astype(np.int32), c, w) for p, c, w in boxes]
    for p, c, w in polys:
        if w > 1:
            cv2.fillPoly(layer, [p], c)
    out = cv2.addWeighted(layer, 0.15, base, 0.85, 0)
    for p, c, w in polys:
        cv2.polylines(out, [p], True, c, w)
    for p, text in notes:
        q = (np.array(p) * scale).astype(np.int32)
        cv2.putText(out, text, (int(q[:, 0].min()), max(12, int(q[:, 1].min()) - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, LABEL, 1, cv2.LINE_AA)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    for a in ("--spec", "--out", "--arm"):
        ap.add_argument(a, required=True)
    args = ap.parse_args()
    root = os.path.realpath(os.environ.get("BOOKCASE_DATA", os.path.expanduser("~/data/bookcase-discovery")))
    out = os.path.realpath(args.out)
    if not out.startswith(os.path.join(root, "private") + os.sep):
        sys.exit("render_f0f: --out must be under the data root's private/ folder")
    os.makedirs(out, exist_ok=True)
    rows = []
    for line in open(args.spec):
        r = json.loads(line)
        img = cv2.imread(r["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        scale = LONG_EDGE / max(img.shape[:2])
        colour = lambda b: COVER if b["kind"] == "face-out" else FLAG if b["kind"] == "not-a-book" else SPINE  # noqa: E731
        left = [(b["polygon"], colour(b), 2) for b in r["before"]]
        replaced = {key(p) for p in r["replaced"]}
        labels = {key(b["polygon"]): b["why"] for b in r["labels"]}
        right = []
        for b in r["before"]:
            k = key(b["polygon"])
            if k in labels:
                right.append((b["polygon"], LABEL, 3))
            elif k in replaced:
                right.append((b["polygon"], REPLACED, 1))
            else:
                right.append((b["polygon"], colour(b), 2))
        right += [(p, LABEL, 3) for p, w in ((b["polygon"], b["why"]) for b in r["labels"]) if key(p) not in {key(x["polygon"]) for x in r["before"]}]
        right += [(p, GROWN, 3) for p in r["grown"]]
        notes = [(b["polygon"], b["why"]) for b in r["labels"]]
        pair = np.concatenate([draw(img, left, scale), np.full((int(img.shape[0] * scale), 12, 3), 30, np.uint8), draw(img, right, scale, notes)], axis=1)
        name = f"pilot-000-{r['n']:02d}.jpg"
        cv2.imwrite(os.path.join(out, name), pair, [cv2.IMWRITE_JPEG_QUALITY, 85])
        tag = f" · owner example: {html.escape(r['example'])}" if r["example"] else ""
        rows.append(f"<h2>{r['n']:02d}{tag} · {html.escape(args.arm)} changed {len(r['grown'])} boxes (replacing {len(r['replaced'])})"
                    f" · labels and cards removed: {len(r['labels'])}"
                    + (f" ({html.escape(', '.join(sorted({b['why'] for b in r['labels']})))})" if r["labels"] else "") + f"</h2><img src='{name}'>")
        print(f"render: {r['n']}", file=sys.stderr, flush=True)
    page = ("<!doctype html><meta charset=utf-8><title>F-0f renders</title><style>body{background:#222;color:#eee;"
            "font:14px system-ui;margin:16px}img{width:100%;margin-bottom:24px}.k span{padding:0 6px;margin-right:8px}</style>"
            f"<h1>F-0f · pilot-000 · left: default with F-0c's kinds (cover pass on, as F-0c drew it) · right: with the label filter (ships)"
            f" and the {html.escape(args.arm)} step (shown for review; no perspective step ships)</h1>"
            "<p class=k><span style='color:#ffc800'>■ spine (yellow)</span><span style='color:#3cc83c'>■ F-0c face-out cover (green)</span>"
            "<span style='color:#969696'>■ F-0c not-a-book (grey)</span><span style='color:#00dcff'>■ changed by the perspective arm (cyan)</span>"
            "<span style='color:#e628e6'>■ shelf label or card removed (magenta)</span><span style='color:#e62828'>□ box it replaced (thin red)</span></p>"
            + "".join(rows))
    with open(os.path.join(out, "index.html"), "w") as f:
        f.write(page)


if __name__ == "__main__":
    main()
