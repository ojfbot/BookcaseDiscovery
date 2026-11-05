"""Spine readers for F-0 (docs/models/open-weights.md §3.2): R3 PP-OCRv5 server det + rec with the textline
classifier, and R2 Qwen3-VL-4B-Instruct 8-bit (MLX). R1, Apple Vision, is helpers/ocr-vision.

Usage: read.py --reader ppocr|qwen [--prompt spine|cover|sign] < requests.jsonl > responses.jsonl
Request: {"id", "image", "polygon", "rotations"} as contracts/helpers/ocr-request.schema.json, plus an optional
"crop" (the runner's crop-method provenance, src/perceive/crop.ts), echoed back.
Response: {"id", "variants": [{"rotation", "text", "confidence"}], "seconds"} or {"id", "error"}.
The crop is cut like ocr-vision's: the polygon is perspective-corrected to an upright rectangle (corners
clockwise from the one nearest the image's top-left), then turned clockwise by each rotation.
stderr carries progress only, never recognised text. Weights are read from $BOOKCASE_DATA/models/.
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

DATA = Path(os.environ.get("BOOKCASE_DATA", Path.home() / "data" / "bookcase-discovery"))
MODELS = DATA / "models"
MAX_SIDE = 1600
QWEN_PROMPT = (
    "This is a photo of one book spine, rotated so the text runs left to right. "
    "Transcribe exactly the words printed on it, title first, then author, one per line. "
    "Do not guess or complete names from memory. If no text is legible, answer: unreadable"
)
# F-0c: a face-out cover, read from its text only (no cover-image matching). Three labelled lines, parsed by
# src/eval/f0c.ts (`coverText`): title and author go to the catalog, the imprint is kept as a clue.
QWEN_COVER_PROMPT = (
    "This is a photo of the front cover of one book. Its lettering may be large, stylised or set over a picture. "
    "Copy the title, the author's name and the publisher or imprint exactly as printed on the cover, as three lines:\n"
    "Title: ...\nAuthor: ...\nImprint: ...\n"
    "Write none for any that is not printed. Ignore quotes, reviews and slogans. "
    "Do not guess or complete names from memory. If no text is legible, answer: unreadable"
)
# SC-1: one store sign or label (not a book), few-shot: its kind and its words, parsed by src/eval/sc1.ts (`parseQwen`).
QWEN_SIGN_PROMPT = (
    "This is a photo of one sign or label in a bookshop or library, not a book. Read it and say what kind of sign it "
    "is. Answer one line: KIND | TEXT, where KIND is one of section, ordering, letters, promotion, price, other, and "
    "TEXT is the words exactly as printed.\n"
    "Examples:\n"
    "section | Science Fiction & Fantasy\n"
    "section | Biography\n"
    "ordering | Alphabetical by Author\n"
    "letters | A - C\n"
    "letters | M\n"
    "promotion | Staff Picks\n"
    "price | $12.99\n"
    "other | Information\n"
    "If no text is legible, answer: unreadable"
)


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def order_corners(pts: np.ndarray) -> np.ndarray:
    c = pts.mean(axis=0)
    cw = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    return np.roll(cw, -int(np.argmin(cw[:, 0] + cw[:, 1])), axis=0)


def crop(img: np.ndarray, polygon: list[list[float]], rotation: int) -> np.ndarray:
    p = order_corners(np.array(polygon, dtype=np.float32))
    w = int(round(max(np.linalg.norm(p[1] - p[0]), np.linalg.norm(p[2] - p[3]))))
    h = int(round(max(np.linalg.norm(p[3] - p[0]), np.linalg.norm(p[2] - p[1]))))
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    out = cv2.warpPerspective(img, cv2.getPerspectiveTransform(p, dst), (w, h), flags=cv2.INTER_CUBIC)
    s = MAX_SIDE / max(w, h)
    if s < 1:
        out = cv2.resize(out, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    rot = {0: None, 90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rotation]
    return out if rot is None else cv2.rotate(out, rot)


class PPOCR:
    name = "pp-ocrv5-server"

    def __init__(self) -> None:
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        from paddleocr import PaddleOCR

        m = MODELS / "pp-ocrv5"
        self.ocr = PaddleOCR(
            text_detection_model_name="PP-OCRv5_server_det", text_detection_model_dir=str(m / "server_det"),
            text_recognition_model_name="PP-OCRv5_server_rec", text_recognition_model_dir=str(m / "server_rec"),
            textline_orientation_model_name="PP-LCNet_x1_0_textline_ori",
            textline_orientation_model_dir=str(m / "textline_ori"),
            use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=True,
        )

    def read(self, img: np.ndarray) -> tuple[str, float]:
        res = self.ocr.predict(img)
        lines: list[tuple[float, str, float]] = []
        for r in res:
            for poly, text, score in zip(r["rec_polys"], r["rec_texts"], r["rec_scores"]):
                if text.strip():
                    lines.append((float(np.asarray(poly)[:, 1].mean()), text.strip(), float(score)))
        lines.sort()
        if not lines:
            return "", 0.0
        return "\n".join(t for _, t, _ in lines), float(np.mean([s for _, _, s in lines]))


class Qwen:
    name = "qwen3-vl-4b-instruct-8bit"

    def __init__(self, prompt: str = "spine") -> None:
        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template

        path = str(MODELS / "qwen3-vl-4b-8bit")
        self.model, self.processor = load(path)
        text = {"cover": QWEN_COVER_PROMPT, "sign": QWEN_SIGN_PROMPT}.get(prompt, QWEN_PROMPT)
        self.prompt = apply_chat_template(self.processor, self.model.config, text, num_images=1)
        self.max_tokens = 96 if prompt == "cover" else 48  # three labelled lines
        self.generate = generate

    def read(self, img: np.ndarray) -> tuple[str, float]:
        from PIL import Image

        h, w = img.shape[:2]
        if min(h, w) < 56:  # the vision tower needs a few 28-px patches on the short side
            s = 56 / min(h, w)
            img = cv2.resize(img, (int(w * s) + 1, int(h * s) + 1), interpolation=cv2.INTER_CUBIC)
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        out = self.generate(self.model, self.processor, self.prompt, [pil], max_tokens=self.max_tokens, temperature=0.0,
                            verbose=False)
        # The prompt allows "unreadable"; the model sometimes adds it beside text it did read.
        text = re.sub(r"\bunreadable\b\.?", "", (getattr(out, "text", out) or ""), flags=re.I).strip()
        if not text:
            return "", 0.0
        return text, 1.0  # no calibrated confidence from a generative reader


def crop_of(req: dict) -> dict:
    return {"crop": req["crop"]} if "crop" in req else {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reader", choices=["ppocr", "qwen"], required=True)
    ap.add_argument("--prompt", choices=["spine", "cover", "sign"], default="spine")  # Qwen only
    args = ap.parse_args()
    reader = PPOCR() if args.reader == "ppocr" else Qwen(args.prompt)
    log(f"read: {reader.name} loaded")
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
            variants = []
            for rot in req["rotations"]:
                text, conf = reader.read(crop(cache[1], req["polygon"], rot))
                variants.append({"rotation": rot, "text": text, "confidence": round(conf, 4)})
            print(json.dumps({"id": req["id"], "reader": reader.name, **crop_of(req), "variants": variants,
                              "seconds": round(time.time() - t0, 3)}), flush=True)
        except Exception as e:  # noqa: BLE001 - one bad crop must not stop the run
            print(json.dumps({"id": req["id"], "reader": reader.name, **crop_of(req), "error": type(e).__name__}),
                  flush=True)
        n += 1
        if n % 50 == 0:
            log(f"read: {reader.name} {n} crops")


if __name__ == "__main__":
    main()
