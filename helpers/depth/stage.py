"""H-2 depth stage: per-photo geometry (geometry.py) and per-box faces (faces.py), cached and keyed (INV-14).

For each photo in ``--images`` that ``--detect`` has boxes for:

1. **Geometry** (MoGe-2 on MPS) is looked up under ``<cache>/geometry/<model>@<rev>/<key>.npz``. The key is a hash
   of the model id, its Hugging Face revision and weight hash (read from the download's own metadata), the MoGe
   code commit, this folder's geometry code, the long side, the field of view given (or none) and the working
   copy's SHA-256. A miss runs MoGe-2 and writes the ``.npz`` (``points``, ``normal``, ``mask``, ``intrinsics``,
   ``scale``, as geometry.py) and a ``.json`` sidecar holding the key's fields.
2. **Faces** are looked up under ``<cache>/faces/<geometry key>/<key>.json``, keyed by the geometry key, faces.py's
   code and the photo's boxes and bands. A miss runs the face split and writes the rows, the band frames and the
   class map (``<key>.png``, class index per box pixel, 255 elsewhere; CLASSES in faces.py).

The cache holds private photo geometry: ``--cache`` must be under the data root's ``private/``. Another card (S-1:
shelf structure and voids) reuses it by the same keys: the point map and normals per photo, the band frames, and
the per-box face shares.

The field of view: an image line may carry ``fovX`` (degrees across the image's x axis). Otherwise, with
``--exif-fov``, it is read from the working copy's EXIF 35 mm-equivalent focal length, only where the working copy
keeps a full sensor frame (FULL_FRAMES, either orientation); else MoGe estimates it.

stdout: faces.py's rows, one per box, then one line per photo (``photo: true``): the keys, cache hits and seconds
(``decode``, ``infer``, ``save``, ``faces``, ``total``; model load is apart, on the first miss). stderr: progress.
The weights are never downloaded here.

    python -I stage.py --images images.jsonl --detect detect.jsonl --cache DIR [--long 2048] [--exif-fov] [--only ID ...] [--keys]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # -I leaves the script's own folder off the path; geometry.py and faces.py sit beside it

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import faces as F  # noqa: E402
import geometry as G  # noqa: E402

MODEL_ID = "Ruicheng/moge-2-vitl-normal"
MOGE_COMMIT = "b942f00bdc2a2a23ebb474fbe034d487e6dcceec"
#: Working-copy sizes that are a whole sensor frame (48 MP and 12 MP), so EXIF's focal length describes them.
FULL_FRAMES = {(8064, 6048), (4032, 3024)}
FULL_FRAME_DIAGONAL_MM = 43.2666  # the 35 mm format's diagonal: "35 mm equivalent" is defined on it


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def key_of(fields: dict) -> str:
    return hashlib.sha256(json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def weights_pin() -> dict:
    """Revision and weight hash from the Hugging Face download metadata beside the weights."""
    meta = G.WEIGHTS.parent / ".cache" / "huggingface" / "download" / "model.pt.metadata"
    if meta.exists():
        lines = meta.read_text().split()
        return {"revision": lines[0], "weightsSha256": lines[1]}
    return {"revision": None, "weightsSha256": sha256_file(G.WEIGHTS) if G.WEIGHTS.exists() else None}


def exif_fov_x(path: str) -> float | None:
    """Field of view across the image's x axis from EXIF FocalLengthIn35mmFilm, for full-frame working copies only."""
    im = Image.open(path)
    W, H = im.size
    if (max(W, H), min(W, H)) not in FULL_FRAMES:
        return None
    f35 = im.getexif().get_ifd(0x8769).get(0xA405)
    if not f35:
        return None
    width_mm = FULL_FRAME_DIAGONAL_MM * W / math.hypot(W, H)
    return round(math.degrees(2 * math.atan(width_mm / 2 / float(f35))), 2)


