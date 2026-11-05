"""TS-2 student reader (evals/TS2/prereg.md): Qwen3-VL-4B 8-bit plus the TS-2 LoRA adapter, F-0's spine prompt, greedy,
with optional catalog steering (steer.py). Also cuts the training crops, so train and eval crops are cut alike.

Usage:
  read_student.py read --adapter <dir> [--free] < requests.jsonl > responses.jsonl
  read_student.py crops --out <dir> < requests.jsonl          # writes <dir>/images/*.png and <dir>/train.jsonl

read request:  {"id", "image", "polygon", "rotations", "candidates": [target, ...]}
read response: {"id", "reader", "variants": [{"rotation", "text", "confidence"}], "steered": [bool], "seconds"}
crops request: {"image", "polygon", "rotation", "target"}
The crop is read.py's (helpers/label): the polygon perspective-corrected to an upright rectangle, long side at most
1,600 px, turned clockwise by the rotation. stderr carries progress only, never text. Weights are read from the data
root's models/ and the adapter from its private/models/ts2/.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import cv2
import numpy as np

# Run with `python -I` (no script directory on the path), so both folders are added explicitly.
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(1, str(Path(__file__).resolve().parent.parent / "label"))
from read import QWEN_PROMPT, crop  # noqa: E402  (F-0's own crop and prompt, unchanged)

from steer import Steer  # noqa: E402

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
BASE = DATA / "models" / "qwen3-vl-4b-8bit"
NAME = "ts2-student"
MAX_TOKENS = 48
BIAS = 2.0


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def prepare(img: np.ndarray):
    """As read.py's Qwen reader: the vision tower needs a few 28-px patches on the short side. Returns a PIL image."""
    from PIL import Image

    h, w = img.shape[:2]
    if min(h, w) < 56:
        s = 56 / min(h, w)
        img = cv2.resize(img, (int(w * s) + 1, int(h * s) + 1), interpolation=cv2.INTER_CUBIC)
    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))


def load_image(path: str) -> np.ndarray:
    return cv2.imread(path, cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)


class Student:
    def __init__(self, adapter: str | None) -> None:
        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template

        self.model, self.processor = load(str(BASE), adapter_path=adapter)
        self.prompt = apply_chat_template(self.processor, self.model.config, QWEN_PROMPT, num_images=1)
        self.generate = generate
        tok = getattr(self.processor, "tokenizer", self.processor)
        self.tok = tok
        ends = {tok.convert_tokens_to_ids("<|im_end|>")}
        if tok.eos_token_id is not None:
            ends.add(tok.eos_token_id)
        self.end_ids = sorted(i for i in ends if isinstance(i, int) and i >= 0)

    def read(self, img: np.ndarray, candidates: list[str] | None) -> tuple[str, bool]:
        procs = None
        if candidates:
            ids = [self.tok.encode(c, add_special_tokens=False) for c in candidates]
            procs = [Steer(ids, BIAS, self.end_ids).processor()]
        out = self.generate(self.model, self.processor, self.prompt, [prepare(img)], max_tokens=MAX_TOKENS,
                            temperature=0.0, verbose=False, logits_processors=procs)
        raw = (getattr(out, "text", out) or "").strip()
        text = re.sub(r"\bunreadable\b\.?", "", raw, flags=re.I).strip()
        return text, bool(candidates) and raw in candidates


def cmd_read(args: argparse.Namespace) -> None:
    student = Student(args.adapter)
    log(f"read: {NAME} loaded ({'free' if args.free else 'steered'})")
    cache: tuple[str, np.ndarray] | None = None
    n = 0
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        t0 = time.time()
        try:
            if cache is None or cache[0] != req["image"]:
                cache = (req["image"], load_image(req["image"]))
            cands = None if args.free else (req.get("candidates") or None)
            variants, steered = [], []
            for rot in req["rotations"]:
                text, hit = student.read(crop(cache[1], req["polygon"], rot), cands)
                variants.append({"rotation": rot, "text": text, "confidence": 1.0 if text else 0.0})
                steered.append(hit)
            print(json.dumps({"id": req["id"], "reader": NAME, "variants": variants, "steered": steered,
                              "seconds": round(time.time() - t0, 3)}), flush=True)
        except Exception as e:  # noqa: BLE001 - one bad crop must not stop the run
            print(json.dumps({"id": req["id"], "reader": NAME, "error": type(e).__name__}), flush=True)
        n += 1
        if n % 25 == 0:
            log(f"read: {NAME} {n} crops")


def cmd_crops(args: argparse.Namespace) -> None:
    out = Path(args.out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    rows = []
    cache: tuple[str, np.ndarray] | None = None
    for i, line in enumerate(l for l in sys.stdin if l.strip()):
        req = json.loads(line)
        if cache is None or cache[0] != req["image"]:
            cache = (req["image"], load_image(req["image"]))
        path = out / "images" / f"{i:05d}.png"
        prepare(crop(cache[1], req["polygon"], req["rotation"])).save(path)
        rows.append({"images": [str(path)], "messages": [{"role": "user", "content": QWEN_PROMPT},
                                                         {"role": "assistant", "content": req["target"]}]})
    with open(out / "train.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    log(f"crops: {len(rows)} training crops written")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("read")
    r.add_argument("--adapter", required=True)
    r.add_argument("--free", action="store_true", help="no steering (the exploratory arm)")
    c = sub.add_parser("crops")
    c.add_argument("--out", required=True)
    args = ap.parse_args()
    {"read": cmd_read, "crops": cmd_crops}[args.cmd](args)


if __name__ == "__main__":
    main()
