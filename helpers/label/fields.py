"""F-0j field read (evals/F0j/report.md, pre-registration; docs/models/per-book-extraction.md §4): Qwen3-VL-4B-Instruct
8-bit (MLX) reads one whole book region and answers transcript first, then title, author and imprint, each pointing at
the transcribed lines. Decoding is constrained to a JSON schema by mlx-vlm's llguidance processor at temperature 0.
A field whose text is not a substring of its own lines is rejected after parsing. A separate helper from read.py, so
read.py's hash and every cached `read-*` job key stay valid; its output never goes to qwen.jsonl.

Usage: fields.py < requests.jsonl > responses.jsonl
Request: {"id", "image", "polygon", "rotations", "minLine" (the region's smallest kept line, working-copy px, or null),
"crop"}. Response: {"id", "reader", "crop", "variants": [{"rotation", "text", "confidence", "fields"}], "tokens",
"scale", "seconds"} or {"id", "error"}. A variant's `fields` is contracts/helpers/ocr-response.schema.json's optional
object. stderr carries progress only, never recognised text. Weights are read from $BOOKCASE_DATA/models/.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import time
from pathlib import Path

import cv2
import numpy as np

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
MODELS = DATA / "models"
MIN_LINE = 32  # px: the smallest kept line is scaled to at least one 32 px visual token
TOKEN_CAP = 1024  # visual tokens; one token covers 32 x 32 px (patch 16, merge 2)
MAX_TOKENS = 256
MAX_LINES = 12
PROMPT = (
    "This is a photo of one book's spine or cover, turned so its text runs left to right. "
    "First transcribe every line of printed text exactly as printed, one entry per line, in reading order. "
    "Then say which of your lines give the title, the author's name and the publisher or imprint. "
    "Use only lines you transcribed; give null and no line ids for a field that is not printed. "
    "An imprint may be a publisher's logo: then say from logo. Do not guess or complete names from memory. "
    "Ignore pictures, quotes and slogans. Answer in JSON only."
)
FIELD = {"type": "object", "additionalProperties": False, "required": ["line_ids", "text"],
         "properties": {"line_ids": {"type": "array", "items": {"type": "integer"}, "maxItems": 6},
                        "text": {"type": ["string", "null"]}}}
SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["lines", "title", "author", "imprint", "unassigned"],
    "properties": {
        "lines": {"type": "array", "maxItems": MAX_LINES, "items": {
            "type": "object", "additionalProperties": False, "required": ["i", "text"],
            "properties": {"i": {"type": "integer"}, "text": {"type": "string"}}}},
        "title": FIELD,
        "author": FIELD,
        "imprint": {**FIELD, "required": ["line_ids", "text", "from"],
                    "properties": {**FIELD["properties"], "from": {"enum": ["text", "logo", None]}}},
        "unassigned": {"type": "array", "items": {"type": "integer"}, "maxItems": MAX_LINES},
    },
}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def order_corners(pts: np.ndarray) -> np.ndarray:  # as read.py: clockwise from the corner nearest the top-left
    c = pts.mean(axis=0)
    cw = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    return np.roll(cw, -int(np.argmin(cw[:, 0] + cw[:, 1])), axis=0)


def region_scale(w: int, h: int, min_line: float | None) -> float:
    """Native resolution, the smallest kept line raised to MIN_LINE px, never above TOKEN_CAP tokens."""
    s = max(1.0, MIN_LINE / min_line) if min_line else 1.0
    cap = math.sqrt(TOKEN_CAP * 32 * 32 / max(1, w * h))
    return min(s, cap)


def crop(img: np.ndarray, polygon: list[list[float]], rotation: int, min_line: float | None) -> tuple[np.ndarray, float]:
    p = order_corners(np.array(polygon, dtype=np.float32))
    w = int(round(max(np.linalg.norm(p[1] - p[0]), np.linalg.norm(p[2] - p[3]))))
    h = int(round(max(np.linalg.norm(p[3] - p[0]), np.linalg.norm(p[2] - p[1]))))
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    out = cv2.warpPerspective(img, cv2.getPerspectiveTransform(p, dst), (w, h), flags=cv2.INTER_CUBIC)
    s = region_scale(w, h, min_line)
    if abs(s - 1) > 1e-6:
        out = cv2.resize(out, (max(2, int(round(w * s))), max(2, int(round(h * s)))),
                         interpolation=cv2.INTER_CUBIC if s > 1 else cv2.INTER_AREA)
    rot = {0: None, 90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rotation]
    return (out if rot is None else cv2.rotate(out, rot)), s


def fold(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def check(ans: dict) -> tuple[dict, list[str]]:
    """Keep a field only if its text is a substring (case and whitespace folded) of its own lines' text."""
    lines = {int(x["i"]): x["text"] for x in ans.get("lines", [])}
    out = {"lines": [{"i": i, "text": t} for i, t in lines.items()], "unassigned": [int(i) for i in ans.get("unassigned", [])]}
    rejected = []
    for name in ("title", "author", "imprint"):
        f = ans.get(name) or {}
        text, ids = f.get("text"), [int(i) for i in f.get("line_ids", [])]
        ok = text is not None and fold(text) != "" and ids and all(i in lines for i in ids) \
            and fold(text) in fold(" ".join(lines[i] for i in ids))
        if text is not None and fold(text) != "" and not ok:
            rejected.append(name)
        field = {"lineIds": ids if ok else [], "text": text if ok else None}
        if name == "imprint":
            field["from"] = f.get("from") if ok else None
        out[name] = field
    return out, rejected


