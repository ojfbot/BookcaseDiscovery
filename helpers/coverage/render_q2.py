"""Q-2 private renders: the student's predicted fill against the teacher's measured fill, and the top-edge overlay.

For each photo, four JPEGs (long edge 2000 px) plus an index.html, all written to --out, which must be a private
folder under the data root (never the repo). Solid = filled (rung text-read or above), hatched = patchy:

- ``-measured``: the teacher's rung (green filled; amber hatch text-present; red hatch spine-found);
- ``-predicted``: the student's P(text-read), red 0 → green 1, solid at or above FILL_P and hatched below;
- ``-agreement``: measured vs predicted (green both filled; blue predicted filled but measured below, the
  closer-look case; orange measured filled but predicted patchy; grey hatch both patchy);
- ``-topedge``: the measured top seam of each box drawn across it (magenta: the box overshoots the spine's top;
  orange: the box cuts it; thin white: clean), the frame-edge ellipse (Q-1 H2) and the top-in-view line.

Boxes outside the student's population (below the box-score floor, or lying) are thin grey outlines.

    python -I render_q2.py --detect … --images … --table … --fill-p 0.7 --seam-off 0.05 --out DIR --label SET
"""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geometry import top_axis  # noqa: E402
from render import ramp  # noqa: E402

LONG_EDGE = 2000
EDGE_RADIAL = 0.5612
TOP_IN_VIEW_Y = 0.6
# BGR
GREEN, AMBER, RED = (80, 200, 60), (0, 190, 255), (60, 60, 230)
BLUE, ORANGE, GREY = (230, 140, 30), (0, 140, 255), (150, 150, 150)
MAGENTA, WHITE = (220, 60, 220), (255, 255, 255)


def hatch_mask(shape: tuple[int, int], step: int = 9) -> np.ndarray:
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    return ((xx + yy) % step) < 2


