# helpers/depth

Python (`uv`, its own `.venv`: torch, OpenCV and MoGe-2 pinned to its last v2 commit): a monocular point map and
normals per photo, each detected box split into its spine face and other faces, and one book cuboid per box. Card
H-1 built it as a spike; card H-2 made it a cached **depth stage** (`stage.py`). Nothing in the default pipeline
calls it, and it never changes `detect.py`'s boxes: the trim is a step after detection. Survey and recommendation:
[`docs/models/3d-volumes.md`](../../docs/models/3d-volumes.md). Results: [`evals/H1`](../../evals/H1/report.md),
[`evals/H2`](../../evals/H2/report.md).

```
uv sync
python -I stage.py --images images.jsonl --detect detect.jsonl --cache CACHE [--exif-fov] > stage.jsonl  # the stage (H-2)
python -I geometry.py --images images.jsonl --out GEOM [--estimate-fov] [--no-save] > geometry.jsonl   # MoGe-2 only (H-1)
python -I faces.py --detect detect.jsonl --geometry GEOM --classmaps MAPS > faces.jsonl                  # CPU, ~1 s a photo
python -I summarize.py --images … --faces … --geometry … --estimated … [--topseam …] --out metrics.json  # H-1 aggregates
python -I render.py --images … --detect … --faces … --geometry GEOM --classmaps MAPS --out DIR           # H-1 private page
```

- `stage.py` (H-2): geometry and faces per photo, each looked up in a cache before it is computed (INV-14).
  - **Geometry** lives at `CACHE/geometry/moge-2-vitl-normal@<rev>/<key>.npz`, with a `<key>.json` sidecar naming
    what the key covers: the model id, its Hugging Face revision and weight hash (from the download's own
    metadata), the MoGe code commit, `geometry.py`'s hash, the long side, the field of view given, and the working
    copy's SHA-256. The `.npz` holds `points` (H, W, 3, metres, OpenCV camera axes), `normal`, `mask`, `intrinsics`
    (normalised) and `scale` (working copy to map), as float16.
  - **Faces** live at `CACHE/faces/<geometry key>/<key>.json` plus `<key>.png`, keyed by the geometry key,
    `faces.py`'s hash and the photo's boxes and bands. The JSON holds faces.py's per-box rows (class counts, trim,
    cuboid) and the band frames (spine-plane normal, up, offset spread). The PNG is the class map (faces.py
    `CLASSES` index per box pixel, 255 elsewhere).
  - A re-run is a cache hit; changing boxes re-runs faces only, and a new model revision or photo re-runs both.
  - stdout carries the rows, then one line per photo with its keys, hits and seconds (decode, infer, save, faces,
    total; model load apart). `--keys` prints each photo's geometry cache path without loading the model.
  - `--exif-fov` reads the field of view from EXIF's 35 mm-equivalent focal length where the working copy keeps a
    full sensor frame, as H-1 did.
  - **For S-1 (shelf structure and voids)** and later cards: H-2's cache is the data root's `private/h2/cache/`.
    Read it through `stage.py` with the same `--cache`, so the keys decide what is reused.
- `geometry.py`: MoGe-2 ViT-L with the normal head (`Ruicheng/moge-2-vitl-normal`, MIT) on the working copy shrunk to
  a 2048 px long side (`load_model`, `infer`). Weights come from `$BOOKCASE_DATA/models/moge-2-vitl-normal/`.
  Nothing is downloaded here.
- `faces.py`: per shelf band, a spine-plane normal, an up direction from horizontal surfaces and the plane's offset.
  Each box pixel is classed as front (the spine face), edge, top, under, cover or behind. A box over-selects when
  the non-front classes make up at least 15 % of it. The trim is the minimum-area rectangle of the largest connected
  front region. The cuboid takes the spine face's 3D extent, plus a depth measured on the book's visible top or
  cover, or else the band's median depth; `topVisible` says the camera sees its top face. Every threshold is in
  the module docstring.
- `summarize.py`: H-1's counts, shares, percentiles and runtimes, with 95 % photo bootstraps. No ids, positions or
  titles.
- `render.py`: H-1's JPEGs (photo, normals, depth, faces, trim, cuboids) and an `index.html`.

The `.npz` maps, class maps, per-box rows and renders all hold private photo geometry and stay under the data
root's `private/`. stderr carries progress only. `test/h1.test.ts` runs `faces.py` on a synthetic map, and
`test/h2.test.ts` runs the stage's cache on one (both skipped when `.venv` is absent).
