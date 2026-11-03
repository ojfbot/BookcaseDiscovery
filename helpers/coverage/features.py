"""Q-1 per-spine capture-quality features.

Reads a detect.jsonl (F-0's shape: one image per line, ``spines[].polygon`` in working-copy pixels, optional
``bands``) and an image list (``{"id", "image"}`` per line), and writes one JSON line per detected spine to stdout:
geometry, sharpness, exposure, colour, position in the photo and in its shelf band. Pixels are read as stored
(EXIF orientation ignored), the working-copy frame. stderr carries progress only.

    python -I features.py --detect detect.jsonl --images images.jsonl > features.jsonl
"""

from __future__ import annotations

import argparse
import json
import math
import sys

import cv2
import numpy as np

NORM_SHORT = 32  # short side, px, of the resampled crop used for scale-free sharpness and edge density
HIGHLIGHT = 250  # grey level counted as clipped highlight
SHADOW = 5  # grey level counted as crushed shadow


def side_lengths(poly: np.ndarray) -> tuple[float, float, bool]:
    """(short, long, edges01_long): mean lengths of the two pairs of opposite sides of a 4-point polygon."""
    d = [float(np.linalg.norm(poly[(i + 1) % 4] - poly[i])) for i in range(4)]
    a = (d[0] + d[2]) / 2  # edges 0-1 and 2-3
    b = (d[1] + d[3]) / 2  # edges 1-2 and 3-0
    return (min(a, b), max(a, b), a >= b)


def long_axis_deg(poly: np.ndarray, edges01_long: bool) -> float:
    """Angle of the long axis from image vertical, degrees in (-90, 90]: 0 upright, +-90 lying flat."""
    if edges01_long:
        v = ((poly[1] - poly[0]) + (poly[2] - poly[3])) / 2
    else:
        v = ((poly[2] - poly[1]) + (poly[3] - poly[0])) / 2
    deg = math.degrees(math.atan2(float(v[0]), float(v[1])))
    while deg > 90:
        deg -= 180
    while deg <= -90:
        deg += 180
    return deg


