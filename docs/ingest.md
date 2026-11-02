# Ingest (K-1)

`bookcase ingest <folder> --session <name> [--settings <map.json>] [--min-pixels <n>]` reads an exported
folder of originals (INV-11) and never writes to it. Vocabulary: [`CONTEXT.md`](../CONTEXT.md).
Code: `src/capture/`. Tests: `test/ingest.test.ts` (synthetic photos generated in a temp dir).

## Per file

1. **Classify.** Zero bytes → `zero-byte`. A `.icloud` placeholder → `icloud-placeholder`. Not a JPEG or HEIC by file signature (not by extension) → `unsupported-format`. `.AAE` sidecars and hidden files are ignored.
2. **Hash** the original (SHA-256). Nothing else happens first (INV-12).
3. **Validate** (reasons are collected, not first-fail):
   - pixel count (`width × height`, either orientation) below the session minimum (default 12,000,000) → `below-min-resolution`;
   - EXIF `Make`, `Model` or a valid `DateTimeOriginal` missing → `no-exif`.
4. **Flag edited derivatives** (accepted with `flags: ["edited-derivative"]`, OC35): an `IMG_E*` name; a sibling `.AAE`; a `Software` tag that is not a bare version number (the camera writes its iOS version); the EXIF-recorded pixel size differing from the stored pixels, either way (K-2: the transposed-portrait and non-native-size derivatives).
5. **Store** the original read-only at `images/sha256/<aa>/<bb>/<hash>.<jpg|heic>` under `$BOOKCASE_DATA`. Rejected files are not stored.
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

A file without an entry gets `whole-48` at 24 MP or more and `whole-12` below (a stand-in until K-3 supplies
the real map).

## Events

Until L-2's SQLite ledger lands, the CLI keeps the events as JSON Lines in
`$BOOKCASE_DATA/events/<session>.ingest.jsonl` (private: they carry capture instants). `ingest()` itself takes
any `Ledger`.
