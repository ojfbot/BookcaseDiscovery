# helpers/depth

Python (`uv`, its own `.venv`: torch, OpenCV and MoGe-2 pinned to its last v2 commit) for card H-1's spike: a
monocular point map and normals per photo, each detected box split into its spine face and other faces, and one
book cuboid per box. Standalone. Nothing in the default pipeline calls it, and it never changes `detect.py`'s
boxes. Survey and recommendation: [`docs/models/3d-volumes.md`](../../docs/models/3d-volumes.md). Results:
[`evals/H1/report.md`](../../evals/H1/report.md).

```
uv sync
python -I geometry.py --images images.jsonl --out GEOM [--estimate-fov] [--no-save] > geometry.jsonl   # MoGe-2, MPS
python -I faces.py --detect detect.jsonl --geometry GEOM --classmaps MAPS > faces.jsonl                  # CPU, ~1 s a photo
python -I summarize.py --images … --faces … --geometry … --estimated … [--topseam …] --out metrics.json  # aggregates only
python -I render.py --images … --detect … --faces … --geometry GEOM --classmaps MAPS --out DIR           # private page
```

- `geometry.py`: MoGe-2 ViT-L with the normal head (`Ruicheng/moge-2-vitl-normal`, MIT) on the working copy shrunk to
  a 2048 px long side. Writes `points`, `normal`, `mask` and `intrinsics` per photo as float16 `.npz`. An image line
  may carry `fovX` (EXIF, where the working copy keeps the sensor's full frame); MoGe then uses it. Weights come from
  `$BOOKCASE_DATA/models/moge-2-vitl-normal/`. Nothing is downloaded here.
- `faces.py`: per shelf band, a spine-plane normal, an up direction from horizontal surfaces and the plane's offset.
  Each box pixel is classed as front (the spine face), edge, top, under, cover or behind. A box over-selects when
  the non-front classes make up at least 15 % of it. The trim is the minimum-area rectangle of the largest connected
  front region. The cuboid takes the spine face's 3D extent, plus a depth measured on the book's visible top or
  cover, or else the band's median depth. Every threshold is in the module docstring.
- `summarize.py`: counts, shares, percentiles and runtimes, with 95 % photo bootstraps. No ids, positions or titles.
- `render.py`: JPEGs (photo, normals, depth, faces, trim, cuboids) and an `index.html`. `--out` must be under
  the data root's `private/`. The renders hold photos and never enter the repo.

The `.npz` maps, class maps, per-box rows and renders all hold private photo geometry and stay under the data root.
stderr carries progress only. `test/h1.test.ts` runs `faces.py` on a synthetic map (skipped when `.venv` is absent).
