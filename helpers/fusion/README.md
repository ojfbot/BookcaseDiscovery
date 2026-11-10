# helpers/fusion

Python (`uv`, its own `.venv`: torch with MPS, OpenCV and MapAnything pinned to its v1.1.3 tag): multi-view geometry per
capture group of shelf stills, for the label-fusion spike (card NS-10). Standalone: nothing in the default pipeline calls
it, and it never changes F-0's boxes or the label ledger. Method, results and limits:
[`docs/models/multiview-fusion.md`](../../docs/models/multiview-fusion.md), [`evals/NS10`](../../evals/NS10/report.md).
Layout and conventions follow [`helpers/depth`](../depth/README.md).

```
uv sync
python -I stage.py --groups groups.jsonl --cache DIR [--only INDEX ...] > run.jsonl     # Stage A: MapAnything, cached
python -I lift.py --groups … --boxes … --cache DIR --runs RUNS --h2 H2 --h2-stage … --out footprints.jsonl --summary geometry.jsonl
```

- `stage.py` (Stage A): one forward pass of MapAnything (`facebook/map-anything-apache`, revision `00f9c245bbcb`, read from
  `$BOOKCASE_DATA/models/map-anything-apache/`; never downloaded here) per capture group. RGB only: no intrinsics, poses or
  depth are given. Each working copy is shrunk whole to a 518 px long side (multiples of 14, never cropped); a group of
  mixed portrait and landscape stills is padded (centred, zero after normalisation) to one canvas, since the model stacks
  views. Cache: `CACHE/geometry/map-anything-apache@<rev7>/<group key>/<view id[:16]>.npz` (`pts3d` in the group's frame,
  `pts3d_cam`, `conf`, `mask`, `intrinsics`, `pose` cam2world, `scale`, `offset`, `image`, `size`) and a `group.json`
  sidecar naming the key's fields (model, revision and weight hash from the download's metadata, MapAnything commit, this
  file's hash, long side, precision, each view's SHA-256) and, beside the key, the hash of the DINOv2 code the encoder
  builds from torch hub. stdout carries one JSON line per group (seconds, peak resident and MPS memory), stderr progress.
  Run one process per group to get that group's own memory high-water mark. bf16 autocast first, fp32 if it fails.
- `lift.py` (Stage B, geometry half, CPU, about 20 s for pilot-000): the boxes (F-0i outline, else F-0 rectangle) lifted to
  the group's common frame, one RANSAC shelf plane per group, a footprint rectangle per box on the plane, and the
  consistency check against H-2's MoGe-2 plane (angle, relative depth, scale ratio). Every threshold is a constant at
  the top and in the pre-registration, `evals/NS10/prereg.md`.
- The association, candidates and measures are TypeScript, `src/eval/ns10.ts` and `src/eval/ns10-cli.ts`
  (`prepare`, then these two stages, then `fuse`).

The caches hold private photo geometry and stay under the data root's `private/fusion/`. `uv.lock` is committed.
