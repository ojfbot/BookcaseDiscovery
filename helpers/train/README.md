# helpers/train — TS-2 spine reader (LoRA student)

A uv project for card TS-2 (`evals/TS2/prereg.md`): a LoRA on the local Qwen3-VL-4B-Instruct 8-bit MLX weights,
trained with mlx-vlm on TS-0's strong-class `train` labels, then read with optional catalog steering.

- `read_student.py crops`: cuts the training crops exactly as `helpers/label/read.py` cuts F-0's (same `crop`, same
  prompt) and writes mlx-vlm's `train.jsonl`.
- `read_student.py read --adapter <dir> [--free]`: the student reader, with F-0's spine prompt, greedy, 48 tokens at
  most. Each request may carry catalog candidates; `steer.py` biases decoding towards them while the output is still a
  prefix of one, and leaves it free otherwise.
- `steer.py --self-test`: the prefix logic, without a model.

Driven by `src/eval/ts2-cli.ts` (`data`, `train`, `read`, `analyse`, `register`). Set up with `uv sync` here. Crops,
the training file, the adapter and every reading stay under the data root (`private/models/ts2/`, `private/ts2/`).
The adapter is **private-only** (`models/registry/ts2-spine-reader.json`): no G-W or G-PUB release, nothing uploaded.
stderr carries progress only, never text.
