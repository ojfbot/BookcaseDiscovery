# helpers/geometry-student

NS-11's **mono-geometry student**: a small RGB-only network that predicts, per detected box, its face shares (spine,
top, cover) and its mean surface normal in the camera frame, distilled from MoGe-2 (`helpers/depth/`). A uv project
of its own (`torch`, `numpy`, `opencv-python-headless`, `coremltools`): the TS-2 reader's `helpers/train/` lock pins
mlx-vlm and stays as it is. Pre-registration: [`evals/NS11/prereg.md`](../../evals/NS11/prereg.md); method and what the
stills could test: [`docs/models/mono-geometry-student.md`](../../docs/models/mono-geometry-student.md).

```
uv sync
python -I student.py normals --inputs I.jsonl --out O.jsonl      # the teacher's mean normal per box, H-2's cache (CPU)
python -I student.py crops --table T.jsonl --out C.npz           # 128x128 letterboxed crops + 12-number geometry vectors
python -I student.py runall --pilot-table … --pilot-crops … --yardstick-table … --yardstick-crops … --out DIR --weights DIR
python -I export_coreml.py --weights student.pt --table … --crops … --out student.mlpackage --report R.json
```

Driven by `src/eval/ns11-cli.ts` (`targets`, `crops`, `train`, `export`, `score`, `register`).

- `student.py`: `GeometryStudentNet` (ResNet-style, from scratch, about 1.6 million parameters), the recipe (AdamW, 40
  epochs, batch 64, learning rate 0.002 with a cosine tail, brightness/contrast and a 90 to 100 % random resized
  crop), the nine pre-registered runs (leave-one-split-group-out, and the frozen split with three seeds) under a
  two-hour cap that counts earlier invocations.
- `export_coreml.py`: float16 `mlprogram` through `coremltools`, size, latency on the Mac for four compute-unit
  settings, agreement with the float32 PyTorch output, PyTorch MPS throughput.
- **No download.** The scripts set `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE`, and the runner points `TORCH_HOME` at an
  empty private folder; `student.py` also makes any socket connection raise, so a library's silent fetch (NS-10's
  `torch.hub` precedent) fails loudly instead of fetching.
- Inputs, crops, predictions and weights stay under the data root (`private/ns11/`, `models/ns11-mono-geometry-student/`).
  The weights are **private-only**; stderr carries progress only, never text or ids.
