# Ingest (K-1, K-3)

`bookcase ingest <folder> --session <name> [--settings <map.json>] [--ledger <db>] [--min-pixels <n>]` reads an exported
folder of originals (INV-11) and never writes to it. Vocabulary: [`CONTEXT.md`](../CONTEXT.md).
Code: `src/capture/`. Tests: `test/ingest.test.ts`, `test/manifest.test.ts` (synthetic photos generated in a temp dir).

## Per file

1. **Classify.** Zero bytes → `zero-byte`. A `.icloud` placeholder → `icloud-placeholder`. Not a JPEG or HEIC by file signature (not by extension) → `unsupported-format`. `.AAE` sidecars and hidden files are ignored.
2. **Hash** the original (SHA-256). Nothing else happens first (INV-12).
3. **Validate** (reasons are collected, not first-fail):
   - pixel count (`width × height`, either orientation) below the session minimum (default 12,000,000) → `below-min-resolution`;
   - EXIF `Make`, `Model` or a valid `DateTimeOriginal` missing → `no-exif`.
4. **Flag edited derivatives** (accepted with `flags: ["edited-derivative"]`, OC35): an `IMG_E*` name; a sibling `.AAE`; a `Software` tag that is not a bare version number (the camera writes its iOS version); the EXIF-recorded pixel size differing from the stored pixels, either way (K-2: the transposed-portrait and non-native-size derivatives).
5. **Store** the original read-only at `images/sha256/<aa>/<bb>/<hash>.<jpg|heic>` under `$BOOKCASE_DATA`, through the ledger's `ImageStore` (`src/ledger/images.ts`, the only image store: [`ledger.md`](ledger.md)). Rejected files are not stored.
6. **Working copy** (see below), stored the same way under its own hash.
7. **Emit** `ImageAssetIngested` (working copy's decoded width and height, setting, capture instant) or `ImageRejected` (reasons).

## Working copy: the polygon frame

Every box and polygon is in the pixel grid of the **working copy**: GPS-stripped, pixels rotated per EXIF
Orientation, Orientation tag cleared to 1. `imageHash` is the untouched original; `workingCopyHash` is this copy.

| Route | When | Pixels |
|---|---|---|
| `exiftool -gps:all= -o` | exiftool installed, Orientation 1 | untouched (lossless) |
| `sips` decode through BMP, re-encode | Orientation ≠ 1, or no exiftool | rotated, re-encoded (other metadata is dropped) |

A direct `sips` re-encode keeps GPS and the tag (checked on macOS), so it is never used. Every copy is
**read back**: GPS present, Orientation ≠ 1 or an unexpected size throws and leaves no file. Without exiftool a
small native JPEG EXIF reader does the reading and the read-back; HEIC needs exiftool (`sips` cannot expose
`DateTimeOriginal`, Orientation or GPS).

## Settings map

`--settings map.json` names each file's photo setting, and a shelf index for per-shelf photos:

```json
{ "IMG_0001.HEIC": "whole-12", "IMG_0002.HEIC": { "setting": "shelf-48", "shelfIndex": 2 } }
```

A file without an entry gets `whole-48` at 24 MP or more and `whole-12` below (a stand-in for a controlled shoot
whose map the owner supplies from the shooting order). A real-use set has no shelf order: every file is
`real-use` and has no `shelfIndex`.

## Ledger and events

Events go to a SQLite ledger ([`ledger.md`](ledger.md)): `--ledger <db>`, default
`$BOOKCASE_DATA/ledger/<session>.sqlite`. The default is per session, and `bookcase report <session>` looks
there first. Ingest refuses a ledger that already holds the session (a second run would duplicate every event);
use another `--session` or `--ledger`. `ingest()` itself takes any `Ledger`, so the tests use the in-memory one.
Check the result with `bookcase replay <db> --to <fresh db>`: the views must come out identical.

## Manifests (K-3)

Every fixture has two manifests, split by the OC9 boundary ([`privacy.md`](privacy.md)).

| | Public | Private |
|---|---|---|
| Path | `fixtures/<session>/manifest.json` (committed) | `<data root>/private/fixtures/<session>.json` |
| Written by | `bookcase manifest <session> [--ledger <db>] [--out <path>]`, from the ledger alone | `bookcase ingest`, from the run's metadata |
| Per photo | `hash`, `workingCopyHash`, `format`, `width`, `height` (working copy), `setting`, `shelfIndex` if any, `flags` if any | file name, hashes, both sizes (working copy and stored), Orientation, megapixels, setting, capture instant, device, lens class (`ultra-wide`, `main`, `telephoto`, `unknown`) with model and focal lengths, `edited` and its signals, `nativeSize` |
| Rejects | `hash` if it was read, `reasons` | file name, `hash`, `reasons` |
| Never | capture time, GPS, store, file names, images | GPS (it is never read) |
| Schema | `contracts/fixture-manifest.schema.json`, checked by `test/manifest.test.ts` and the Z-1 `fixture-manifest` rule | none |

Photos are sorted by `hash`, so the file does not leak the shooting order. The lens class comes from the EXIF
focal length (OC35): the 35 mm equivalent when recorded (up to 18 mm ultra-wide, up to 40 mm main), else the real
focal length (under 4 mm ultra-wide, up to 8 mm main). It needs exiftool; without it the class is `unknown`.
`nativeSize` is true when the stored pixels are on the iPhone camera's own grid (8064 × 6048, 4032 × 3024, either
orientation). K-2 treats a photo off that grid as a derivative even when its EXIF was rewritten to match, which
`flags` cannot see; the private manifest keeps both facts.

