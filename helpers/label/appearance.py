"""F-0g copy groups: how alike two neighbouring spines look, from pixels only (no model, no text).

Usage: appearance.py < requests.jsonl > responses.jsonl
Request: {"id": <image id>, "image": <path>, "spines": [{"i", "polygon"}], "pairs": [[i, j], ...]}
Response: {"id", "pairs": [{"a", "b", "ncc", "hist", "prof", "valid"}], "seconds"} or {"id", "error"}.

Each spine is cut as an upright strip: the polygon is warped to a rectangle whose long side runs top to bottom,
the top being the short side nearer the image's top (a spine standing on its shelf reads the same way in every
copy), then shrunk to a fixed 16 x 96 px. Three similarities per pair, each 0..1:
  ncc  - normalised cross-correlation of the grey strips (zero mean, unit variance), best over small shifts
         (up to 4 px along the spine, 1 px across) so a box that starts a little lower still lines up;
  hist - Bhattacharyya coefficient of hue x saturation histograms (12 x 4, pixels with some saturation and light)
         plus a 4-bin lightness histogram of the grey pixels, weighted by their share;
  prof - colour layout along the spine: 1 - mean CIE76 distance between the two strips' mean Lab colours in
         12 segments, divided by 50 and clipped.
`valid` is false when a strip is mostly outside the frame. stderr carries progress only.
"""

from __future__ import annotations

import json
import sys
import time

import cv2
import numpy as np

W, H = 16, 96
SEGMENTS = 12
SHIFT_Y, SHIFT_X = 4, 1


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def upright_corners(polygon: list[list[float]]) -> np.ndarray:
    """Corners as top-left, top-right, bottom-right, bottom-left of the upright strip (long side vertical)."""
    p = np.array(polygon, dtype=np.float32)
    c = p.mean(axis=0)
    p = p[np.argsort(np.arctan2(p[:, 1] - c[1], p[:, 0] - c[0]))]  # clockwise on screen
    e = [np.linalg.norm(p[(k + 1) % 4] - p[k]) for k in range(4)]
    # Short sides are the ends; the top end is the one whose midpoint is higher in the image.
    k0 = 0 if e[0] + e[2] <= e[1] + e[3] else 1
    ends = [(k0, (k0 + 1) % 4), ((k0 + 2) % 4, (k0 + 3) % 4)]
    mids = [(p[a] + p[b]) / 2 for a, b in ends]
    top, bottom = ends if mids[0][1] <= mids[1][1] else ends[::-1]
    a, b = p[top[0]], p[top[1]]
    tl, tr = (a, b) if a[0] <= b[0] else (b, a)
    a, b = p[bottom[0]], p[bottom[1]]
    bl, br = (a, b) if a[0] <= b[0] else (b, a)
    return np.array([tl, tr, br, bl], dtype=np.float32)


def strip(img: np.ndarray, polygon: list[list[float]]) -> tuple[np.ndarray, bool]:
    src = upright_corners(polygon)
    dst = np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    # Warp at a larger size first and shrink with area averaging, so a 1000 px spine is not point-sampled.
    big = 4
    dst4 = dst * big
    m4 = cv2.getPerspectiveTransform(src, dst4)
    out = cv2.warpPerspective(img, m4, (W * big, H * big), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    mask = cv2.warpPerspective(np.full(img.shape[:2], 255, np.uint8), m, (W, H), flags=cv2.INTER_NEAREST, borderValue=0)
    return cv2.resize(out, (W, H), interpolation=cv2.INTER_AREA), bool((mask > 0).mean() >= 0.8)


def describe(bgr: np.ndarray) -> dict:
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lab = cv2.cvtColor(bgr.astype(np.float32) / 255.0, cv2.COLOR_BGR2LAB)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    h, s, v = hsv[..., 0] / 180.0, hsv[..., 1] / 255.0, hsv[..., 2] / 255.0
    chroma = (s > 0.2) & (v > 0.15)
    hs = np.zeros((12, 4), np.float64)
    np.add.at(hs, (np.minimum((h[chroma] * 12).astype(int), 11), np.minimum((s[chroma] * 4).astype(int), 3)), 1)
    vh = np.zeros(4, np.float64)
    np.add.at(vh, np.minimum((v[~chroma] * 4).astype(int), 3), 1)
    hist = np.concatenate([hs.ravel(), vh])
    hist /= max(1.0, hist.sum())
    prof = np.stack([lab[k * H // SEGMENTS:(k + 1) * H // SEGMENTS].reshape(-1, 3).mean(axis=0) for k in range(SEGMENTS)])
    return {"grey": grey, "hist": hist, "prof": prof}


def zn(x: np.ndarray) -> np.ndarray:
    x = x - x.mean()
    sd = x.std()
    return x / sd if sd > 1e-6 else x * 0


def ncc(a: np.ndarray, b: np.ndarray) -> float:
    best = -1.0
    for dy in range(-SHIFT_Y, SHIFT_Y + 1):
        for dx in range(-SHIFT_X, SHIFT_X + 1):
            ya, yb = max(0, dy), max(0, -dy)
            xa, xb = max(0, dx), max(0, -dx)
            hh, ww = H - abs(dy), W - abs(dx)
            pa = zn(a[ya:ya + hh, xa:xa + ww])
            pb = zn(b[yb:yb + hh, xb:xb + ww])
            best = max(best, float((pa * pb).mean()))
    return max(0.0, best)


def compare(da: dict, db: dict) -> dict:
    hist = float(np.sqrt(da["hist"] * db["hist"]).sum())
    de = float(np.linalg.norm(da["prof"] - db["prof"], axis=1).mean())
    return {"ncc": round(ncc(da["grey"], db["grey"]), 4), "hist": round(min(1.0, hist), 4), "prof": round(max(0.0, 1 - de / 50), 4)}


def main() -> None:
    n = 0
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        t0 = time.time()
        try:
            img = cv2.imread(req["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
            if img is None:
                raise ValueError("unreadable image")
            need = {i for pair in req["pairs"] for i in pair}
            desc, valid = {}, {}
            for s in req["spines"]:
                if s["i"] in need:
                    bgr, ok = strip(img, s["polygon"])
                    desc[s["i"]], valid[s["i"]] = describe(bgr), ok
            pairs = [{"a": a, "b": b, **compare(desc[a], desc[b]), "valid": valid[a] and valid[b]} for a, b in req["pairs"]]
            print(json.dumps({"id": req["id"], "pairs": pairs, "seconds": round(time.time() - t0, 3)}), flush=True)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"id": req["id"], "error": type(e).__name__}), flush=True)
        n += 1
        log(f"appearance: {n} photos")


if __name__ == "__main__":
    main()
