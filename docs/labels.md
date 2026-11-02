# Label format

What a person (or F-0's machines, later) records about a photo of a bookcase. The code is `src/eval/labels.ts` (zod schema, geometry helpers); this page says what the fields mean. Label files are **private data**: they live at `$BOOKCASE_DATA/labels/<session>.json`, never in the repo. The only labels in the repo are synthetic ones under `test/fixtures/synthetic/`.

## Shape

```
LabelSet  { schemaVersion: 1, session, photos[] }
Photo     { hash, setting, shelfIndex, width, height, shelfBands[], spines[] }
ShelfBand { id, polygon }
Spine     { id, polygon, shelf, ordinal, kind, text{title, author, series?}, unreadable, catalogId, notes }
```

| Field | Meaning |
|---|---|
| `session` | Session id such as `sf-store-001`. Lowercase letters, digits, `.`, `-`, `_`. It is also the file name. |
| `Photo.hash` | sha256 of the original file, lowercase hex. Unique within a session. |
| `Photo.setting` | Capture setting: `whole-12`, `whole-48`, `shelf-48`, `overview` (REQUIREMENTS OC6), or `real-use` (OC35); free text is still allowed. |
| `Photo.shelfIndex` | Which shelf of the case a per-shelf photo shows; `null` for a whole-case photo. |
| `Photo.width`, `height` | Pixels of the **original** image. All polygons are in these pixels. |
| `shelfBands` | One rotated rectangle per shelf, drawn on whole-case photos (and optionally on per-shelf photos). Sorted top to bottom by centre y. |
| `polygon` | Four corners `[x, y]` in original pixels, y down, in the order **top-left, top-right, bottom-right, bottom-left**. "Top-left" is the corner the box was drawn from and top-right lies along the box's rotation. This is Label Studio's frame, so a round trip is exact. The importer only ever produces rectangles. |
| `Spine.id` | Stable across exports (the Label Studio region id). |
| `Spine.shelf` | Index into `shelfBands`. Derived from geometry, never typed: the band that contains the spine's centre, else the band with the nearest centre. `null` when the photo has no band. |
| `Spine.ordinal` | 0-based position along that band, measured along its top edge, so a tilted band still reads left to right. `null` when `shelf` is `null`. Derived. |
| `Spine.kind` | `spine`, `face-out`, `stacked`, or `not-a-book`. |
| `Spine.text` | What a person read: `title`, `author`, optional `series`. Empty strings when unread. |
| `Spine.unreadable` | A person looked and could not read it. `text` may then be empty or partial. |
| `Spine.catalogId` | **Always `null` when labelled.** V-3 resolves it to a catalog ID or `"not-in-catalog"`. Re-importing a Label Studio export keeps an existing `catalogId` for the same spine id. |
| `Spine.notes` | Free text (price sticker, bookend, glare). |

Validation also rejects duplicate photo hashes, duplicate region ids within a photo, and a `shelf` that points past `shelfBands`.

## Label Studio mapping

The labelling config is `docs/labelling-config.xml`; the converter is `src/eval/labelstudio.ts`.

| Label Studio | Schema |
|---|---|
| `RectangleLabels` result (`x`, `y`, `width`, `height` in percent of the image; `rotation` in degrees, clockwise, about the top-left corner) | `polygon`, via `rectToPolygon` and back via `polygonToRect` |
| label `spine`, `face-out`, `stacked`, `not-a-book` | `kind` |
| label `shelf-band` | a `ShelfBand` |
| `TextArea` per region named `title`, `author`, `series`, `notes` | `text.*`, `notes` (several submitted lines are joined with a space) |
| `Choices` per region named `flags`, choice `unreadable` | `unreadable` |
| task `data`: `image`, `hash`, `setting`, `shelfIndex`, optional `width`, `height` | `Photo` fields. `width` and `height` must be the **original** size if the task serves a downscaled copy |
| region `id` | `Spine.id`, `ShelfBand.id` |
| predictions, cancelled annotations, tasks with no annotation | not imported (a warning is printed) |

`pnpm labels:import <export.json> --session <id>` converts an export and merges it into `$BOOKCASE_DATA/labels/<session>.json`: photos in the export replace their old entry, other photos stay, one `.bak` is kept. `toLabelStudio` goes the other way (to reopen labels in the tool); `test/labels.test.ts` checks export → schema → Label Studio → schema is lossless.