## The `pilot-000` run (K-3)

`pilot-000` is the owner's first real-use set (OC35): 31 JPEG exports, handheld, angled, mostly whole cases. Ingested
with every file `real-use` and the default 12 MP minimum.

| Result | Count |
|---|---|
| accepted | 31 (23 flagged `edited-derivative`, 8 unflagged) |
| rejected | 0 |
| working-copy size | 23 portrait (6048 × 8064 and smaller grids), 8 landscape |
| lens | 27 ultra-wide, 4 main |
| `nativeSize` | 17 on the native grid, 14 off it |

K-2 found 5 originals and 26 derivatives ([`ingest-verification.md`](ingest-verification.md)); the entry condition "all
original" does not hold, and the owner ruled to use the set anyway (OC35). K-1's flag catches the 23 portraits (their
EXIF size is the transpose of the stored pixels) but not the 3 landscape resamples K-2 caught by size alone, so the
public `flags` say 23. The private manifest has the other 3 (`edited: false`, `nativeSize: false`). For a measurement
that needs original pixels, use the 5 files that are both unflagged and `nativeSize`.

Rerun: build the all-`real-use` settings map from the folder listing (kept private, beside the private manifest),
then:

```sh
bookcase ingest <folder> --session pilot-000 --settings <the private settings map>
bookcase manifest pilot-000
bookcase replay "$BOOKCASE_DATA/ledger/pilot-000.sqlite" --to "$BOOKCASE_DATA/ledger/pilot-000.replay.sqlite"
```

## Video (2026-11-07 shoot) (NS-K, 2026-11-10)

The owner's first bookstore shoot is video only: stock Camera, default session, iPhone 17 Pro, 1080 × 1920 portrait,
about 30 fps, H.264, every clip with audio, none with a location tag. The owner ruled to build the video pipeline on
these clips now and accept the lower quality. Two store visits, two sessions: `sf-store-001` (visit 1,
`training-source`) and `sf-store-002` (visit 2, `held-out`, never trained on: OC35), both declared in
`src/eval/set-roles.ts`.

```sh
bookcase clip ingest <visit folder> --session <session> --permission-note <the note>   # private manifest only
bookcase clip frames <session> [--rate 1]
bookcase manifest <session>
bookcase clip report <session>                                                          # counts only
```

**Clip ingest.** Per clip: the original is hashed first (INV-12), its facts read with exiftool (`CreationDate`, the
camera's local time with its offset, is the capture instant) and AVFoundation (the track list and the samples per
track), and `helpers/video/strip-audio.swift` writes the audio-free copy: `AVAssetReader` passthrough into
`AVAssetWriter`, no output settings, the source format as the hint, every track but the audio ones, nothing
re-encoded. The copy is checked (no audio track, the same video sample count, the same duration to the millisecond, no
location tag), made read-only, and stored as `<data root>/video/sha256/<aa>/<hash>.mov` under its own hash. A clip
whose original hash is in the clip manifest is skipped, so a rerun adds only new clips. A clip that is not H.264 or
HEVC, has no video track or has no capture instant is refused and listed. The originals with audio stay in the inbox
untouched; the owner rules on them separately. `video/` is a fact folder in DL-6's backup; `inbox/` is unclassified.

