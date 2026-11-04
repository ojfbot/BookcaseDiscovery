"""F-0i private review page: each photo before and after the instance partition, with per-book coloured mask fills
(the F-0c and F-0e render pages' style, no glow). Before: every kept box's original outline filled in its colour, so
pixels two books claim show both colours mixed, ringed in magenta. After: the partition's label map, one colour per
book, the same colour as before; boxes the gate or the validity rule dropped are dotted red; refit boxes are drawn as
thin white rectangles. Below each overview, the photo's largest conflict groups zoomed in, before beside after.
Writes JPEGs and an index.html to --out, which must be a private folder under the data root (never the repo).

    python -I render_f0i.py --detect D --outlines O --table T --images I --part DIR --out DIR --label SET
"""

from __future__ import annotations

import argparse
import colorsys
import html
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from overlap import raster, read_jsonl  # noqa: E402

SIDE, ZOOM, ZOOMS = 1400, 520, 4
ALPHA = 0.5


def colour(i: int) -> tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb((i * 0.618033988749895) % 1.0, 0.75, 1.0)
    return int(b * 255), int(g * 255), int(r * 255)


def dotted(img: np.ndarray, pts: np.ndarray, c: tuple, t: int) -> None:
    for i in range(len(pts)):
        a, b = pts[i].astype(float), pts[(i + 1) % len(pts)].astype(float)
        n = max(2, int(np.hypot(*(b - a)) / 10))
        for k in range(0, n, 2):
            p, q = a + (b - a) * k / n, a + (b - a) * min(n, k + 1) / n
            cv2.line(img, tuple(int(v) for v in p), tuple(int(v) for v in q), c, t, cv2.LINE_AA)


def fills(shape: tuple, items: list[tuple[int, list]]) -> tuple[np.ndarray, np.ndarray]:
    """Mean colour of the books claiming each pixel, and the claim count."""
    H, W = shape
    acc = np.zeros((H, W, 3), np.float32)
    cnt = np.zeros((H, W), np.uint8)
    for idx, o in items:
        if not o or len(o) < 3:
            continue
        m = raster(o, 0, 0, W, H)
        acc[m] += colour(idx)
        cnt[m] += 1
    out = np.where(cnt[..., None] > 0, acc / np.maximum(cnt, 1)[..., None], 0)
    return out.astype(np.uint8), cnt


