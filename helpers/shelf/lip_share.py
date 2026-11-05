"""SC-1: how much of each text line lies on S-1's lip, from S-1's per-photo label map (shelf.py --maps: 2 = lip).

Usage: python -I lip_share.py < requests.jsonl > shares.jsonl
Request (src/eval/sc1-cli.ts): {"id", "map", "scale", "quads": [[[x, y] x4], ...]} with quads in stored pixels;
the map is at `scale` times stored pixels. Response: {"id", "lip": [share or null, ...]}: per quad, the share of its
map pixels labelled lip (null when the quad covers no map pixel or the map is missing). Geometry only; stderr is
progress only.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

LIP = 2


def main() -> None:
    n = 0
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        lab = cv2.imread(req["map"], cv2.IMREAD_UNCHANGED) if Path(req["map"]).exists() else None
        out: list[float | None] = []
        for q in req["quads"]:
            if lab is None:
                out.append(None)
                continue
            p = np.round(np.array(q, dtype=np.float64) * float(req["scale"])).astype(np.int32)
            x0, y0 = max(0, p[:, 0].min()), max(0, p[:, 1].min())
            x1, y1 = min(lab.shape[1], p[:, 0].max() + 1), min(lab.shape[0], p[:, 1].max() + 1)
            if x1 <= x0 or y1 <= y0:
                out.append(None)
                continue
            m = np.zeros((y1 - y0, x1 - x0), np.uint8)
            cv2.fillPoly(m, [p - np.array([x0, y0])], 1)
            k = m.astype(bool)
            out.append(round(float((lab[y0:y1, x0:x1][k] == LIP).mean()), 4) if k.any() else None)
        print(json.dumps({"id": req["id"], "lip": out}), flush=True)
        n += 1
    print(f"lip_share: {n} photos", file=sys.stderr)


if __name__ == "__main__":
    main()
