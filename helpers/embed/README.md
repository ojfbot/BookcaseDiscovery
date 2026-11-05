# helpers/embed

Python (`uv`, its own `.venv`: PyTorch on MPS, Transformers, OpenCV). Card MM-1: each box's upright spine strip and
two embeddings of it, for the multimodal identify cards (MM-2 shadow mode, MM-3 promotion). The runner is
`src/eval/mm1-cli.ts`; pre-registration and results are in [`evals/MM1`](../../evals/MM1/report.md). Nothing in the
pipeline reads its output yet, and the appearance switch is `off`.

```
uv sync
python -I embed.py --dinov2 M --siglip2 M --strips DIR --dinov2-out DIR --siglip2-out DIR < requests.jsonl > out.jsonl
```

- Request, one per photo: `{"photo": <ordinal>, "image": <path>, "boxes": [{"key", "polygon"}]}`. The key is the
  runner's strip key (box id, polygon and strip method).
- **Strip:** the polygon warped upright (as F-0g's `helpers/label/appearance.py` cuts it), long side capped at 512 px,
  written once as PNG; both models read that file, so a re-run embeds the identical strip.
- **DINOv2 base** (`facebook/dinov2-base`, Apache-2.0): the strip fitted inside 112 × 448, padded with the ImageNet
  mean; the layer-normed CLS token. **SigLIP 2 base NaFlex** (`google/siglip2-base-patch16-naflex`, Apache-2.0): the
  processor's aspect-preserving resize to at most 256 patches; the image tower's pooled output.
- Vectors are L2-normalised float32 files (`<key>.f32`). A box whose strip and both vectors exist is skipped.
- Weights are read from `$BOOKCASE_DATA/models/{dinov2-base,siglip2-base-patch16-naflex}/`, downloaded once with
  `hf download`; never fetched here and never committed. The runner reads each revision from the download's metadata.
- stdout carries keys, sizes and timings only; stderr carries photo ordinals, never ids or paths. Strips and vectors
  stay under the data root's `private/mm/<set>/`.
