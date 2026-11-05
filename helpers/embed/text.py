"""MM-2: SigLIP 2 text-tower vectors for catalog titles, cached by text key, on the CPU by default.

Usage: python -I text.py --siglip2 MODEL_DIR --out DIR [--device cpu] < requests.jsonl > responses.jsonl
Request (one per text): {"key": <hex key>, "text": <already templated and lowercased title>}
Responses: first {"ready": {"device", "loadSeconds", "dims", "logitScale", "logitBias"}}, then one summary line
  {"done": {"embedded", "cached", "seconds"}}.

The text is tokenised padded to 64 tokens (as SigLIP 2 was trained), and the text tower's pooled output is
L2-normalised and written as raw little-endian float32 `<key>.f32`, beside MM-1's image vectors' space. A key whose
vector exists is not recomputed. stdout and stderr carry counts only, never a text or a key.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

MAX_TOKENS = 64
BATCH = 64


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--siglip2", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    model = AutoModel.from_pretrained(args.siglip2, dtype=torch.float32).to(args.device).eval()
    tok = AutoTokenizer.from_pretrained(args.siglip2)
    with torch.inference_mode():
        scale, bias = float(model.logit_scale.exp()), float(model.logit_bias)
    reqs = [json.loads(line) for line in sys.stdin if line.strip()]
    todo = [r for r in reqs if not (out / f"{r['key']}.f32").exists()]
    dims = int(model.config.text_config.hidden_size)
    print(json.dumps({"ready": {"device": args.device, "loadSeconds": round(time.time() - t0, 2), "dims": dims, "logitScale": scale, "logitBias": bias}}), flush=True)
    t1 = time.time()
    for k in range(0, len(todo), BATCH):
        chunk = todo[k:k + BATCH]
        x = tok([r["text"] for r in chunk], padding="max_length", max_length=MAX_TOKENS, truncation=True, return_tensors="pt")
        with torch.inference_mode():
            f = model.get_text_features(input_ids=x["input_ids"].to(args.device))
        f = f if isinstance(f, torch.Tensor) else f.pooler_output
        v = f.float().cpu().numpy()
        v = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
        for r, row in zip(chunk, v):
            tmp = out / f"{r['key']}.f32.tmp"
            row.astype("<f4").tofile(tmp)
            os.replace(tmp, out / f"{r['key']}.f32")
        if (k // BATCH) % 20 == 0:
            log(f"{min(k + BATCH, len(todo))} / {len(todo)}")
    print(json.dumps({"done": {"embedded": len(todo), "cached": len(reqs) - len(todo), "seconds": round(time.time() - t1, 2)}}), flush=True)


if __name__ == "__main__":
    main()
