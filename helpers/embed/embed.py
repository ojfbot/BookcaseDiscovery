"""MM-1: each box's upright spine strip and two embeddings of it, cached by strip key.

Usage: python -I embed.py --dinov2 MODEL_DIR --siglip2 MODEL_DIR --strips DIR --dinov2-out DIR --siglip2-out DIR
           [--device mps] < requests.jsonl > responses.jsonl
Request (one per photo): {"photo": <ordinal>, "image": <path>, "boxes": [{"key": <strip key>, "polygon": [[x, y] x 4]}]}
Responses: first {"ready": {"device", "loadSeconds", "dims": {"dinov2", "siglip2"}}}, then one line per photo:
  {"photo", "boxes": [{"key", "valid", "size": [w, h], "cached"}], "seconds": {"strip", "dinov2", "siglip2"}}
  or {"photo", "error"}.

The strip is the box's polygon warped to an upright rectangle, long side top to bottom with the top being the short
side nearer the image's top (as F-0g's appearance.py cuts it), at the working copy's own scale capped at LONG px on
the long side. It is written once as PNG and both models read that file, so a re-run embeds the identical strip.
  dinov2  - DINOv2 base: the strip fitted inside a 112 x 448 canvas (8 x 32 patches, aspect kept, padded with the
            ImageNet mean), ImageNet-normalised; the layer-normed CLS token (pooler output).
  siglip2 - SigLIP 2 base NaFlex: the processor's own aspect-preserving resize to at most 256 patches; the image
            tower's pooled output, the space its text tower shares.
Both vectors are L2-normalised float32, written as raw little-endian `<key>.f32`. A box whose strip and both vectors
already exist is not recomputed (`cached`). `valid` is false when under 80 % of the strip lies inside the frame.
stdout carries keys and sizes only; stderr carries progress (photo ordinals, never ids or paths).
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
from transformers import AutoImageProcessor, AutoModel

LONG = 512
CANVAS_W, CANVAS_H = 112, 448
MAX_PATCHES = 256
BATCH = 32
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], np.float32)


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
    w = (np.linalg.norm(src[1] - src[0]) + np.linalg.norm(src[2] - src[3])) / 2
    h = (np.linalg.norm(src[3] - src[0]) + np.linalg.norm(src[2] - src[1])) / 2
    s = min(1.0, LONG / max(h, 1.0))
    W, H = max(4, round(w * s)), max(4, round(h * s))
    dst = np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    # Shrinking a large spine: warp at full size first and area-average down, so it is not point-sampled.
    if s < 1.0:
        W1, H1 = max(4, round(w)), max(4, round(h))
        dst1 = np.array([[0, 0], [W1 - 1, 0], [W1 - 1, H1 - 1], [0, H1 - 1]], dtype=np.float32)
        big = cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst1), (W1, H1), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
        out = cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA)
    else:
        out = cv2.warpPerspective(img, m, (W, H), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
    mask = cv2.warpPerspective(np.full(img.shape[:2], 255, np.uint8), m, (W, H), flags=cv2.INTER_NEAREST, borderValue=0)
    return out, bool((mask > 0).mean() >= 0.8)


def canvas(rgb: np.ndarray) -> np.ndarray:
    """DINOv2 input: the strip fitted inside CANVAS_W x CANVAS_H, centred, padded with the ImageNet mean; CHW."""
    h, w = rgb.shape[:2]
    s = min(CANVAS_W / w, CANVAS_H / h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    r = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC).astype(np.float32) / 255.0
    out = np.tile(IMAGENET_MEAN, (CANVAS_H, CANVAS_W, 1))
    y0, x0 = (CANVAS_H - nh) // 2, (CANVAS_W - nw) // 2
    out[y0:y0 + nh, x0:x0 + nw] = r
    return ((out - IMAGENET_MEAN) / IMAGENET_STD).transpose(2, 0, 1)


def write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


class Embedder:
    def __init__(self, dinov2: str, siglip2: str, device: str):
        self.device = torch.device(device)
        self.dino = AutoModel.from_pretrained(dinov2, dtype=torch.float32).to(self.device).eval()
        self.sig = AutoModel.from_pretrained(siglip2, dtype=torch.float32).to(self.device).eval()
        self.proc = AutoImageProcessor.from_pretrained(siglip2)

    @torch.inference_mode()
    def dinov2(self, rgbs: list[np.ndarray]) -> np.ndarray:
        out = []
        for k in range(0, len(rgbs), BATCH):
            x = torch.from_numpy(np.stack([canvas(r) for r in rgbs[k:k + BATCH]])).to(self.device)
            out.append(self.dino(pixel_values=x).pooler_output.float().cpu().numpy())
        return unit(np.concatenate(out))

    @torch.inference_mode()
    def siglip2(self, rgbs: list[np.ndarray]) -> np.ndarray:
        out = []
        for k in range(0, len(rgbs), BATCH):
            x = self.proc(images=[Image.fromarray(r) for r in rgbs[k:k + BATCH]], max_num_patches=MAX_PATCHES, return_tensors="pt")
            f = self.sig.get_image_features(
                pixel_values=x["pixel_values"].to(self.device),
                pixel_attention_mask=x["pixel_attention_mask"].to(self.device),
                spatial_shapes=x["spatial_shapes"].to(self.device),
            )
            f = f if isinstance(f, torch.Tensor) else f.pooler_output
            out.append(f.float().cpu().numpy())
        return unit(np.concatenate(out))


def unit(x: np.ndarray) -> np.ndarray:
    return (x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-12)).astype("<f4")


def sync(device: torch.device) -> None:
    if device.type == "mps":
        torch.mps.synchronize()


def main() -> None:
    ap = argparse.ArgumentParser()
    for a in ("--dinov2", "--siglip2", "--strips", "--dinov2-out", "--siglip2-out"):
        ap.add_argument(a, required=True)
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    args = ap.parse_args()
    strips, dout, sout = Path(args.strips), Path(args.dinov2_out), Path(args.siglip2_out)
    for d in (strips, dout, sout):
        d.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    emb = Embedder(args.dinov2, args.siglip2, args.device)
    probe = np.full((96, 16, 3), 128, np.uint8)
    dims = {"dinov2": int(emb.dinov2([probe]).shape[1]), "siglip2": int(emb.siglip2([probe]).shape[1])}
    print(json.dumps({"ready": {"device": args.device, "loadSeconds": round(time.time() - t0, 2), "dims": dims}}), flush=True)

    for n, line in enumerate(sys.stdin):
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            secs = {"strip": 0.0, "dinov2": 0.0, "siglip2": 0.0}
            rows, todo = [], []
            img = None
            t = time.time()
            for b in req["boxes"]:
                key = b["key"]
                sp, dp, gp = strips / f"{key}.png", dout / f"{key}.f32", sout / f"{key}.f32"
                if sp.exists():
                    rgb = cv2.cvtColor(cv2.imread(str(sp), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
                    meta = json.loads((strips / f"{key}.json").read_text())
                    valid = bool(meta["valid"])
                else:
                    if img is None:
                        img = cv2.imread(req["image"], cv2.IMREAD_COLOR)
                        if img is None:
                            raise RuntimeError("image unreadable")
                    bgr, valid = strip(img, b["polygon"])
                    ok, png = cv2.imencode(".png", bgr)
                    if not ok:
                        raise RuntimeError("strip encode failed")
                    write_atomic(sp, png.tobytes())
                    write_atomic(strips / f"{key}.json", json.dumps({"valid": valid}).encode())
                    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                cached = dp.exists() and gp.exists()
                rows.append({"key": key, "valid": valid, "size": [int(rgb.shape[1]), int(rgb.shape[0])], "cached": cached})
                if not cached:
                    todo.append((rgb, dp, gp))
            secs["strip"] = time.time() - t
            if todo:
                t = time.time()
                d = emb.dinov2([r for r, _, _ in todo])
                sync(emb.device)
                secs["dinov2"] = time.time() - t
                t = time.time()
                s = emb.siglip2([r for r, _, _ in todo])
                sync(emb.device)
                secs["siglip2"] = time.time() - t
                for (_, dp, gp), dv, sv in zip(todo, d, s):
                    write_atomic(dp, dv.tobytes())
                    write_atomic(gp, sv.tobytes())
            print(json.dumps({"photo": req["photo"], "boxes": rows, "seconds": {k: round(v, 3) for k, v in secs.items()}}), flush=True)
            log(f"photo {n + 1}: {len(rows)} boxes, {len(todo)} embedded")
        except Exception as e:  # one photo's failure is recorded, not fatal
            print(json.dumps({"photo": req.get("photo"), "error": type(e).__name__}), flush=True)
            log(f"photo {n + 1}: {type(e).__name__}")


if __name__ == "__main__":
    main()
