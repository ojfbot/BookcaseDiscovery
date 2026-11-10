"""NS-10 Stage A: MapAnything geometry per capture group of shelf stills, cached and keyed (INV-14).

For each group in ``--groups`` (JSON Lines ``{group, index, views: [{id, image}]}``, written by
``src/eval/ns10-cli.ts prepare``), the group's working copies go through MapAnything (the Apache-2.0 variant,
``facebook/map-anything-apache``) in one forward pass: RGB only, no intrinsics, poses or depth given. Each view comes
back with a camera pose (cam2world, OpenCV axes), intrinsics, a metric point map in the group's common frame and in the
view's own frame, and a confidence map. The teacher is a label generator and never a model input (OC38).

Each working copy is shrunk whole (never cropped) to a 518 px long side, both sides a multiple of 14, so a pixel of the
map is a known box of the working copy: ``scale`` holds (x, y) factors from working copy to map.

The cache is ``<cache>/geometry/map-anything-apache@<rev7>/<group key>/``: one ``<view id[:16]>.npz`` per view (``pts3d``
world, ``pts3d_cam``, ``conf``, ``mask``, ``intrinsics``, ``pose``, ``scale``, ``size``) and a ``group.json`` sidecar
that names what the key covers: the model id, its Hugging Face revision and weight hash (from the download's own
metadata), the MapAnything commit, this file's hash, the long side, the precision, and each view's SHA-256. A re-run is
a cache hit. ``--cache`` must be under the data root's ``private/`` (it holds per-photo geometry).

stdout: one JSON line per group (key, hit, views, seconds, peak resident and MPS memory). stderr: progress. The weights
are never downloaded here; they are read from ``$BOOKCASE_DATA/models/map-anything-apache/``.

    python -I stage.py --groups groups.jsonl --cache DIR [--only INDEX ...] [--long 518] [--keys]
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import resource
import sys
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
WEIGHTS_DIR = DATA / "models" / "map-anything-apache"
MODEL_ID = "facebook/map-anything-apache"
MAPANYTHING_COMMIT = "9d1db2dd728bd8a10e74b15d2eb646e1bf933791"  # v1.1.3, as pyproject.toml pins it
Image.MAX_IMAGE_PIXELS = None
DINOV2_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
DINOV2_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def key_of(fields: dict) -> str:
    return hashlib.sha256(json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def weights_pin() -> dict:
    """Revision and weight hash from the Hugging Face download metadata beside the weights (as helpers/depth does)."""
    meta = WEIGHTS_DIR / ".cache" / "huggingface" / "download" / "model.safetensors.metadata"
    if meta.exists():
        lines = meta.read_text().split()
        return {"revision": lines[0], "weightsSha256": lines[1]}
    w = WEIGHTS_DIR / "model.safetensors"
    return {"revision": None, "weightsSha256": sha256_file(w) if w.exists() else None}


def load_view(path: str, long_side: int) -> tuple[np.ndarray, tuple[float, float], tuple[int, int]]:
    """The working copy shrunk whole to a long side of ``long_side`` px (both sides a multiple of 14), normalised.

    Returns the (3, h, w) array, the (x, y) factors from working copy to map and the map's (h, w).
    """
    im = Image.open(path)
    w0, h0 = im.size
    s = long_side / max(w0, h0)
    w1, h1 = max(14, round(w0 * s / 14) * 14), max(14, round(h0 * s / 14) * 14)
    im.draft("RGB", (w1 * 2, h1 * 2))
    im = im.convert("RGB").resize((w1, h1), Image.LANCZOS)
    x = (np.asarray(im, dtype=np.float32) / 255.0 - DINOV2_MEAN) / DINOV2_STD
    return x.transpose(2, 0, 1), (w1 / w0, h1 / h0), (h1, w1)


def pad_to_common(loaded: list) -> tuple[list[np.ndarray], list[tuple[int, int]], tuple[int, int]]:
    """MapAnything stacks a group's views, so they must share one shape: a mixed portrait and landscape group is padded
    (centred, with the normalisation's zero, i.e. the mean colour) to the largest height and width. Nothing is cropped
    or stretched; ``offset`` is where the view's top-left corner sits on the canvas."""
    H = max(a.shape[1] for a, _, _ in loaded)
    W = max(a.shape[2] for a, _, _ in loaded)
    arrays, offsets = [], []
    for a, _, _ in loaded:
        oy, ox = (H - a.shape[1]) // 2, (W - a.shape[2]) // 2
        # the offset is a multiple of 14 so the padding is whole patches
        oy, ox = oy // 14 * 14, ox // 14 * 14
        c = np.zeros((3, H, W), np.float32)
        c[:, oy:oy + a.shape[1], ox:ox + a.shape[2]] = a
        arrays.append(c)
        offsets.append((ox, oy))
    return arrays, offsets, (H, W)


class PeakMemory:
    """Peak MPS driver memory, sampled in a thread; peak resident memory comes from the OS's own high-water mark."""

    def __init__(self) -> None:
        self.mps = 0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        import torch

        while not self._stop.is_set():
            try:
                self.mps = max(self.mps, torch.mps.driver_allocated_memory())
            except Exception:
                pass
            time.sleep(0.05)

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        self._t.join()

    @staticmethod
    def rss_mb() -> float:
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6  # bytes on macOS


def hub_code_hash() -> str | None:
    """MapAnything builds its DINOv2 encoder from torch hub's copy of the DINOv2 code (code only: the weights come from
    the pinned checkpoint). The hub's ``main`` is unpinned, so the sidecar records the hash of the code that was used."""
    d = Path.home() / ".cache" / "torch" / "hub" / "facebookresearch_dinov2_main"
    if not d.exists():
        return None
    h = hashlib.sha256()
    for f in sorted(d.rglob("*.py")):
        h.update(str(f.relative_to(d)).encode())
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


def load_model():
    import torch
    from mapanything.models import MapAnything

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    return MapAnything.from_pretrained(str(WEIGHTS_DIR)).to(device).eval(), device


def infer(model, device, arrays, amp: bool):
    import torch

    views = [
        {"img": torch.from_numpy(a)[None], "true_shape": np.int32([a.shape[1:]]), "idx": i, "instance": str(i), "data_norm_type": ["dinov2"]}
        for i, a in enumerate(arrays)
    ]
    with torch.inference_mode():
        preds = model.infer(
            views, memory_efficient_inference=True, minibatch_size=1, use_amp=amp, amp_dtype="bf16",
            apply_mask=True, mask_edges=True, apply_confidence_mask=False,
        )
    if device.type == "mps":
        torch.mps.synchronize()
    return preds


def arr(x) -> np.ndarray:
    return x.detach().float().cpu().numpy()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--groups", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--long", type=int, default=518)
    ap.add_argument("--only", nargs="*", type=int, default=None, help="group indices (1-based)")
    ap.add_argument("--no-amp", action="store_true", help="fp32 instead of bf16 autocast")
    ap.add_argument("--keys", action="store_true", help="print each group's cache folder and exit (no model)")
    args = ap.parse_args()

    cache = Path(args.cache)
    pin = weights_pin()
    code = sha256_file(Path(__file__))[:16]
    gdir = cache / "geometry" / f"map-anything-apache@{(pin['revision'] or pin['weightsSha256'] or 'unpinned')[:7]}"
    model = device = None
    load_seconds = 0.0

    for line in open(args.groups):
        g = json.loads(line)
        if args.only and g["index"] not in args.only:
            continue
        views = g["views"]
        fields = {"model": MODEL_ID, **pin, "mapanythingCommit": MAPANYTHING_COMMIT, "code": code, "long": args.long,
                  "amp": not args.no_amp, "views": [sha256_file(Path(v["image"])) for v in views]}
        key = key_of(fields)
        out = gdir / key
        if args.keys:
            print(json.dumps({"group": g["group"], "index": g["index"], "key": key, "path": str(out)}))
            continue
        row = {"group": g["group"], "index": g["index"], "views": len(views), "key": key}
        if (out / "group.json").exists():
            row.update(hit=True, seconds=None, peakRssMb=None, peakMpsMb=None)
            print(json.dumps(row)); sys.stdout.flush()
            print(f"group {g['index']} hit", file=sys.stderr)
            continue
        t = time.time()
        loaded = [load_view(v["image"], args.long) for v in views]
        arrays, offsets, canvas = pad_to_common(loaded)
        decode = time.time() - t
        if model is None:
            t = time.time()
            with contextlib.redirect_stdout(sys.stderr):  # the encoder prints to stdout; stdout carries the rows only
                model, device = load_model()
            load_seconds = time.time() - t
            print(f"loaded MapAnything on {device} in {load_seconds:.1f}s", file=sys.stderr)
        amp = not args.no_amp
        t = time.time()
        with PeakMemory() as mem, contextlib.redirect_stdout(sys.stderr):
            try:
                preds = infer(model, device, arrays, amp)
            except Exception as e:  # bf16 autocast is not everywhere on MPS: fp32 is the fallback, and is logged
                if not amp:
                    raise
                print(f"bf16 failed ({type(e).__name__}: {str(e)[:120]}); retrying in fp32", file=sys.stderr)
                amp = False
                preds = infer(model, device, arrays, False)
        infer_s = time.time() - t
        t = time.time()
        out.mkdir(parents=True, exist_ok=True)
        finite = True
        for v, p, (a, scale, _), off in zip(views, preds, loaded, offsets):
            pose = arr(p["camera_poses"])[0]
            finite &= bool(np.isfinite(pose).all())
            np.savez_compressed(
                out / f"{v['id'][:16]}.npz",
                pts3d=arr(p["pts3d"])[0], pts3d_cam=arr(p["pts3d_cam"])[0], conf=arr(p["conf"])[0],
                mask=arr(p["mask"])[0, ..., 0] > 0.5, intrinsics=arr(p["intrinsics"])[0], pose=pose,
                scale=np.float32(scale), offset=np.int32(off), image=np.int32(a.shape[1:]), size=np.int32(canvas),
            )
        fields["ampUsed"] = amp
        fields["hubCode"] = hub_code_hash()
        (out / "group.json").write_text(json.dumps({**fields, "viewIds": [v["id"] for v in views]}, sort_keys=True) + "\n")
        row.update(hit=False, posesFinite=finite, amp=amp, device=str(device), modelLoadSeconds=round(load_seconds, 2),
                   seconds={"decode": round(decode, 2), "infer": round(infer_s, 2), "save": round(time.time() - t, 2)},
                   peakRssMb=round(mem.rss_mb(), 1), peakMpsMb=round(mem.mps / 1e6, 1))
        print(json.dumps(row)); sys.stdout.flush()
        print(f"group {g['index']} ({len(views)} views) {infer_s:.1f}s rss {row['peakRssMb']} MB mps {row['peakMpsMb']} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
