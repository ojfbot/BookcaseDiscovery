"""S-2 private still study: the headroom map drawn on each photo, plus an index.html.

Per photo, on the working copy shrunk to ``--long`` px: headroom.py's label map (empty green, occluded grey, occupied
magenta, unknown yellow, book pixels inside the region left as they are), each row's top curve (white) and board line
(cyan; dashed orange where the row is open), occupied regions outlined (magenta when a stacked or not-a-book box
explains them, red when none does: F-0k's candidates) and the known boxes (stacked blue, not-a-book and on-lip cyan).
Photos with the most unexplained occupied pixels come first. Private: it shows the photos.

    python -I render_s2.py --headroom headroom.jsonl --inputs headroom-inputs.jsonl --maps DIR --images images.jsonl --out DIR
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

COLOURS = {1: (60, 200, 60), 2: (150, 150, 150), 3: (220, 0, 220), 4: (0, 220, 255)}  # BGR
NAMES = {1: "empty", 2: "occluded", 3: "occupied", 4: "unknown"}
KNOWN = {"stacked": (255, 120, 0), "not-a-book": (255, 255, 0), "on-lip": (255, 255, 0)}


def pts(xy, s: float) -> np.ndarray:
    return np.round(np.float32(xy) * s).astype(np.int32)


def dashed(im: np.ndarray, p: np.ndarray, colour, step: int = 2) -> None:
    for i in range(0, len(p) - 1, step):
        cv2.line(im, tuple(p[i]), tuple(p[i + 1]), colour, 2, cv2.LINE_AA)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--headroom", required=True)
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--maps", required=True)
    ap.add_argument("--images", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--long", type=int, default=1800)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    images = {json.loads(l)["id"]: json.loads(l)["image"] for l in open(args.images)}
    inputs = {json.loads(l)["id"]: json.loads(l) for l in open(args.inputs)}
    recs = [json.loads(l) for l in open(args.headroom)]
    recs.sort(key=lambda r: -sum(g["px"] for g in r["regions"] if g["explainedBy"] is None))
    cards = []
    for k, rec in enumerate(recs):
        pid = rec["id"]
        im = Image.open(images[pid])
        W0, H0 = im.size
        s = args.long / max(W0, H0)
        bgr = cv2.cvtColor(np.asarray(im.convert("RGB").resize((round(W0 * s), round(H0 * s)))), cv2.COLOR_RGB2BGR)
        lab = cv2.imread(str(Path(args.maps) / f"{pid}.png"), cv2.IMREAD_UNCHANGED)
        lab = cv2.resize(lab, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_NEAREST)
        over = bgr.copy()
        for v, c in COLOURS.items():
            over[lab == v] = c
        o = cv2.addWeighted(bgr, 0.5, over, 0.5, 0)
        for b in inputs[pid]["boxes"]:
            if b["kind"] in KNOWN:
                cv2.polylines(o, [pts(b["polygon"], s)], True, KNOWN[b["kind"]], 2, cv2.LINE_AA)
        for r in rec["rows"]:
            if r.get("topLine"):
                cv2.polylines(o, [pts(r["topLine"], s)], False, (255, 255, 255), 2, cv2.LINE_AA)
            if r.get("boardLine"):
                p = pts(r["boardLine"], s)
                if r.get("source") == "lip":
                    cv2.polylines(o, [p], False, (255, 255, 0), 2, cv2.LINE_AA)
                else:
                    dashed(o, p, (0, 140, 255))
        for g in rec["regions"]:
            colour = (0, 0, 255) if g["explainedBy"] is None else (220, 0, 220)
            cv2.polylines(o, [pts(g["contour"], s)], True, colour, 2 if g["explainedBy"] is None else 1, cv2.LINE_AA)
        name = f"{k:03d}.jpg"
        cv2.imwrite(str(out / name), o, [cv2.IMWRITE_JPEG_QUALITY, 85])
        lip = sum(1 for r in rec["rows"] if r.get("source") == "lip")
        opn = sum(1 for r in rec["rows"] if r.get("source") == "open")
        unexpl = sum(1 for g in rec["regions"] if g["explainedBy"] is None)
        cards.append(f"<figure><img src='{name}' loading='lazy'><figcaption>#{k}: {lip} rows with a board line, {opn} open; "
                     f"{len(rec['regions'])} occupied regions, {unexpl} unexplained</figcaption></figure>")
    legend = " ".join(f"<span style='background:rgb{tuple(reversed(c))};padding:0 6px'>{html.escape(NAMES[v])}</span>" for v, c in COLOURS.items())
    (out / "index.html").write_text(
        "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>S-2 headroom map (private)</title>"
        "<style>body{font:14px system-ui;margin:16px;background:#111;color:#eee}img{max-width:100%}figure{margin:0 0 24px}</style>"
        f"<h1>S-2: headroom map</h1><p>{legend} · white: top curve · cyan: board line (dashed orange: open row) · "
        "<span style='color:#f00'>red</span>: unexplained occupied region (F-0k candidate) · "
        "<span style='color:#f0f'>magenta</span>: explained · blue: stacked box · cyan box: not-a-book / on-lip</p>" + "".join(cards))


if __name__ == "__main__":
    main()