class Qwen:
    name = "qwen3-vl-4b-instruct-8bit"

    def __init__(self) -> None:
        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.structured import build_json_schema_logits_processor

        self.model, self.processor = load(str(MODELS / "qwen3-vl-4b-8bit"))
        self.prompt = apply_chat_template(self.processor, self.model.config, PROMPT, num_images=1)
        tok = self.processor.tokenizer if hasattr(self.processor, "tokenizer") else self.processor
        self.lp = build_json_schema_logits_processor(tok, SCHEMA)
        self.generate = generate

    def read(self, img: np.ndarray) -> dict:
        from PIL import Image

        h, w = img.shape[:2]
        if min(h, w) < 56:  # as read.py: the vision tower needs a few patches on the short side
            s = 56 / min(h, w)
            img = cv2.resize(img, (int(w * s) + 1, int(h * s) + 1), interpolation=cv2.INTER_CUBIC)
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        out = self.generate(self.model, self.processor, self.prompt, [pil], max_tokens=MAX_TOKENS, temperature=0.0,
                            verbose=False, logits_processors=[self.lp.clone()])
        raw = getattr(out, "text", out) or ""
        try:
            ans = json.loads(raw)
        except json.JSONDecodeError:
            return {"error": "truncated"}
        fields, rejected = check(ans)
        text = "\n".join(x["text"] for x in fields["lines"] if x["text"].strip())
        return {"text": text, "confidence": 1.0 if text else 0.0, "fields": fields, "rejected": rejected}


def main() -> None:
    reader = Qwen()
    log(f"fields: {reader.name} loaded")
    cache: tuple[str, np.ndarray] | None = None
    n = 0
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        t0 = time.time()
        try:
            if cache is None or cache[0] != req["image"]:
                cache = (req["image"], cv2.imread(req["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION))
            variants, scale, tokens = [], 1.0, 0
            for rot in req["rotations"]:
                img, scale = crop(cache[1], req["polygon"], rot, req.get("minLine"))
                tokens = math.ceil(img.shape[0] / 32) * math.ceil(img.shape[1] / 32)
                variants.append({"rotation": rot, **reader.read(img)})
            print(json.dumps({"id": req["id"], "reader": reader.name, "crop": req.get("crop"), "variants": variants,
                              "tokens": tokens, "scale": round(scale, 4), "seconds": round(time.time() - t0, 3)}),
                  flush=True)
        except Exception as e:  # noqa: BLE001 - one bad crop must not stop the run
            print(json.dumps({"id": req["id"], "reader": reader.name, "crop": req.get("crop"), "error": type(e).__name__}),
                  flush=True)
        n += 1
        if n % 50 == 0:
            log(f"fields: {n} regions")


if __name__ == "__main__":
    main()