def upright_crop(img: np.ndarray, poly: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Perspective crop with the long axis vertical, and a mask of crop pixels that came from inside the image."""
    short, long_, edges01_long = side_lengths(poly)
    w, h = max(2, int(round(short))), max(2, int(round(long_)))
    if edges01_long:
        dst = np.float32([[0, 0], [0, h - 1], [w - 1, h - 1], [w - 1, 0]])
    else:
        dst = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    m = cv2.getPerspectiveTransform(poly.astype(np.float32), dst)
    crop = cv2.warpPerspective(img, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    ones = np.full(img.shape[:2], 255, np.uint8)
    valid = cv2.warpPerspective(ones, m, (w, h), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT) > 0
    return crop, valid


def laplacian_var(grey: np.ndarray, valid: np.ndarray) -> float | None:
    """Variance of the 3x3 Laplacian over pixels whose whole neighbourhood is inside the image."""
    inner = cv2.erode(valid.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    inner[0, :] = inner[-1, :] = False
    inner[:, 0] = inner[:, -1] = False
    if inner.sum() < 16:
        return None
    lap = cv2.Laplacian(grey.astype(np.float64), cv2.CV_64F, ksize=1)
    return float(lap[inner].var())


def resample_short(img: np.ndarray, short: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = short / min(h, w)
    size = (max(2, int(round(w * s))), max(2, int(round(h * s))))
    return cv2.resize(img, size, interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)


def band_position(c: np.ndarray, bands: list[dict]) -> dict:
    """Which machine shelf band holds the centroid, and where along (0..1 end to end) and across it the spine sits."""
    best, best_d = -1, -math.inf
    for i, b in enumerate(bands):
        d = cv2.pointPolygonTest(np.float32(b["polygon"]), (float(c[0]), float(c[1])), True)
        if d >= 0 and d > best_d:
            best, best_d = i, d
    if best < 0:
        return {"band": None, "bandAlong": None, "bandAcross": None, "bandEnd": None, "bandSpines": None}
    q = np.float64(bands[best]["polygon"])
    short, long_, edges01_long = side_lengths(q)
    # Long axis runs between the midpoints of the two short sides.
    if edges01_long:
        a, z = (q[0] + q[3]) / 2, (q[1] + q[2]) / 2
        p, r = (q[0] + q[1]) / 2, (q[3] + q[2]) / 2
    else:
        a, z = (q[0] + q[1]) / 2, (q[3] + q[2]) / 2
        p, r = (q[0] + q[3]) / 2, (q[1] + q[2]) / 2
    ax, cx = z - a, r - p
    along = float(np.dot(c - a, ax) / max(np.dot(ax, ax), 1e-9))
    across = float(np.dot(c - p, cx) / max(np.dot(cx, cx), 1e-9))
    along, across = min(1.0, max(0.0, along)), min(1.0, max(0.0, across))
    return {
        "band": best,
        "bandAlong": round(along, 4),
        "bandAcross": round(across, 4),
        "bandEnd": round(min(along, 1 - along), 4),
        "bandSpines": bands[best].get("spines"),
    }


def spine_features(img: np.ndarray, polygon: list[list[float]], bands: list[dict] | None = None) -> dict:
    """Every Q-1 pixel and geometry feature for one 4-point polygon on a BGR image."""
    H, W = img.shape[:2]
    poly = np.float64(polygon)
    short, long_, edges01_long = side_lengths(poly)
    deg = long_axis_deg(poly, edges01_long)
    c = poly.mean(axis=0)
    nx, ny = float(c[0] / W), float(c[1] / H)
    # Radial distance from the centre, 1.0 at a corner (ultra-wide distortion grows with it).
    radial = math.hypot(nx - 0.5, ny - 0.5) / math.hypot(0.5, 0.5)
    crop, valid = upright_crop(img, poly)
    out_frac = 1.0 - float(valid.mean())
    f: dict = {
        "shortPx": round(short, 1),
        "longPx": round(long_, 1),
        "aspect": round(long_ / max(short, 1e-6), 3),
        "longAxisDeg": round(deg, 2),
        "lying": abs(deg) > 45,
        # Off the nearest image axis: 0 for an upright or flat spine, 45 for a diagonal one.
        "offAxisDeg": round(min(abs(deg), abs(90 - abs(deg))), 2),
        "cx": round(nx, 4),
        "cy": round(ny, 4),
        "radial": round(radial, 4),
        "edgeDist": round(min(nx, 1 - nx, ny, 1 - ny), 4),
        "outFrac": round(out_frac, 4),
    }
    if valid.sum() < 16:
        return f | band_position(c, bands or [])
    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    g = grey[valid].astype(np.float64)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)[valid].astype(np.float64)
    hue = hsv[:, 0] * (2 * math.pi / 180)
    sat = hsv[:, 1] / 255
    p5, p95 = np.percentile(g, [5, 95])
    small = resample_short(crop, NORM_SHORT)
    small_valid = resample_short(valid.astype(np.uint8) * 255, NORM_SHORT) > 127
    small_grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(small_grey, 50, 150) > 0
    lv = laplacian_var(grey, valid)
    lvn = laplacian_var(small_grey, small_valid)
    # Laplacian energy at native scale over that at half scale. Detail alone raises both; defocus removes
    # the native-scale part first, so a low ratio points at blur rather than at a plain spine.
    hh, hw = max(2, grey.shape[0] // 2), max(2, grey.shape[1] // 2)
    lvh = laplacian_var(cv2.resize(grey, (hw, hh), interpolation=cv2.INTER_AREA),
                        cv2.resize(valid.astype(np.uint8) * 255, (hw, hh), interpolation=cv2.INTER_AREA) > 127)
    f |= {
        "lapVar": None if lv is None else round(lv, 2),
        "lapVarNorm": None if lvn is None else round(lvn, 2),
        "blurRatio": None if lv is None or not lvh else round(lv / lvh, 4),
        "edgeDensity": round(float(edges[small_valid].mean()) if small_valid.any() else 0.0, 4),
        "mean": round(float(g.mean()), 2),
        "rmsContrast": round(float(g.std()), 2),
        "p95p5": round(float(p95 - p5), 2),
        "highlightFrac": round(float((g >= HIGHLIGHT).mean()), 4),
        "shadowFrac": round(float((g <= SHADOW).mean()), 4),
        "saturation": round(float(sat.mean()), 4),
        # Saturation-weighted circular mean hue in degrees (0-360); None when the spine is near grey.
        "hueDeg": (
            round(math.degrees(math.atan2(float((sat * np.sin(hue)).sum()), float((sat * np.cos(hue)).sum()))) % 360, 1)
            if sat.mean() > 0.08
            else None
        ),
        "value": round(float(hsv[:, 2].mean() / 255), 4),
    }
    return f | band_position(c, bands or [])


def image_features(img: np.ndarray) -> dict:
    H, W = img.shape[:2]
    grey = cv2.cvtColor(resample_short(img, min(1500, min(H, W))), cv2.COLOR_BGR2GRAY)
    lv = laplacian_var(grey, np.ones(grey.shape, bool))
    return {"width": W, "height": H, "megapixels": round(W * H / 1e6, 2), "imgLapVar": lv and round(lv, 2),
            "imgMean": round(float(grey.mean()), 2)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--detect", required=True)
    ap.add_argument("--images", required=True)
    args = ap.parse_args()
    paths = {}
    with open(args.images) as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                paths[r["id"]] = r["image"]
    with open(args.detect) as fh:
        dets = [json.loads(l) for l in fh if l.strip()]
    for n, det in enumerate(dets, 1):
        img = cv2.imread(paths[det["id"]], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is None:
            raise SystemExit(f"could not decode image {n}")
        if (img.shape[1], img.shape[0]) != (det["width"], det["height"]):
            raise SystemExit(f"image {n}: decoded size differs from the detect record")
        im = image_features(img)
        bands = det.get("bands") or []
        for i, s in enumerate(det["spines"]):
            row = {"id": f"{det['id']}:{i}", "imageId": det["id"], "boxScore": s.get("boxScore"),
                   "maskScore": s.get("maskScore"), "cut": s.get("cut"), "bandCount": len(bands)}
            row |= spine_features(img, s["polygon"], bands)
            row |= {"image": im}
            sys.stdout.write(json.dumps(row) + "\n")
        print(f"features: image {n}/{len(dets)}, {len(det['spines'])} spines", file=sys.stderr)


if __name__ == "__main__":
    main()
