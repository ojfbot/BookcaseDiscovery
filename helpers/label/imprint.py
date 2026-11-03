"""Imprint read for F-0d: Qwen3-VL-4B-Instruct 8-bit (MLX) asked for a spine's publisher or imprint, as text or logo.

A separate reader variant from read.py's `qwen`: its own prompt and its own output file, so F-0's cached reads
stay valid. The crop is cut exactly as read.py cuts it (its `crop`).

Usage: imprint.py < requests.jsonl > responses.jsonl
Request: {"id", "image", "polygon", "rotations", "crop"?} as read.py.
Response: {"id", "reader", "crop"?, "variants": [{"rotation", "title", "author", "imprint", "imprintFrom", "parsed",
"seconds"}], "seconds"} or {"id", "error"}. `imprintFrom` is "text", "logo" or null.
stderr carries progress only, never recognised text. Weights are read from $BOOKCASE_DATA/models/.
"""

from __future__ import annotations

import json
import re
import sys
import time

import cv2
import numpy as np

from read import MODELS, crop, log

PROMPT = (
    "This is a photo of one book spine, rotated so the text runs left to right. "
    "Find the publisher or imprint on it: a publisher's name, or a publisher's logo or emblem "
    "(an animal, a monogram, a small picture), usually near one end of the spine. "
    "Report it only if you can see it on this spine. Never infer it from the title, the author or "
    "what you know about the book. Answer with JSON only, in this form: "
    '{"title": "words printed", "author": "words printed", "imprint": "publisher name", '
    '"imprint_from": "text"}. '
    'Use "imprint_from": "logo" when you recognised a logo rather than read the name. '
    "Use null for anything not visible."
)
MAX_TOKENS = 96


def parse(raw: str) -> tuple[dict, bool]:
    """The model's JSON, leniently: the first {...} block, else nothing."""
    m = re.search(r"\{.*\}", raw, flags=re.S)
    if m:
        try:
            v = json.loads(m.group(0))
            if isinstance(v, dict):
                return v, True
        except json.JSONDecodeError:
            pass
    return {}, False


def clean(v: object) -> str | None:
    if not isinstance(v, str):
        return None
    v = v.strip()
    return None if not v or v.lower() in {"null", "none", "unknown", "unreadable", "n/a"} else v


class QwenImprint:
    name = "qwen3-vl-4b-instruct-8bit+imprint"

    def __init__(self) -> None:
        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template

        self.model, self.processor = load(str(MODELS / "qwen3-vl-4b-8bit"))
        self.prompt = apply_chat_template(self.processor, self.model.config, PROMPT, num_images=1)
        self.generate = generate

    def read(self, img: np.ndarray) -> dict:
        from PIL import Image

        h, w = img.shape[:2]
        if min(h, w) < 56:  # as read.py: the vision tower needs a few 28-px patches on the short side
            s = 56 / min(h, w)
            img = cv2.resize(img, (int(w * s) + 1, int(h * s) + 1), interpolation=cv2.INTER_CUBIC)
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        out = self.generate(self.model, self.processor, self.prompt, [pil], max_tokens=MAX_TOKENS, temperature=0.0,
                            verbose=False)
        v, ok = parse(getattr(out, "text", out) or "")
        imprint = clean(v.get("imprint"))
        source = clean(v.get("imprint_from"))
        return {
            "title": clean(v.get("title")),
            "author": clean(v.get("author")),
            "imprint": imprint,
            "imprintFrom": (source.lower() if source and source.lower() in {"text", "logo"} else None) if imprint else None,
            "parsed": ok,
        }


def main() -> None:
    reader = QwenImprint()
    log(f"read: {reader.name} loaded")
    cache: tuple[str, np.ndarray] | None = None
    n = 0
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        extra = {"crop": req["crop"]} if "crop" in req else {}
        t0 = time.time()
        try:
            if cache is None or cache[0] != req["image"]:
                cache = (req["image"], cv2.imread(req["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION))
            variants = []
            for rot in req["rotations"]:
                t1 = time.time()
                v = reader.read(crop(cache[1], req["polygon"], rot))
                variants.append({"rotation": rot, **v, "seconds": round(time.time() - t1, 3)})
            print(json.dumps({"id": req["id"], "reader": reader.name, **extra, "variants": variants,
                              "seconds": round(time.time() - t0, 3)}), flush=True)
        except Exception as e:  # noqa: BLE001 - one bad crop must not stop the run
            print(json.dumps({"id": req["id"], "reader": reader.name, **extra, "error": type(e).__name__}), flush=True)
        n += 1
        if n % 25 == 0:
            log(f"read: {reader.name} {n} crops")


if __name__ == "__main__":
    main()
