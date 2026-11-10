"""F-0i conflict tiles (step 2 of the instance partition): SAM 2.1 base-plus re-segments each conflict group jointly.

helpers/coverage/resolve.py `plan` writes one request per conflict group: the photo, and square windows on the group's
rotated tile, each with an affine (photo -> window pixels), its side and every in-window member's prompts (an
axis-aligned box in the rotated window, positive points on its exclusive core, negative points on its neighbours'
cores). Each window is one joint call: all its members prompted together on one image encode, multimask off. The
window is cut square from the photo by the affine and handed to SAM's processor as it is, so it is resized to
1,024 px without being squashed.

Out, per group, `<cache>/<key>.npz`: `w<k>` = float16 [members in window k, 256, 256], SAM's low-resolution logits
(the 1,024 input's mask grid, which covers the whole square window). One JSON line per group on stdout with its
key, windows, encodes, seconds and the peak MPS memory; a group whose file exists is a cache hit (INV-14). stderr
carries progress only. Weights are read from $BOOKCASE_DATA/models/ (never downloaded here).

    python -I partition.py --groups groups.jsonl --cache DIR > tiles.jsonl
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
import torch
from PIL import Image
from transformers import Sam2Model, Sam2Processor

Image.MAX_IMAGE_PIXELS = None

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
MODELS = DATA / "models"
DEVICE = os.environ.get("F0_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def window_image(img: np.ndarray, affine: list[list[float]], side: int) -> Image.Image:
    """The square window the affine maps the photo onto (outside the photo: black)."""
    w = cv2.warpAffine(img, np.array(affine, np.float64), (side, side), flags=cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    return Image.fromarray(w)


class Tiler:
    def __init__(self) -> None:
        sm = MODELS / "sam2.1-hiera-base-plus"
        self.proc = Sam2Processor.from_pretrained(sm)
        self.sam = Sam2Model.from_pretrained(sm).to(DEVICE).eval()

    @torch.inference_mode()
    def window(self, img: Image.Image, win: dict) -> np.ndarray:
        prompts = {"input_boxes": [win["boxes"]]}
        if any(win["points"]):
            prompts |= {"input_points": [[p or [[0.0, 0.0]] for p in win["points"]]],
                        "input_labels": [[l or [-10] for l in win["labels"]]]}
        inputs = self.proc(images=img, return_tensors="pt", **prompts).to(DEVICE)
        out = self.sam(**inputs, multimask_output=False)
        # pred_masks: [1, objects, 1, 256, 256] logits on the square input's grid
        return out.pred_masks[0, :, 0].float().cpu().numpy().astype(np.float16)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--groups", required=True)
    ap.add_argument("--cache", required=True)
    a = ap.parse_args()
    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    reqs = [json.loads(l) for l in open(a.groups) if l.strip()]
    todo = [r for r in reqs if r["windows"] and not (cache / f"{r['key']}.npz").exists()]
    log(f"partition: {len(reqs)} groups, {len(todo)} to run, device {DEVICE}")
    for r in reqs:
        if r not in todo:
            print(json.dumps({"key": r["key"], "photo": r["photo"], "group": r["group"], "windows": len(r["windows"]),
                              "hit": True}), flush=True)
    if not todo:
        return
    t_load = time.time()
    tiler = Tiler()
    load_s = time.time() - t_load
    cur: tuple[str, np.ndarray] | None = None
    for n, r in enumerate(todo, 1):
        t0 = time.time()
        if cur is None or cur[0] != r["image"]:
            cur = (r["image"], np.asarray(Image.open(r["image"]).convert("RGB")))
        arrays = {}
        try:
            for k, w in enumerate(r["windows"]):
                arrays[f"w{k}"] = tiler.window(window_image(cur[1], w["affine"], int(w["side"])), w)
            if DEVICE == "mps":
                torch.mps.synchronize()
            tmp = cache / f"{r['key']}.tmp.npz"
            np.savez_compressed(tmp, **arrays)
            tmp.rename(cache / f"{r['key']}.npz")
            row = {"key": r["key"], "photo": r["photo"], "group": r["group"], "windows": len(r["windows"]),
                   "members": len(r["members"]), "hit": False, "seconds": round(time.time() - t0, 3)}
        except Exception as e:  # noqa: BLE001 - one bad group must not stop the run; resolve falls back for it
            row = {"key": r["key"], "photo": r["photo"], "group": r["group"], "error": type(e).__name__}
        if DEVICE == "mps":
            row["mpsPeakMb"] = int(torch.mps.driver_allocated_memory() / 2**20)
        row["modelLoadSeconds"] = round(load_s, 2)
        print(json.dumps(row), flush=True)
        if n % 50 == 0:
            log(f"partition: {n}/{len(todo)} groups")


if __name__ == "__main__":
    main()
