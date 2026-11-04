"""S-1 prior art: off-the-shelf "shelf" segmenters against S-1's own planes (evals/S1/report.md, Part 5).

Two models, each at its processor's default size, on every photo of a set:

- **OneFormer Swin-L, ADE20K** (``shi-labs/oneformer_ade20k_swin_large``, MIT tag), semantic task; classes ``shelf``
  (24) and ``bookcase`` (62);
- **SAM 3** (local weights), prompted ``shelf``; instances above ``SAM3_SCORE`` merged into one mask.

Each mask is resized to the depth stage's map and compared, per photo, with shelf.py's label map (lip and board-top
inliers), the kept books' outlines (or boxes) and the boxes S-1's ``on-lip`` and F-0f's rules flag. stdout: one line
of counts per photo and model (no pixels). Runs in ``helpers/label``'s venv (transformers). Weights are read from the
data root's ``models/``; nothing is downloaded here.

    python -I segment.py --inputs inputs.jsonl --maps DIR --flags flags.jsonl --images images.jsonl [--models oneformer sam3]
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

MODELS = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery")) / "models"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
ADE = {"shelf": 24, "bookcase": 62}
SAM3_SCORE = 0.3
LABELS = {"board": 1, "lip": 2}
BOX_INSIDE = 0.5


class OneFormer:
    def __init__(self) -> None:
        from transformers import OneFormerForUniversalSegmentation, OneFormerProcessor

        path = MODELS / "oneformer_ade20k_swin_large"
        self.proc = OneFormerProcessor.from_pretrained(path)
        self.model = OneFormerForUniversalSegmentation.from_pretrained(path).float().to(DEVICE).eval()  # MPS has no float64

    @torch.inference_mode()
    def masks(self, im: Image.Image) -> dict[str, np.ndarray]:
        inputs = self.proc(images=im, task_inputs=["semantic"], return_tensors="pt").to(DEVICE)
        out = self.model(**inputs)
        seg = self.proc.post_process_semantic_segmentation(out, target_sizes=[im.size[::-1]])[0].cpu().numpy()
        m = {k: seg == v for k, v in ADE.items()}
        m["shelf+bookcase"] = m["shelf"] | m["bookcase"]
        return m


class Sam3:
    def __init__(self) -> None:
        from transformers import Sam3Model, Sam3Processor

        path = MODELS / "sam3"
        self.proc = Sam3Processor.from_pretrained(path)
        self.model = Sam3Model.from_pretrained(path).to(DEVICE).eval()

    @torch.inference_mode()
    def masks(self, im: Image.Image) -> dict[str, np.ndarray]:
        inputs = self.proc(images=im, text="shelf", return_tensors="pt").to(DEVICE)
        out = self.model(**inputs)
        res = self.proc.post_process_instance_segmentation(
            out, threshold=SAM3_SCORE, mask_threshold=0.5, target_sizes=inputs["original_sizes"].tolist())[0]
        m = np.zeros(im.size[::-1], bool)
        for k in res["masks"].cpu().numpy():
            m |= k.astype(bool)
        return {"shelf": m}


def poly_mask(polys: list, scale: float, H: int, W: int) -> np.ndarray:
    m = np.zeros((H, W), np.uint8)
    for p in polys:
        cv2.fillPoly(m, [np.round(np.float64(p) * scale).astype(np.int32)], 1)
    return m.astype(bool)


def box_inside(poly, mask: np.ndarray, scale: float) -> bool | None:
    H, W = mask.shape
    m = poly_mask([poly], scale, H, W)
    n = int(m.sum())
    return None if n == 0 else bool(mask[m].mean() >= BOX_INSIDE)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--maps", required=True)
    ap.add_argument("--flags", required=True)
    ap.add_argument("--images", required=True)
    ap.add_argument("--models", nargs="*", default=["oneformer", "sam3"])
    args = ap.parse_args()
    images = {json.loads(l)["id"]: json.loads(l)["image"] for l in open(args.images)}
    flags = {json.loads(l)["id"]: json.loads(l) for l in open(args.flags)}
    recs = [json.loads(l) for l in open(args.inputs)]
    for name in args.models:
        t = time.time()
        model = OneFormer() if name == "oneformer" else Sam3()
        print(f"{name}: loaded in {time.time() - t:.1f}s on {DEVICE}", file=sys.stderr)
        for rec in recs:
            pid = rec["id"]
            labels = cv2.imread(str(Path(args.maps) / f"{pid}.png"), cv2.IMREAD_UNCHANGED)
            H, W = labels.shape
            scale = W / rec["width"]
            im = Image.open(images[pid]).convert("RGB")
            im = im.resize((W, H))  # the depth stage's map size (2048 px long side)
            t = time.time()
            masks = model.masks(im)
            if DEVICE == "mps":
                torch.mps.synchronize()
            secs = time.time() - t
            books = poly_mask([rec["outlines"].get(str(i)) or s["polygon"] for i, s in enumerate(rec["spines"]) if s["kept"]], scale, H, W)
            fl = flags.get(pid, {})
            row = {"id": pid, "model": name, "seconds": round(secs, 3), "classes": {}}
            for cls, m in masks.items():
                m = cv2.resize(m.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST).astype(bool)
                c = {"maskPx": int(m.sum()), "bookPx": int(books.sum()), "bookInMask": int((books & m).sum())}
                for k, v in LABELS.items():
                    sel = labels == v
                    c[f"{k}Px"], c[f"{k}InMask"] = int(sel.sum()), int((sel & m).sum())
                for key, ref in (("onLip", "spines"), ("f0f", "spines"), ("onLipCovers", "covers")):
                    inside = [box_inside(rec[ref][i]["polygon"], m, scale) for i in fl.get(key, [])]
                    c[key] = [sum(1 for x in inside if x), sum(1 for x in inside if x is not None)]
                row["classes"][cls] = c
            sys.stdout.write(json.dumps(row) + "\n")
            sys.stdout.flush()
            print(f"{name} {pid[:8]} {secs:.2f}s", file=sys.stderr)
        del model
        if DEVICE == "mps":
            torch.mps.empty_cache()


if __name__ == "__main__":
    main()