**Frames.** `helpers/video/frames.py` (run in the `helpers/coverage` environment: numpy and opencv-python 4.10.0.84)
decodes the audio-free clip and scores every frame by the variance of the Laplacian of a grey copy whose long side is
640 px. In each 1 s window the sharpest frame is written at native resolution as a JPEG (quality 95, no metadata); the
last, partial window of a clip is kept like the others. The frames enter the image store through ingest's **frame
mode**: no session minimum and no EXIF requirement (for frames only), the capture instant is the clip's plus the
frame's timestamp, the device is the clip's, the frame is its own original and working copy (`imageHash` =
`workingCopyHash`), and the setting is `real-use`. The ledger gets ordinary `ImageAssetIngested` events, so the public
manifest passes its schema unchanged. The private fixture manifest marks a frame `nativeSize` when it is on its clip's
grid and gives it its clip's capture provenance (`natural-sweep`, the clip's device class and assumed case). The frame
lineage (frame hash → clip hash, frame index, timestamp, sharpness, the window's median and size, the extractor and its
parameters) is in the private frame manifest, lineage-stamped (DL-3).

**Faces.** No face check runs on frames, and none drops a frame. A face check comes only once the pipeline can tell a
face printed on a book from a real person in the store, and it will blur, never drop. The owner avoided filming people.

**Case map.** The owner gave no map from clips to cases, so each clip is assumed to show one case (`bookcaseId`
`clip-<n>`, `caseIdSource: "assumed-per-clip"` in the clip manifest).

### Counts

| | `sf-store-001` | `sf-store-002` |
|---|---|---|
| clips ingested / refused | 15 / 0 | 5 / 0 |
| duration | 609.78 s | 481.62 s |
| codec, size | H.264, 1080 × 1920 (all 15) | H.264, 1080 × 1920 (all 5) |
| nominal frame rate | 29.58 to 30.00 fps | 29.98 fps |
| device class | `metric-depth` (all 15) | `metric-depth` (all 5) |
| tracks before | per clip: 1 video (`avc1`), 2 audio (`aac `, `apac`), 6 timed metadata (`mebx`) | the same |
| tracks after | per clip: 1 video, 6 timed metadata, 0 audio | the same |
| audio-free copies / video sample counts equal | 15 / 15 | 5 / 5 |
| decoder saw every video sample | 15 of 15 clips | 5 of 5 clips |
| frames kept | 616 | 485 |
| storage: originals (inbox) / audio-free clips / frames | 809.2 / 768.3 / 400.4 MiB | 639.4 / 607.1 / 293.4 MiB |
| wall time: clip ingest / frames | 36 s for both sessions' 20 clips together with the rerun below | 118 s / 92 s |

An exiftool pass over the stored copies (`-ee`, every track's handler) finds 0 audio tracks and 20 video tracks; the
same pass over the inbox originals finds 40 audio tracks. A rerun of `clip ingest` on visit 1 skipped all 15 clips, and
a rerun of `clip frames` on `sf-store-001` framed none.

Sharpness of the kept frames (variance of the Laplacian, grey copy at 640 px on the long side; higher is sharper):

| | p10 | p25 | median | p75 | p90 | min | max |
|---|---|---|---|---|---|---|---|
| `sf-store-001` | 1344.04 | 1690.69 | 2029.23 | 2328.80 | 2551.90 | 243.93 | 2988.84 |
| `sf-store-002` | 1184.17 | 1463.06 | 1640.36 | 1825.06 | 1996.47 | 320.55 | 3089.35 |

The kept frame over its window's median sharpness: median 1.24 (p10 1.06, p90 1.84) in `sf-store-001`, median 1.27
(p10 1.06, p90 1.87) in `sf-store-002`. These are scores of the frame selector, not of reading: they say how much
sharper the chosen frame is than its neighbours, nothing about how many spines can be read.

**Decoder.** OpenCV 4.10.0 (the opencv-python 4.10.0.84 wheel) decoded H.264 through its bundled FFMPEG backend; the
AVFoundation fallback was not needed. ffmpeg itself is not installed and was not used.

### The video tier

A 1080p frame is about 2 MP (1080 × 1920 = 2.07 MP); the still stages are tuned on 48 MP stills. Quality on frames is
expected to be lower and is **unmeasured** until the F-0 card runs on them. The 4K reshoot with stills comes later.
