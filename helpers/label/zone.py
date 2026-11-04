"""F-0j zoning, the measuring half (evals/F0j/report.md, pre-registration; docs/models/per-book-extraction.md §5):
for each book region, PP-OCRv5's server DB detector at native resolution finds the text lines; each line is mapped
back to working-copy pixels, measured, checked against F-0i's label map for pixels another book owns, and cut from the
working copy as a 48 px line cell into a lossless per-photo mosaic for the readers. Roles, groups and every threshold
are src/perceive/zones.ts's (pure); this helper only measures.

Usage: zone.py --out <dir> < requests.jsonl > regions.jsonl
Request (one per photo): {"photo", "image", "labels" (F-0i label map or null), "regions": [{"id", "index", "polygon"}]}.
Response: one line per region {"id", "frame", "lines", "noise", "contrast", "profile", "seconds"} and one per mosaic
page {"page", "photo", "path", "width", "height"}. stderr carries progress only. Weights from $BOOKCASE_DATA/models/.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
MODELS = DATA / "models"
LINE_H = 48  # the line's height in a cell (PP-OCR's recogniser input height)
MARGIN = 8  # cell px of the photo's own pixels around the line
MIN_SHORT, MIN_AREA = 4, 64  # a quad below either is detector noise
COLUMN = 1.5  # y extent over x extent in the reading frame (F-R2)
END = 0.15  # outer share of the spine's length (imprint, imprint-logo)
PAGE_CELLS, PAGE_MAX_H, CELL_MAX_W = 200, 14000, 4000


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def order_corners(pts: np.ndarray) -> np.ndarray:  # as read.py: clockwise from the corner nearest the top-left
    c = pts.mean(axis=0)
    cw = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    return np.roll(cw, -int(np.argmin(cw[:, 0] + cw[:, 1])), axis=0)


class Frame:
    """The reading frame of one region: the polygon warped upright at native resolution (as read.py cuts it, no cap),
    turned 90° clockwise when it stands upright, so the spine's long axis runs along x."""

    def __init__(self, polygon: list[list[float]]):
        p = order_corners(np.array(polygon, dtype=np.float32))
        w = max(2, int(round(max(np.linalg.norm(p[1] - p[0]), np.linalg.norm(p[2] - p[3])))))
        h = max(2, int(round(max(np.linalg.norm(p[3] - p[0]), np.linalg.norm(p[2] - p[1])))))
        dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
        self.m = cv2.getPerspectiveTransform(p, dst)
        self.inv = np.linalg.inv(self.m)
        self.w, self.h = w, h
        self.rot = 90 if h >= w else 0
        self.W, self.H = (h, w) if self.rot == 90 else (w, h)

    def image(self, img: np.ndarray) -> np.ndarray:
        out = cv2.warpPerspective(img, self.m, (self.w, self.h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        return cv2.rotate(out, cv2.ROTATE_90_CLOCKWISE) if self.rot == 90 else out

    def to_photo(self, pts: np.ndarray) -> np.ndarray:
        """Reading-frame points -> working-copy pixels."""
        pts = np.asarray(pts, dtype=np.float64)
        if self.rot == 90:  # rotated (xr, yr) <- upright (x, y) = (yr, h - 1 - xr)
            pts = np.stack([pts[:, 1], self.h - 1 - pts[:, 0]], 1)
        hom = np.concatenate([pts, np.ones((len(pts), 1))], 1) @ self.inv.T
        return hom[:, :2] / hom[:, 2:3]


def contrast(img: np.ndarray) -> float:
    """F-R2's lettering contrast: distance between the two Otsu class means of the grey levels at a 64 px short side."""
    s = 64 / max(1, min(img.shape[:2]))
    small = cv2.resize(img, (max(2, int(img.shape[1] * s)), max(2, int(img.shape[0] * s))), interpolation=cv2.INTER_AREA)
    g = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    a, b = g[th > 0].astype(np.float32), g[th == 0].astype(np.float32)
    return round(float(abs(a.mean() - b.mean())), 1) if a.size and b.size else 0.0


def profile(img: np.ndarray, quads: list[np.ndarray], line_h: float) -> dict:
    """Edge density outside the text: the two ends (outer 15 % of the length) and windows along the spine
    (side = the region's height, step half of it). Thresholds are zones.ts's."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    med = float(np.median(g))
    edges = cv2.Canny(g, 0.66 * med, 1.33 * med) > 0
    mask = np.zeros(g.shape, np.uint8)
    for q in quads:
        cv2.fillPoly(mask, [np.round(q).astype(np.int32)], 1)
    k = max(1, int(round(line_h)))
    if quads:
        mask = cv2.dilate(mask, np.ones((2 * k + 1, 2 * k + 1), np.uint8))
    free = mask == 0
    H, W = g.shape

    def density(x0: int, x1: int) -> tuple[float | None, float]:
        f = free[:, x0:x1]
        n = int(f.sum())
        masked = 1 - n / max(1, f.size)
        return (round(float((edges[:, x0:x1] & f).sum() / n), 4) if n >= 0.1 * f.size and n > 0 else None), round(masked, 4)

    e = max(1, int(round(END * W)))
    ends = [density(0, e)[0], density(W - e, W)[0]]
    side, step = max(1, H), max(1, H // 2)
    windows = []
    for x0 in range(0, max(1, W - side + 1), step):
        d, m = density(x0, min(W, x0 + side))
        windows.append([d, m])
    return {"ends": ends, "windows": windows, "window": side, "step": step}


def cell(img: np.ndarray, frame: Frame, rect: tuple, column: bool, height: float) -> tuple[np.ndarray, float]:
    """One line cut from the working copy, its long axis horizontal (+x of the reading frame for a line along the
    spine, +y for a column line), scaled so the line is LINE_H px high, with MARGIN px of photo around it."""
    (cx, cy), (rw, rh), ang = rect
    t = np.deg2rad(ang)
    a = np.array([np.cos(t), np.sin(t)])  # the rectangle's first side
    b = np.array([-np.sin(t), np.cos(t)])
    u, L = (a, rw) if rw >= rh else (b, rh)
    main, other = (1, 0) if column else (0, 1)
    if u[main] < -1e-9 or (abs(u[main]) <= 1e-9 and u[other] < 0):
        u = -u
    v = np.array([-u[1], u[0]])
    scale = LINE_H / max(1.0, height)
    if (L + 2 * MARGIN / scale) * scale > CELL_MAX_W:
        scale = CELL_MAX_W / (L + 2 * MARGIN / scale)
    m = MARGIN / scale
    c = np.array([cx, cy])
    ha, hb = L / 2 + m, height / 2 + m
    corners_r = np.array([c - ha * u - hb * v, c + ha * u - hb * v, c + ha * u + hb * v, c - ha * u + hb * v])
    corners = frame.to_photo(corners_r).astype(np.float32)
    wn, hn = max(2, int(round(2 * ha))), max(2, int(round(2 * hb)))
    dst = np.array([[0, 0], [wn - 1, 0], [wn - 1, hn - 1], [0, hn - 1]], dtype=np.float32)
    native = cv2.warpPerspective(img, cv2.getPerspectiveTransform(corners, dst), (wn, hn), flags=cv2.INTER_CUBIC,
                                 borderMode=cv2.BORDER_REPLICATE)
    size = (max(2, int(round(wn * scale))), max(2, int(round(hn * scale))))
    out = cv2.resize(native, size, interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
    return out, scale


def owned_share(labels: np.ndarray | None, quad: np.ndarray, own: int) -> float:
    """Share of a line quad's pixels another kept box owns in F-0i's label map (value = box index + 1)."""
    if labels is None:
        return 0.0
    H, W = labels.shape
    q = np.round(quad).astype(np.int32)
    x0, y0 = max(0, q[:, 0].min()), max(0, q[:, 1].min())
    x1, y1 = min(W, q[:, 0].max() + 1), min(H, q[:, 1].max() + 1)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    m = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(m, [q - [x0, y0]], 1)
    sub = labels[y0:y1, x0:x1][m > 0]
    if sub.size == 0:
        return 0.0
    return round(float(((sub != 0) & (sub != own)).sum() / sub.size), 4)


class Pages:
    """Lossless mosaics of line cells, one or more pages a photo; each cell's rectangle is what a reader cuts."""

    def __init__(self, out: Path, photo: str):
        self.out, self.photo, self.n = out, photo, 0
        self.cells: list[np.ndarray] = []
        self.done: list[dict] = []

    def add(self, c: np.ndarray) -> dict:
        h = sum(x.shape[0] + 8 for x in self.cells)
        if len(self.cells) >= PAGE_CELLS or h + c.shape[0] > PAGE_MAX_H:
            self.flush()
            h = 0
        self.cells.append(c)
        return {"page": f"{self.photo}~p{self.n}", "cell": len(self.cells) - 1, "rect": [0, h, c.shape[1], c.shape[0]]}

    def flush(self) -> None:
        if not self.cells:
            return
        W = max(x.shape[1] for x in self.cells)
        H = sum(x.shape[0] + 8 for x in self.cells)
        page = np.full((H, W, 3), 127, np.uint8)
        y = 0
        for x in self.cells:
            page[y:y + x.shape[0], : x.shape[1]] = x
            y += x.shape[0] + 8
        name = f"{self.photo}~p{self.n}"
        path = self.out / f"{name}.png"
        cv2.imwrite(str(path), page)
        self.done.append({"page": name, "photo": self.photo, "path": str(path), "width": W, "height": H})
        self.cells, self.n = [], self.n + 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import TextDetection

    det = TextDetection(model_name="PP-OCRv5_server_det", model_dir=str(MODELS / "pp-ocrv5" / "server_det"), device="cpu")
    log("zone: detector loaded")
    n = 0
    for raw in sys.stdin:
        if not raw.strip():
            continue
        req = json.loads(raw)
        img = cv2.imread(req["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        labels = cv2.imread(req["labels"], cv2.IMREAD_UNCHANGED) if req.get("labels") else None
        pages = Pages(out, req["photo"])
        for reg in req["regions"]:
            t0 = time.time()
            try:
                fr = Frame(reg["polygon"])
                view = fr.image(img)
                res = list(det.predict(view))
                polys = res[0]["dt_polys"] if res else []
                lines, quads, noise = [], [], 0
                for q in polys:
                    q = np.asarray(q, dtype=np.float32)
                    rect = cv2.minAreaRect(q)
                    rw, rh = rect[1]
                    if min(rw, rh) < MIN_SHORT or rw * rh < MIN_AREA:
                        noise += 1
                        continue
                    xs, ys = q[:, 0], q[:, 1]
                    column = bool((ys.max() - ys.min()) > COLUMN * (xs.max() - xs.min()))
                    photo_q = fr.to_photo(q)
                    height = float(min(cv2.minAreaRect(photo_q.astype(np.float32))[1]))
                    c, scale = cell(img, fr, rect, column, height)
                    where = pages.add(c)
                    quads.append(q)
                    lines.append({
                        "k": len(lines),
                        "quad": [[round(float(x), 1), round(float(y), 1)] for x, y in photo_q],
                        "x0": round(float(xs.min()), 1), "x1": round(float(xs.max()), 1),
                        "y0": round(float(ys.min()), 1), "y1": round(float(ys.max()), 1),
                        "h": round(height, 1), "len": round(float(max(rw, rh)), 1), "angle": round(float(rect[2]), 1),
                        "column": column, "neighbour": owned_share(labels, photo_q, reg["index"] + 1),
                        "scale": round(scale, 4), **where,
                    })
                line_h = float(np.median([min(cv2.minAreaRect(q)[1]) for q in quads])) if quads else 0.0
                print(json.dumps({"id": reg["id"], "frame": {"W": fr.W, "H": fr.H, "rot": fr.rot}, "lines": lines,
                                  "noise": noise, "contrast": contrast(view), "profile": profile(view, quads, line_h),
                                  "seconds": round(time.time() - t0, 3)}), flush=True)
            except Exception as e:  # noqa: BLE001 - one bad region must not stop the run
                print(json.dumps({"id": reg["id"], "error": type(e).__name__, "seconds": round(time.time() - t0, 3)}),
                      flush=True)
            n += 1
            if n % 200 == 0:
                log(f"zone: {n} regions")
        pages.flush()
        for p in pages.done:
            print(json.dumps(p), flush=True)
        print(json.dumps({"photoDone": req["photo"]}), flush=True)


if __name__ == "__main__":
    main()
