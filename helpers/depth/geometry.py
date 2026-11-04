"""H-1 monocular geometry per photo: MoGe-2 (ViT-L, normal head) metric point map, depth and normals.

Each working copy is shrunk so its long side is ``--long`` px (never enlarged) and run once through MoGe-2 on
MPS (CPU fallback). The maps come back at that size in OpenCV camera coordinates (x right, y down, z forward,
metres) and are saved, as float16, to ``<out>/<id>.npz``: ``points`` (H, W, 3), ``normal`` (H, W, 3), ``mask``
(H, W) and ``intrinsics`` (3, 3, normalised), plus ``scale``, the working-copy-to-map factor. An image line may carry
``fovX`` (degrees, from EXIF where the working copy keeps the sensor's full frame); MoGe then uses it instead of its
own estimate, unless ``--estimate-fov``. ``--no-save`` writes the JSON line only. The output folder
must be private (it holds per-photo geometry of private photos). One JSON line per photo goes to stdout (id, map
size, field of view, seconds); stderr carries progress only.

Weights are read from $BOOKCASE_DATA/models/moge-2-vitl-normal/ (never downloaded here).

    python -I geometry.py --images images.jsonl --out DIR [--long 2048] [--only ID ...] [--estimate-fov] [--no-save]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
WEIGHTS = DATA / "models" / "moge-2-vitl-normal" / "model.pt"
Image.MAX_IMAGE_PIXELS = None


def load(path: str, long_side: int) -> tuple[np.ndarray, float]:
    im = Image.open(path)
    w0, h0 = im.size
    s = min(1.0, long_side / max(w0, h0))
    if s < 1:
        im.draft("RGB", (int(w0 * s), int(h0 * s)))  # JPEG DCT shrink first, then the exact resize
        im = im.convert("RGB").resize((round(w0 * s), round(h0 * s)), Image.LANCZOS)
    return np.asarray(im.convert("RGB")), s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="JSON Lines {id, image}")
    ap.add_argument("--out", required=True)
    ap.add_argument("--long", type=int, default=2048)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--estimate-fov", action="store_true", help="ignore fovX and let MoGe estimate it")
    ap.add_argument("--no-save", action="store_true")
    args = ap.parse_args()

    from moge.model.v2 import MoGeModel

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    t = time.time()
    model = MoGeModel.from_pretrained(str(WEIGHTS)).to(device).eval()
    print(f"loaded MoGe-2 on {device} in {time.time() - t:.1f}s", file=sys.stderr)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for line in open(args.images):
        rec = json.loads(line)
        if args.only and rec["id"] not in args.only:
            continue
        rgb, s = load(rec["image"], args.long)
        x = torch.tensor(rgb / 255.0, dtype=torch.float32, device=device).permute(2, 0, 1)
        t = time.time()
        with torch.inference_mode():
            fov = None if args.estimate_fov else rec.get("fovX")
            r = model.infer(x, fov_x=fov)
        if device.type == "mps":
            torch.mps.synchronize()
        secs = time.time() - t
        K = r["intrinsics"].cpu().numpy()
        if not args.no_save:
            np.savez_compressed(
                out / f"{rec['id']}.npz",
                points=r["points"].cpu().numpy().astype(np.float16),
                normal=r["normal"].cpu().numpy().astype(np.float16),
                mask=r["mask"].cpu().numpy().astype(bool),
                intrinsics=K.astype(np.float32),
                scale=np.float32(s),
            )
        H, W = rgb.shape[:2]
        fov_x = math.degrees(2 * math.atan(0.5 / float(K[0, 0])))
        fov_y = math.degrees(2 * math.atan(0.5 / float(K[1, 1])))
        print(json.dumps({"id": rec["id"], "width": W, "height": H, "fovX": round(fov_x, 1), "fovY": round(fov_y, 1),
                          "fovGiven": fov is not None, "seconds": round(secs, 2), "device": device.type}), flush=True)
        print(f"{rec['id'][:8]} {W}x{H} {secs:.1f}s fov {fov_x:.0f}x{fov_y:.0f}", file=sys.stderr)


if __name__ == "__main__":
    main()