def draw(base: np.ndarray, items: list[tuple[np.ndarray, tuple[int, int, int], str]], hatch: np.ndarray) -> np.ndarray:
    """items: (polygon, colour, style) with style "solid", "hatch" or "outline"."""
    layer = base.copy()
    for poly, colour, style in items:
        if style == "solid":
            cv2.fillPoly(layer, [poly], colour)
        elif style == "hatch":
            m = np.zeros(base.shape[:2], np.uint8)
            cv2.fillPoly(m, [poly], 1)
            layer[(m > 0) & hatch] = colour
    out = cv2.addWeighted(layer, 0.55, base, 0.45, 0)
    for poly, colour, style in items:
        cv2.polylines(out, [poly], True, colour, 1 if style == "outline" else 2)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    for a in ("--detect", "--images", "--table", "--out", "--label"):
        ap.add_argument(a, required=True)
    ap.add_argument("--fill-p", type=float, required=True)
    ap.add_argument("--seam-off", type=float, required=True)
    args = ap.parse_args()
    paths = {}
    with open(args.images) as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                paths[r["id"]] = r["image"]
    table = {}
    with open(args.table) as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                table[r["id"]] = r
    with open(args.detect) as fh:
        dets = [json.loads(l) for l in fh if l.strip()]
    os.makedirs(args.out, exist_ok=True)
    cards = []
    for n, det in enumerate(dets, 1):
        img = cv2.imread(paths[det["id"]], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        H, W = img.shape[:2]
        s = LONG_EDGE / max(H, W)
        base = cv2.resize(img, (int(W * s), int(H * s)), interpolation=cv2.INTER_AREA)
        hatch = hatch_mask(base.shape[:2])
        meas, pred, agree, top = [], [], [], []
        st = {"n": 0, "pop": 0, "measured": 0, "predicted": 0, "closer": 0, "missed": 0, "overshoot": 0, "cut": 0}
        seams = []
        for i, sp in enumerate(det["spines"]):
            t = table.get(f"{det['id']}:{i}")
            if not t:
                continue
            st["n"] += 1
            poly = np.float64(sp["polygon"])
            q = np.int32(np.round(poly * s))
            if not t["inPopulation"]:
                for lst in (meas, pred, agree):
                    lst.append((q, GREY, "outline"))
            else:
                st["pop"] += 1
                m, p = t["filled"] == 1, t["pStudent"]
                f = p >= args.fill_p
                st["measured"] += m
                st["predicted"] += f
                rung = t["rung"]
                meas.append((q, GREEN, "solid") if m else (q, AMBER if rung == "text-present" else RED, "hatch"))
                pred.append((q, ramp(p), "solid" if f else "hatch"))
                if m and f:
                    agree.append((q, GREEN, "solid"))
                elif f:
                    agree.append((q, BLUE, "solid"))
                    st["closer"] += 1
                elif m:
                    agree.append((q, ORANGE, "solid"))
                    st["missed"] += 1
                else:
                    agree.append((q, GREY, "hatch"))
            cls = t["topClass"]
            colour = {"overshoot": MAGENTA, "cut": ORANGE}.get(cls, WHITE)
            top.append((q, colour, "outline" if cls in ("clean", "none") else "hatch"))
            if cls in ("overshoot", "cut"):
                st[cls] += 1
            if t["topSeam"] is not None:
                a, u, long_, short = top_axis(poly)
                v = np.array([-u[1], u[0]])
                c = a + t["topSeam"] * long_ * u
                seams.append((np.int32(np.round((c - v * short / 2) * s)), np.int32(np.round((c + v * short / 2) * s)), colour))
        stem = f"{args.label}-{n:02d}"
        names = [f"{stem}-{k}.jpg" for k in ("measured", "predicted", "agreement", "topedge")]
        tops = draw(base, top, hatch)
        for p0, p1, colour in seams:
            cv2.line(tops, tuple(int(x) for x in p0), tuple(int(x) for x in p1), colour, 3)
        h, w = base.shape[:2]
        r = EDGE_RADIAL * math.hypot(0.5, 0.5)
        cv2.ellipse(tops, (w // 2, h // 2), (int(r * w), int(r * h)), 0, 0, 360, (0, 255, 255), 2)
        y = int(TOP_IN_VIEW_Y * h)
        for x in range(0, w, 30):
            cv2.line(tops, (x, y), (min(w, x + 15), y), (0, 255, 255), 2)
        for name, im in zip(names, (draw(base, meas, hatch), draw(base, pred, hatch), draw(base, agree, hatch), tops)):
            cv2.imwrite(os.path.join(args.out, name), im, [cv2.IMWRITE_JPEG_QUALITY, 85])
        cards.append((stem, names, st))
        print(f"render: {n}/{len(dets)}", file=sys.stderr)
    tot = {k: sum(c[2][k] for c in cards) for k in cards[0][2]} if cards else {}
    sw = lambda c, label: f'<span style="background:rgb({c[2]},{c[1]},{c[0]});padding:2px 8px;margin-right:6px;color:#000">{label}</span>'
    body = "".join(
        f"<h3>{html.escape(stem)} · {st['n']} detected, {st['pop']} in the student population · measured filled "
        f"{st['measured']}, predicted filled {st['predicted']} (closer-look {st['closer']}, missed {st['missed']}) · "
        f"top overshoot {st['overshoot']}, cut {st['cut']}</h3>"
        + "".join(f'<a href="{x}"><img src="{x}" style="height:420px;margin:4px"></a>' for x in names)
        for stem, names, st in cards
    )
    with open(os.path.join(args.out, "index.html"), "w") as fh:
        fh.write(
            f"<!doctype html><meta charset=utf-8><title>Q-2 {html.escape(args.label)}</title>"
            f"<body style='font-family:sans-serif;background:#222;color:#eee'><h1>Q-2 renders · {html.escape(args.label)}</h1>"
            f"<p>Solid = filled, hatched = patchy, thin grey = outside the student population (below the box-score floor, or lying). "
            f"FILL_P = {args.fill_p}. Totals: {tot.get('pop', 0)} in population, measured filled {tot.get('measured', 0)}, "
            f"predicted filled {tot.get('predicted', 0)}, closer-look {tot.get('closer', 0)}, missed {tot.get('missed', 0)}.</p>"
            f"<p>1 Measured (teacher): {sw(GREEN, 'text-read or above')}{sw(AMBER, 'text-present (hatch)')}{sw(RED, 'spine-found (hatch)')}</p>"
            f"<p>2 Predicted (student): red 0 → green 1; solid at or above FILL_P, hatched below.</p>"
            f"<p>3 Measured vs predicted: {sw(GREEN, 'both filled')}{sw(BLUE, 'predicted filled, measured below (closer look)')}"
            f"{sw(ORANGE, 'measured filled, predicted patchy (missed)')}{sw(GREY, 'both patchy (hatch)')}</p>"
            f"<p>4 Top edge: the line across each box is the measured top seam. {sw(MAGENTA, f'overshoot: seam > {args.seam_off} inside the box')}"
            f"{sw(ORANGE, f'cut: seam > {args.seam_off} beyond the box')}{sw(WHITE, 'clean')} · yellow ellipse = frame edge (radial {EDGE_RADIAL}); "
            f"dashed yellow line = top-in-view (tops below it are seen from above).</p>{body}</body>"
        )


if __name__ == "__main__":
    main()
