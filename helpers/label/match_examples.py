"""Match example images (crops or screenshots of a private render) to the photos they came from, by ORB keypoints.

Usage: match_examples.py --photos photos.jsonl --examples a.png b.webp ... [--detector orb|sift] > matches.json
Each photos.jsonl line is {"id": ..., "path": ...}. For each example, every photo is scored by the number of keypoint
matches (ORB, or SIFT for a small, low-resolution crop where ORB finds too few) that pass Lowe's ratio test and a
RANSAC homography; the best photo and the runner-up's count are printed.
Paths and ids stay private: the caller writes the result under the data root.
"""

from __future__ import annotations

import argparse
import json
import sys

import cv2
import numpy as np

# Long side the photos and the examples are scaled to before matching, per detector.
SIDES = {"orb": (1600, 1600), "sift": (3000, 1200)}
RATIO = 0.75


def load(path: str, side: int) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise SystemExit(f"cannot read an input image ({path.rsplit('/', 1)[-1]})")
    s = side / max(img.shape)
    return cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", required=True)
    ap.add_argument("--examples", nargs="+", required=True)
    ap.add_argument("--detector", choices=sorted(SIDES), default="orb")
    a = ap.parse_args()
    det = cv2.ORB_create(nfeatures=6000) if a.detector == "orb" else cv2.SIFT_create(nfeatures=20000)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING if a.detector == "orb" else cv2.NORM_L2)
    photo_side, example_side = SIDES[a.detector]
    photos = [json.loads(line) for line in open(a.photos) if line.strip()]
    feats = []
    for p in photos:
        kp, des = det.detectAndCompute(load(p["path"], photo_side), None)
        feats.append((p["id"], kp, des))
    out = []
    for ex in a.examples:
        kq, dq = det.detectAndCompute(load(ex, example_side), None)
        scores = []
        for pid, kp, des in feats:
            if dq is None or des is None or len(des) < 2:
                scores.append((0, pid))
                continue
            good = [m for m, n in (x for x in bf.knnMatch(dq, des, k=2) if len(x) == 2) if m.distance < RATIO * n.distance]
            inliers = 0
            if len(good) >= 8:
                src = np.float32([kq[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
                dst = np.float32([kp[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
                _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 8.0)
                inliers = int(mask.sum()) if mask is not None else 0
            scores.append((inliers, pid))
        scores.sort(reverse=True)
        out.append({"example": ex.rsplit("/", 1)[-1], "id": scores[0][1], "inliers": scores[0][0], "runnerUp": scores[1][0] if len(scores) > 1 else 0, "detector": a.detector})
        print(f"match: example {len(out)} best {scores[0][0]} inliers, runner-up {out[-1]['runnerUp']}", file=sys.stderr)
    json.dump({"first": out}, sys.stdout)


if __name__ == "__main__":
    main()