class Model:
    """MoGe-2, loaded on the first cache miss only."""

    def __init__(self) -> None:
        self.model = None
        self.device = None
        self.load_seconds = 0.0

    def get(self):
        if self.model is None:
            t = time.time()
            self.model, self.device = G.load_model()
            self.load_seconds = time.time() - t
            print(f"loaded MoGe-2 on {self.device} in {self.load_seconds:.1f}s", file=sys.stderr)
        return self.model, self.device


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="JSON Lines {id, image, fovX?}")
    ap.add_argument("--detect", required=True, help="detect.jsonl: {id, spines, bands} per photo")
    ap.add_argument("--cache", required=True)
    ap.add_argument("--long", type=int, default=2048)
    ap.add_argument("--exif-fov", action="store_true")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--keys", action="store_true", help="print each photo's geometry cache path and exit (no model)")
    args = ap.parse_args()

    cache = Path(args.cache)
    pin = weights_pin()
    code = {"geometry": sha256_file(HERE / "geometry.py")[:16], "faces": sha256_file(HERE / "faces.py")[:16]}
    gdir = cache / "geometry" / f"{MODEL_ID.split('/')[-1]}@{(pin['revision'] or pin['weightsSha256'] or 'unpinned')[:7]}"
    gdir.mkdir(parents=True, exist_ok=True)
    dets = {}
    for line in open(args.detect):
        d = json.loads(line)
        if not d.get("error"):
            dets[d["id"]] = d
    model = Model()

    for line in open(args.images):
        rec = json.loads(line)
        if rec["id"] not in dets or (args.only and rec["id"] not in args.only):
            continue
        t_all, loaded = time.time(), model.load_seconds
        fov = rec.get("fovX")
        if fov is None and args.exif_fov:
            fov = exif_fov_x(rec["image"])
        gfields = {"model": MODEL_ID, **pin, "mogeCommit": MOGE_COMMIT, "code": code["geometry"], "long": args.long,
                   "fovX": fov, "image": sha256_file(Path(rec["image"]))}
        gkey = key_of(gfields)
        gpath = gdir / f"{gkey}.npz"
        if args.keys:
            print(json.dumps({"id": rec["id"], "geometryKey": gkey, "path": str(gpath)}))
            continue
        secs = {"decode": 0.0, "infer": 0.0, "save": 0.0}
        hit_g = gpath.exists()
        if hit_g:
            z = dict(np.load(gpath))
        else:
            t = time.time()
            rgb, s = G.load(rec["image"], args.long)
            secs["decode"] = time.time() - t
            m, device = model.get()
            z, secs["infer"] = G.infer(m, device, rgb, fov)
            z["scale"] = np.float32(s)
            t = time.time()
            tmp = gdir / f"{gkey}.tmp.npz"
            np.savez_compressed(tmp, **z)
            tmp.rename(gpath)
            (gdir / f"{gkey}.json").write_text(json.dumps(gfields, sort_keys=True) + "\n")
            secs["save"] = time.time() - t

        det = dets[rec["id"]]
        boxes = {"spines": [{"polygon": sp["polygon"], "cut": bool(sp.get("cut"))} for sp in det["spines"]],
                 "bands": [{"polygon": b["polygon"]} for b in det.get("bands") or []]}
        fkey = key_of({"geometry": gkey, "code": code["faces"], "boxes": boxes})
        fdir = cache / "faces" / gkey
        fpath = fdir / f"{fkey}.json"
        hit_f = fpath.exists()
        if hit_f:
            out = json.loads(fpath.read_text())
            secs["faces"] = 0.0
        else:
            t = time.time()
            rows, frames, classmap = F.run_photo({"id": rec["id"], **boxes}, z)
            secs["faces"] = time.time() - t
            fdir.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(fdir / f"{fkey}.png"), classmap)
            out = {"rows": rows, "frames": frames, "facesSeconds": round(secs["faces"], 3)}
            tmp = fdir / f"{fkey}.tmp"
            tmp.write_text(json.dumps(out) + "\n")
            tmp.rename(fpath)
        secs["total"] = time.time() - t_all - (model.load_seconds - loaded)  # model load is reported apart
        for row in out["rows"]:
            sys.stdout.write(json.dumps(row) + "\n")
        sys.stdout.write(json.dumps({
            "id": rec["id"], "photo": True, "geometryKey": gkey, "facesKey": fkey, "fovGiven": fov is not None,
            "hit": {"geometry": hit_g, "faces": hit_f}, "seconds": {k: round(v, 3) for k, v in secs.items()},
            "modelLoadSeconds": round(model.load_seconds, 2), "device": str(model.device or "none"),
            "frames": out["frames"],
        }) + "\n")
        sys.stdout.flush()
        print(f"{rec['id'][:8]} geometry {'hit' if hit_g else 'run'} faces {'hit' if hit_f else 'run'} "
              f"{secs['total']:.2f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