def blend(base: np.ndarray, fill: np.ndarray, mask: np.ndarray) -> np.ndarray:
    out = base.copy()
    out[mask] = (base[mask] * (1 - ALPHA) + fill[mask] * ALPHA).astype(np.uint8)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    for k in ("detect", "outlines", "table", "images", "part", "out", "label"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--first", default="", help="JSON list of [photo id, caption]: these photos lead the page")
    a = ap.parse_args()
    out = Path(a.out)
    (out / "img").mkdir(parents=True, exist_ok=True)
    keep = {r["id"] for r in read_jsonl(a.table)}
    outlines = {r["id"]: r["outline"] for r in read_jsonl(a.outlines) if r.get("outline")}
    images = {r["id"]: r["image"] for r in read_jsonl(a.images)}
    part = Path(a.part)
    rows: dict[str, list[dict]] = {}
    for r in read_jsonl(str(part / "partition.jsonl")):
        rows.setdefault(r["id"].rsplit(":", 1)[0], []).append(r)
    groups: dict[str, list[dict]] = {}
    for g in read_jsonl(str(part / "groups.jsonl")):
        groups.setdefault(g["photo"], []).append(g)
    photos = {p["photo"]: p for p in read_jsonl(str(part / "photos.jsonl"))}
    sections = []
    first = json.loads(a.first) if a.first else []
    lead = {pid: cap for pid, cap in first}
    dets = read_jsonl(a.detect)
    order = sorted(range(len(dets)), key=lambda k: ([p for p, _ in first].index(dets[k].get("id")) if dets[k].get("id") in lead else len(first), k))
    for n in order:
        d = dets[n]
        pid = d.get("id")
        if d.get("error") or pid not in rows or pid not in images:
            continue
        img = cv2.imread(images[pid], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        label = cv2.imread(str(part / "labels" / f"{pid}.png"), cv2.IMREAD_UNCHANGED)
        if img is None or label is None:
            continue
        s = SIDE / max(img.shape[:2])
        small = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        sh = small.shape[:2]
        sc = lambda o: (np.array(o, float) * s).tolist()  # noqa: E731
        idx_of = lambda bid: int(bid.rsplit(":", 1)[1])  # noqa: E731
        before_items = [(idx_of(r["id"]), sc(outlines[r["id"]])) for r in rows[pid] if r["id"] in outlines and r["id"] in keep]
        bf, bc = fills(sh, before_items)
        left = blend(small, bf, bc > 0)
        multi = (bc >= 2).astype(np.uint8)
        cnts, _ = cv2.findContours(multi, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(left, cnts, -1, (255, 0, 255), 1, cv2.LINE_AA)
        lab = cv2.resize(label, (sh[1], sh[0]), interpolation=cv2.INTER_NEAREST).astype(int)
        palette = np.zeros((max(lab.max(), 1) + 1, 3), np.uint8)
        for i in range(1, len(palette)):
            palette[i] = colour(i - 1)
        right = blend(small, palette[lab], lab > 0)
        for r in rows[pid]:
            if r["state"] == "dropped":
                p = np.array(d["spines"][idx_of(r["id"])]["polygon"], float) * s
                dotted(right, cv2.boxPoints(cv2.minAreaRect(p.astype(np.float32))), (60, 60, 230), 1)
            elif r.get("refit"):
                cv2.polylines(right, [(np.array(r["refit"]) * s).astype(np.int32)], True, (255, 255, 255), 1, cv2.LINE_AA)
        pair = np.hstack([left, np.full((sh[0], 8, 3), 30, np.uint8), right])
        name = f"img/p{n:02d}.jpg"
        cv2.imwrite(str(out / name), pair, [cv2.IMWRITE_JPEG_QUALITY, 84])
        # zooms: the largest conflict groups, full resolution, before beside after
        zooms = []
        gs = sorted(groups.get(pid, []), key=lambda g: -sum(w.get("contested", 0) for w in g["windows"]))[:ZOOMS]
        for z, g in enumerate(gs):
            mem = [m for m in g["members"] if m in outlines]
            pts = np.concatenate([np.array(outlines[m]) for m in mem])
            x0, y0 = np.maximum(pts.min(0).astype(int) - 40, 0)
            x1, y1 = np.minimum(pts.max(0).astype(int) + 40, [img.shape[1], img.shape[0]])
            crop = img[y0:y1, x0:x1]
            zs = min(1.0, ZOOM / max(crop.shape[:2]))
            cs = cv2.resize(crop, None, fx=zs, fy=zs, interpolation=cv2.INTER_AREA)
            csh = cs.shape[:2]
            loc = lambda o: ((np.array(o, float) - [x0, y0]) * zs).tolist()  # noqa: E731
            nb = [(idx_of(r["id"]), loc(outlines[r["id"]])) for r in rows[pid] if r["id"] in outlines and r["id"] in keep
                  and np.array(outlines[r["id"]])[:, 0].max() >= x0 and np.array(outlines[r["id"]])[:, 0].min() <= x1
                  and np.array(outlines[r["id"]])[:, 1].max() >= y0 and np.array(outlines[r["id"]])[:, 1].min() <= y1]
            zf, zc = fills(csh, nb)
            zl = blend(cs, zf, zc > 0)
            c2, _ = cv2.findContours((zc >= 2).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(zl, c2, -1, (255, 0, 255), 1, cv2.LINE_AA)
            zlab = cv2.resize(label[y0:y1, x0:x1], (csh[1], csh[0]), interpolation=cv2.INTER_NEAREST).astype(int)
            zr = blend(cs, palette[np.minimum(zlab, len(palette) - 1)], zlab > 0)
            zname = f"img/p{n:02d}-g{z}.jpg"
            cv2.imwrite(str(out / zname), np.hstack([zl, np.full((csh[0], 6, 3), 30, np.uint8), zr]), [cv2.IMWRITE_JPEG_QUALITY, 86])
            zooms.append(f"<img src={zname}>")
        ph = photos.get(pid, {})
        stats = ""
        if ph:
            b, af = ph["before"], ph["after"]
            stats = (f"overlap {100 * b['multi'] / max(b['claimed'], 1):.1f} % → {100 * af['multi'] / max(af['claimed'], 1):.2f} %; "
                     f"{ph['boxes']} boxes, {ph['kept']} kept, {ph['changed']} changed, {ph['flagged']} flagged; "
                     f"{ph['groups']} conflict groups, {ph['windows']} windows")
        dropped = sum(1 for r in rows[pid] if r["state"] == "dropped")
        cap = f" — owner's example: {html.escape(lead[pid])}" if pid in lead else ""
        sections.append(f"<section><h2>Photo {n + 1}{cap}</h2><p>{html.escape(stats)}; {dropped} dropped</p>"
                        f"<img class=wide src={name}><div class=z>{''.join(zooms)}</div></section>")
    page = ("<!doctype html><meta charset=utf-8><title>F-0i partition</title><style>body{background:#222;color:#eee;"
            "font:14px system-ui;margin:16px}img.wide{max-width:100%}.z img{margin:4px;max-width:48%}h2{margin:24px 0 4px}"
            "</style>"
            f"<h1>F-0i instance partition: {html.escape(a.label)}</h1>"
            "<p>Left: original outlines, one colour per book; pixels two books claim show both colours mixed, ringed in "
            "magenta. Right: the partition, one owner per pixel, each book in the same colour; dotted red = dropped "
            "(gate or absorbed), thin white = refit box. Zooms: the largest conflict groups, before beside after.</p>"
            + "".join(sections))
    (out / "index.html").write_text(page)
    print(f"render: {len(sections)} photos under the output folder", file=sys.stderr)


if __name__ == "__main__":
    main()
