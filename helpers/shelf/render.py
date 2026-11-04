"""S-1 private still study: shelf planes, voids and on-lip flags drawn on each photo, plus an index.html.

Per photo, on the working copy shrunk to ``--long`` px: the label map from shelf.py (board top blue, lip yellow,
back panel violet, void green, outline gap orange, behind under an outline red), each row's polyline, boxes the
shipped filter drops (F-0c, F-0f: cyan) and boxes ``on-lip`` flags (magenta, thick). Private: it shows the photos.

    python -I render.py --inputs inputs.jsonl --shelf shelf.jsonl --maps DIR --flags flags.jsonl --images images.jsonl --out DIR
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

COLOURS = {1: (255, 120, 30), 2: (0, 220, 255), 3: (200, 60, 170), 4: (60, 220, 60), 5: (0, 140, 255), 6: (40, 40, 230)}  # BGR
NAMES = {1: "board top", 2: "lip", 3: "back panel", 4: "void", 5: "outline gap", 6: "behind under outline"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--shelf", required=True)
    ap.add_argument("--maps", required=True)
    ap.add_argument("--flags", required=True, help="JSON Lines {id, filtered: [box], onLip: [box], onLipCovers: [j]}")
    ap.add_argument("--images", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--long", type=int, default=1800)
    ap.add_argument("--only", nargs="*", default=None)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    images = {json.loads(l)["id"]: json.loads(l)["image"] for l in open(args.images)}
    inputs = {json.loads(l)["id"]: json.loads(l) for l in open(args.inputs)}
    flags = {json.loads(l)["id"]: json.loads(l) for l in open(args.flags)}
    cards = []
    for k, line in enumerate(open(args.shelf)):
        rec = json.loads(line)
        pid = rec["id"]
        if args.only and pid not in args.only:
            continue
        inp, fl = inputs[pid], flags.get(pid, {})
        im = Image.open(images[pid])
        W0, H0 = im.size
        s = args.long / max(W0, H0)
        bgr = cv2.cvtColor(np.asarray(im.convert("RGB").resize((round(W0 * s), round(H0 * s)))), cv2.COLOR_RGB2BGR)
        lab = cv2.imread(str(Path(args.maps) / f"{pid}.png"), cv2.IMREAD_UNCHANGED)
        lab = cv2.resize(lab, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_NEAREST)
        over = bgr.copy()
        for v, c in COLOURS.items():
            over[lab == v] = c
        out_im = cv2.addWeighted(bgr, 0.45, over, 0.55, 0)
        for r in rec["rows"]:
            line_pts = (r.get("voids") or {}).get("line")
            if line_pts:
                cv2.polylines(out_im, [np.round(np.float32(line_pts) * s).astype(np.int32)], False, (255, 255, 255), 1, cv2.LINE_AA)
        for i in fl.get("filtered", []):
            cv2.polylines(out_im, [np.round(np.float32(inp["spines"][i]["polygon"]) * s).astype(np.int32)], True, (255, 255, 0), 2, cv2.LINE_AA)
        for i in fl.get("onLip", []):
            cv2.polylines(out_im, [np.round(np.float32(inp["spines"][i]["polygon"]) * s).astype(np.int32)], True, (255, 0, 255), 3, cv2.LINE_AA)
        for j in fl.get("onLipCovers", []):
            cv2.polylines(out_im, [np.round(np.float32(inp["covers"][j]["polygon"]) * s).astype(np.int32)], True, (180, 0, 255), 3, cv2.LINE_AA)
        name = f"{k:03d}.jpg"
        cv2.imwrite(str(out / name), out_im, [cv2.IMWRITE_JPEG_QUALITY, 85])
        found = {p: sum(1 for r in rec["rows"] if r.get("planes", {}).get(p, {}).get("found")) for p in ("board", "lip", "back")}
        rows = sum(1 for r in rec["rows"] if "planes" in r)
        voids = sum(1 for r in rec["rows"] for x in (r.get("voids") or {}).get("stretches", []) if x["kind"] == "void")
        cards.append(f"<figure><img src='{name}' loading='lazy'><figcaption>#{k}: {rows} rows; board top {found['board']}, "
                     f"lip {found['lip']}, back panel {found['back']}; {voids} voids; on-lip {len(fl.get('onLip', []))} "
                     f"(+{len(fl.get('onLipCovers', []))} covers); filtered {len(fl.get('filtered', []))}</figcaption></figure>")
    legend = " ".join(f"<span style='background:rgb{tuple(reversed(c))};padding:0 6px'>{html.escape(NAMES[v])}</span>" for v, c in COLOURS.items())
    (out / "index.html").write_text(
        "<!doctype html><meta charset='utf-8'><title>S-1 shelf structure (private)</title>"
        "<style>body{font:14px system-ui;margin:16px;background:#111;color:#eee}img{max-width:100%}figure{margin:0 0 24px}</style>"
        f"<h1>S-1: shelf planes, voids, on-lip</h1><p>{legend} · <span style='color:#0ff'>cyan</span> filtered by F-0c/F-0f · "
        "<span style='color:#f0f'>magenta</span> on-lip · white: row polylines</p>" + "".join(cards))


if __name__ == "__main__":
    main()
