# helpers/label

Python (`uv`, its own `.venv`) for card F-0's machine labelling: the spine box producer and two of the three readers
named in [`docs/models/open-weights.md`](../../docs/models/open-weights.md). The runner is `src/eval/f0-cli.ts`; the
method is [`docs/machine-labelling.md`](../../docs/machine-labelling.md).

```
uv sync
uv run python detect.py < images.jsonl > detections.jsonl          # {"id", "image"} per line
uv run python read.py --reader ppocr < requests.jsonl > out.jsonl   # ocr-request lines (contracts/helpers/)
uv run python read.py --reader qwen  < requests.jsonl > out.jsonl
```

- `detect.py`: Grounding DINO base (`book spine.`) on overlapping tiles → SAM 2.1 base-plus masks → minimum-area
  rotated rectangles as 4-point polygons in working-copy pixels; machine shelf bands and the gap test.
- `read.py`: crops each polygon like `ocr-vision` does (perspective-corrected, corners clockwise from the one nearest
  the image's top-left, then turned clockwise by each rotation) and reads it with PP-OCRv5 server (det + rec +
  textline classifier, CPU) or Qwen3-VL-4B-Instruct 8-bit (MLX).

Weights are read from `$BOOKCASE_DATA/models/` and never fetched or committed. stderr carries progress only, never
recognised text. `pyproject.toml` pins OpenCV to one version: paddlex and another dependency both install `cv2`.
This sits apart from `helpers/detect/` (P-2's YOLO detector); see the F-0 deviation in `implementation-notes.md`.
