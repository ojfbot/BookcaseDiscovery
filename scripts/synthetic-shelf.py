"""Generate a synthetic shelf photo with fake book spines, plus its ground truth (V-1a).

Everything is invented: made-up titles and authors, drawn rectangles, no real photo. Output goes to --out
(use a directory under $BOOKCASE_DATA/labels/, or a temp dir); only the tiny --small fixture is committed.

Run with Label Studio's own Python, which already ships Pillow and numpy:
    ~/.local/share/uv/tools/label-studio/bin/python scripts/synthetic-shelf.py --out DIR [--name shelf-20]

Writes <name>.jpg, <name>.truth.json (label schema, docs/labels.md) and <name>.tasks.json (Label Studio tasks).
"""

import argparse
import hashlib
import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

WORDS_A = ["Salt", "Glass", "Lantern", "Orchard", "Ember", "Harbour", "Cinder", "Meridian", "Velvet", "Granite",
           "Paper", "Tide", "Hollow", "Saffron", "Iron", "Moth", "Copper", "Winter", "Quiet", "Amber"]
WORDS_B = ["Cartographer", "Archive", "Garden", "Engine", "Atlas", "Orchestra", "Lighthouse", "Almanac", "Station",
           "Threshold", "Inheritance", "Symmetry", "Parade", "Accord", "Footprints", "Reservoir", "Bestiary", "Carousel"]
FIRST = ["Mara", "Idris", "Collette", "Tobias", "Yuki", "Anselm", "Priya", "Lucan", "Odile", "Femi", "Wren", "Saskia"]
LAST = ["Verhoeven", "Okafor", "Lindqvist", "Marchetti", "Abara", "Holloway", "Castellan", "Rydell", "Nakamura", "Pell"]
FONT_PATHS = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc",
              "/Library/Fonts/Arial.ttf"]


def font(size: int) -> ImageFont.FreeTypeFont:
    for p in FONT_PATHS:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def vertical_text(text: str, size: int, fill, max_len: int):
    """Text reading top to bottom (a Western spine), as an RGBA image."""
    f = font(size)
    box = f.getbbox(text)
    w, h = box[2] + 8, box[3] + 8
    while w > max_len and size > 12:  # shrink to fit the spine length
        size = int(size * 0.9)
        f = font(size)
        box = f.getbbox(text)
        w, h = box[2] + 8, box[3] + 8
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((4, 4), text, font=f, fill=fill)
    return img.rotate(-90, expand=True)


def rot(p, centre, th):
    c, s = math.cos(th), math.sin(th)
    dx, dy = p[0] - centre[0], p[1] - centre[1]
    return (centre[0] + dx * c - dy * s, centre[1] + dx * s + dy * c)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--name", default="shelf-20")
    ap.add_argument("--width", type=int, default=8064)  # 8064 x 6048 = 48.8 MP
    ap.add_argument("--height", type=int, default=6048)
    ap.add_argument("--spines", type=int, default=20)
    ap.add_argument("--tilt", type=float, default=3.0, help="shelf tilt in degrees (clockwise)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--noise", type=float, default=6.0, help="gaussian noise sigma; 0 for a flat image")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--setting", default="shelf-48")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    W, H = args.width, args.height
    args.out.mkdir(parents=True, exist_ok=True)

    img = Image.new("RGB", (W, H), (222, 214, 200))  # wall
    d = ImageDraw.Draw(img)
    th = math.radians(args.tilt)
    centre = (W / 2, H / 2)

    # Shelf frame (before tilt): books stand on a board; spines fill the width.
    margin = int(W * 0.04)
    board_y = int(H * 0.82)
    board_h = int(H * 0.05)
    spine_top_max = int(H * 0.16)
    xs = np.cumsum([0] + [rng.uniform(0.7, 1.3) for _ in range(args.spines)])
    xs = margin + (xs / xs[-1]) * (W - 2 * margin)

    def tilted(poly):
        return [rot(p, centre, th) for p in poly]

    d.polygon(tilted([(0, board_y), (W, board_y), (W, board_y + board_h), (0, board_y + board_h)]), fill=(120, 84, 52))
    truth_spines, text_jobs = [], []
    for i in range(args.spines):
        x0, x1 = xs[i], xs[i + 1]
        gap = max(4, (x1 - x0) * 0.04)
        x0, x1 = x0 + gap / 2, x1 - gap / 2
        top = spine_top_max + rng.randint(0, int(H * 0.08))
        quad = [(x0, top), (x1, top), (x1, board_y), (x0, board_y)]
        colour = tuple(rng.randint(30, 200) for _ in range(3))
        d.polygon(tilted(quad), fill=colour)
        dark = sum(colour) / 3 < 110
        title = f"{rng.choice(WORDS_A)} {rng.choice(WORDS_B)}"
        author = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        text_jobs.append((quad, title, author, (245, 245, 235) if dark else (25, 25, 25)))
        poly = [[round(v, 3) for v in p] for p in tilted(quad)]
        truth_spines.append({"id": f"s{i:02d}", "polygon": poly, "shelf": 0, "ordinal": i, "kind": "spine",
                             "text": {"title": title, "author": author}, "unreadable": False, "catalogId": None, "notes": ""})

    # Text is drawn on a straight layer, rotated with the shelf, then composited.
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for quad, title, author, fill in text_jobs:
        x0, top, x1, bot = quad[0][0], quad[0][1], quad[1][0], quad[2][1]
        width, length = x1 - x0, bot - top
        t = vertical_text(title, int(width * 0.42), fill, int(length * 0.62))
        layer.alpha_composite(t, (int(x0 + (width - t.width) / 2), int(top + length * 0.05)))
        a = vertical_text(author, int(width * 0.26), fill, int(length * 0.28))
        layer.alpha_composite(a, (int(x0 + (width - a.width) / 2), int(bot - a.height - length * 0.04)))
    layer = layer.rotate(-args.tilt, resample=Image.BICUBIC, center=centre)
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

    if args.noise > 0:
        arr = np.asarray(img).astype(np.int16)
        noise = np.random.default_rng(args.seed).normal(0, args.noise, size=arr.shape[:2] + (1,)).astype(np.int16)
        img = Image.fromarray(np.clip(arr + noise, 0, 255).astype(np.uint8))

    jpg = args.out / f"{args.name}.jpg"
    img.save(jpg, quality=args.quality)
    sha = hashlib.sha256(jpg.read_bytes()).hexdigest()

    band = tilted([(0, spine_top_max - 40), (W, spine_top_max - 40), (W, board_y + board_h), (0, board_y + board_h)])
    truth = {
        "schemaVersion": 1, "session": "synthetic",
        "photos": [{"hash": sha, "setting": args.setting, "shelfIndex": 0, "width": W, "height": H,
                    "shelfBands": [{"id": "band0", "polygon": [[round(v, 3) for v in p] for p in band]}],
                    "spines": truth_spines}],
    }
    (args.out / f"{args.name}.truth.json").write_text(json.dumps(truth, indent=2) + "\n")
    tasks = [{"data": {"image": f"/data/local-files/?d=labels/synthetic/{jpg.name}", "hash": sha, "setting": args.setting,
                       "shelfIndex": 0, "width": W, "height": H}}]
    (args.out / f"{args.name}.tasks.json").write_text(json.dumps(tasks, indent=2) + "\n")
    print(f"{jpg} {W}x{H} ({W * H / 1e6:.1f} MP) {jpg.stat().st_size / 1e6:.2f} MB sha256={sha[:12]}")


if __name__ == "__main__":
    main()
