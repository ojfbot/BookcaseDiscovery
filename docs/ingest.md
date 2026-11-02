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
