# Machine labelling (F-0)

Card F-0 (OC34 as amended by OC36): open-weight models label every spine with no owner time, the catalog confirms identity, and a public yardstick the stack did not produce scores the pipeline. Code: `src/eval/f0.ts` (stages, decision, aggregates), `src/eval/f0-cli.ts` (runner), `helpers/label/` (Python: `detect.py`, `read.py`). Models and yardstick: [`docs/models/open-weights.md`](models/open-weights.md). Results: [`evals/F0/report.md`](../evals/F0/report.md).

```
cd helpers/label && uv sync                          # torch, transformers, mlx-vlm, paddleocr (weights are never fetched here)
cd helpers/ocr-vision && swift build -c release      # R1
node src/eval/f0-cli.ts yardstick --arm b2 --limit 40 # PROXY: Library Dataset sample (also --arm b1, b3, b4)
node src/eval/f0-cli.ts pilot                        # real use: every pilot-000 photo
node src/eval/f0-cli.ts publish                      # join both aggregates into evals/F0/
```

The detect cache records its tiling (`layout`). A stage folder holding detections from another tiling (F-0's `pilot-000` run used 1600/700) is refused rather than reused, since cached readings are keyed by box position: move it aside, or use a new `--session`, to rerun with the current default.

Weights are read from `$BOOKCASE_DATA/models/`; nothing is downloaded by the code. Stages are cached as JSON Lines in `$BOOKCASE_DATA/f0/<session>/` (`detect`, `vision`, `ppocr`, `qwen`, `decisions`), so an interrupted run resumes where it stopped. Those files hold recognised text and stay private. Machine labels go to `$BOOKCASE_DATA/labels/<session>.machine.json` in the V-1a schema ([`docs/labels.md`](labels.md)). Only aggregates reach `evals/F0/`.

## Pipeline

1. **Boxes (B2 by default).** Grounding DINO base, prompt `book spine.`, on overlapping tiles (box threshold 0.15), because every detector shrinks its input. Tiling depends on photo scale: whole-case photos (`pilot-000`, a spine about 2 % of the frame) are tiled along their shelf bands: a box-only pass on 3100/1300 tiles finds the bands, then one row of 1600 px-wide tiles (700 px overlap) runs along each band, as tall as the band plus 12 % above and below, so a spine in a found band is whole in some tile (F-0e, below; F-0 ran square 1600 px tiles with 700 px overlap; with no band found, the fallback is a 1600 x 2600 px grid with 700 x 1900 px overlap); shelf-scale photos (the yardstick, a spine about 2400 px tall) use 3100 px tiles with 1300 px overlap, so a spine fits in one tile. Each box goes to SAM 2.1 base-plus; the mask's minimum-area rotated rectangle is the 4-point polygon in working-copy pixels. Boxes over 35 % of a tile (a shelf), boxes wider than 2.5 median spine widths (a group of books), and boxes under aspect 1.5 (face-out covers) are dropped. Duplicates across tiles are removed by rotated-rectangle IoU, keeping boxes not cut by a tile edge first. On whole-case photos the `strips` step then drops boxes lying flat (more than 60° from vertical) that a tile edge cuts: strips of spine ends, not books. Each run has **one** box producer, so there is no box agreement; the box score and the gap test stand in. Three more arms swap only the box step (`--arm`): **B3** OWLv2 base patch16 ensemble (threshold 0.1) and **B4** MM Grounding DINO large feed SAM 2.1 the same way (added by the owner); **B1** SAM 3 segments `book spine` instances directly from the text prompt (instance score ≥ 0.3, its `transformers` default), and its masks take the same polygon, filter and merge steps. SAM 3 is under the SAM License (local use only, never redistributed). The arms are compared on the yardstick, where `evals/F0/report.md` has the per-arm table; `pilot-000` ran B2 only. On the 40-image sample only B3 raised title recall beyond the bootstrap noise (+5.8 points), with 3.9× B2's boxes, lower precision and about 1.5× the compute; B1 and B4 did not differ from B2 in recall, and B4 lost precision. B2 stays the default; switching to B3 (recall over cost) or B1 (licence) is the owner's call.
2. **Shelf bands and gaps.** No band producer exists, so bands are rows of spine boxes (vertical overlap ≥ ½, broken by 8 median widths of empty space, ≥ 3 boxes). The gap share is the band length covered by no box, counting gaps ≥ ½ a median spine width. It sees gaps between boxes only, not missed spines at a row's end: a lower bound.
3. **Readers.** Every crop is cut and turned by the crop method (`CROP` in `f0.ts`, geometry in `src/perceive/crop.ts`; see [Reader crop](#reader-crop-f-0b)) and read at each of its rotations (the catalog decides which is right):
   - R1 Apple Vision `.accurate`, language correction off and on (`helpers/ocr-vision`, through `src/perceive/ocr.ts`);
   - R3 PP-OCRv5 server det + rec with the textline classifier, CPU;
   - R2 Qwen3-VL-4B-Instruct 8-bit (MLX), **hard crops only**: crops on which R1 and R3 have not agreed on a confirmed work, capped per image (`--qwen-cap`, highest box score first). The prompt asks for the printed words only, with `unreadable` allowed and no catalog hints.
   The paid OC10 VLM is not called (no key or ceiling is set): spend is $0.
4. **Catalog.** Each reader's readings of one spine are one `retrieve` call (C-3), top candidate kept.
5. **Decision (OC36 yardstick 2).** A label is accepted when at least two readers' top candidates are the same work, uniquely, and each passes the bar: evidence score ≥ 0.72 (above the highest no-match top score in C-3’s golden run, 0.721; never tuned on the yardstick), title evidence ≥ 0.8, query coverage ≥ 0.5 (`ACCEPT` in `f0.ts`). Otherwise the spine stays `unknown` with its reason: `no-text`, `no-catalog-match`, `single-reader` or `readers-disagree`. There is no human queue.

## Reader crop (F-0b)

Every reader cuts the polygon it is given with a perspective warp to an upright rectangle (corners clockwise from the one nearest the image's top-left) and turns it clockwise by each requested rotation. The crop method decides that polygon and those rotations, and every reading record names it in `crop` (records without one were read by F-0's original method, `rect;rot=fixed`). Steps, each measured on its own in [`evals/F0b/report.md`](../evals/F0b/report.md):

- **orient** (`rot=long-axis`): rotations from the polygon's long axis, both ways round. A tall crop is read at 90° and 270° (as before), a wide one (a spine lying flat) at 0° and 180°, and one whose long side is under twice its short side at all four.
- **clip** (`clip=frame`): a polygon that runs past the photo's edge is trimmed, side by side, to the part inside it. `ocr-vision` refuses polygons outside the frame, so without this a box at the edge is read by two readers at most.
- **face** (`face`): the crop follows the spine face in the mask outline instead of the mask's minimum-area rectangle. The two long sides are fitted on the middle half of the spine (Theil–Sen); an end where the mask bulges past them by more than 15 % of the width (a book's top face seen from above, a neighbour) is trimmed; the quad between the side lines is what the readers warp, which rectifies a perspective trapezoid.
- **pad** (`pad=0.04`): each end lengthened along the long axis, for a mask that cuts a spine short.

A change ships only when its confirmed-share interval on `pilot-000` excludes 0 upward and the yardstick is not hurt (`evals/F0b/report.md`, Verdicts). Shipped: **clip** only (`rect;rot=fixed;clip=frame`): confirmed +1.1 points (0.2 to 2.0) on `pilot-000` and +10.0 (3.2 to 15.2) on the yardstick on boxes partly out of frame, no wrong accepts added. **orient** is off: the boxes it changes are mostly not spines lying flat but shelf lips, gaps and face-out covers, and its confirmed share did not move. **face** is off: it raised matches but also wrong accepts on the yardstick and lowered the text-read share on both sets. **pad** is off: no effect. Every variant is also reported split into whole boxes and pieces of a spine (cut by a tile edge, or under 55 % of the shelf band's height), so the lifts stay readable after F-0e re-tiles detection. A re-run re-reads every spine whose cached readings name a different crop. The face test needs mask outlines, which detection does not keep yet; `helpers/label/outline.py` re-derives them for cached boxes.

## Imprint read (F-0d)

`helpers/label/imprint.py` asks Qwen3-VL-4B (same weights as R2, its own prompt and output file) for a spine's publisher or imprint and whether it came from text or a logo; `src/catalog/imprint.ts` turns ISFDB's `editions.publisher` strings into publisher keys ("Del Rey / Ballantine" → `del rey`, parent `ballantine`), and `tieBreak` in `src/eval/f0d.ts` lets a matching imprint choose between a reader's passing candidates on a box F-0 left unknown, never adding a vote. Runner: `node src/eval/f0d-cli.ts table | select <set> | read <set> | analyse | render`. Measured in [`evals/F0d/report.md`](../evals/F0d/report.md): the tie-break is **off** (it changed no outcome; only 32 `pilot-000` boxes and no yardstick box are ambiguous in the way it needs). The imprint is read on about a fifth of `pilot-000` boxes, a quarter of them from logos, at 39.5 % precision against the work's editions (chance 7.8 %); it is kept as a measured clue for edition-level identity, not wired into F-0's decision.

## What is reported

| | yardstick (PROXY) | `pilot-000` (real use) |
|---|---|---|
| what it is | Library Dataset sample, library shelves, closed-set inventory as catalog | the owner's 31 bookstore photos, ISFDB as catalog |
| title | image-level recall and precision against the annotation | — |
| author | share of accepted labels whose author is annotated in that image | — |
| misses | not-found books; lower bound from too few boxes; wrong accepts; unknown reasons | unknown by reason |
| boxes | recall and precision **pending** (Zhong/Yang download fails) | box score distribution, gap share |
| agreement | — | catalog-confirmed share, reader agreement per pair, OCR vs VLM on hard crops |
| cost | runtime per image and per crop; $0 | same |

`pilot-000` figures are **machine agreement, never accuracy** (INV-17): no person checked them, and no V-6 taps exist yet. The two columns are never merged (OC35). Machine labels are corpus-generated evaluation in the sense of U14 M3: two readers agreeing with each other and with the catalog can still be jointly wrong (a popular title that partly matches noisy text), which is why the yardstick exists.

## Limits

- The published F-0 aggregates (`evals/F0/`) predate the clip; they were read with `rect;rot=fixed`.
- One box producer per run; box agreement between arms is not computed (B1 arrived mid-card and ran on the yardstick only).
- Bands are inferred from boxes; the gap share undercounts.
- The yardstick is in Catalan and Spanish while Vision runs `en-US` (P-1 fixed it for reproducibility), and it is a library, not a bookstore.
- The library inventory is a closed set of 15,229 books, an easier catalog than ISFDB's; yardstick precision is optimistic against the real catalog.

## Whole-spine boxes (F-0e)

The owner's renders of `pilot-000` showed spines broken into stacked pieces. F-0e measured why and changed the whole-case default. Code: `src/eval/f0e.ts` (measures, pure), `src/eval/f0e-cli.ts` (runner), `helpers/label/detect.py` (tiling and post steps), `helpers/label/render_f0e.py` (private renders). Results: [`evals/F0e/report.md`](../evals/F0e/report.md).

```
node src/eval/f0e-cli.ts diagnose                              # the tiling hypothesis on F-0's cached boxes
node src/eval/f0e-cli.ts detect --label tall [--set yardstick]  # one arm (F0E_ARMS); post arms re-run only SAM on a cached arm
node src/eval/f0e-cli.ts read --label tall+strips               # readers on one arm; machine agreement against F-0's run
node src/eval/f0-cli.ts yardstick --arm b2 --post strips --limit 40   # yardstick titles with a post step
node src/eval/f0e-cli.ts title --label strips && node src/eval/f0e-cli.ts publish
node src/eval/f0e-cli.ts render --label base,tall+strips        # the data root's private/f0e/renders/<set>/ (private)
```

- **Cause.** A spine is found whole only if some tile holds it. With 1600 px tiles stepping 900 px, a shelf band falls inside one tile row only where it happens to sit; on `pilot-000`, 84 % of upright boxes were in bands that fit no tile row, and those boxes were cut five times as often (33 % against 6 %). NMS keeps whole boxes first but never joins pieces, so a spine no tile held stays a piece. Part-of-spine detections (label blocks, colour bands) are the smaller cause.
- **Measures** (per set, never merged, OC35): **cut share** (boxes touching an inner tile edge); **partial-height share** (upright boxes shorter than 55 % of their band, against the band polygon as briefed and against the band's spine height, the p90 of its upright boxes, since perspective and rows chained across shelves stretch the polygon); **stacked share** (upright boxes end to end with another in one column, measured along the spine's own axis); **inside share** (boxes mostly inside a larger one); **boxes per band** over band length ÷ median spine width; **upright box length** and box count as paired ratios to F-0's run on the same photos; detection seconds and tile counts. Intervals are 95 % photo bootstraps.
- **Arms** (`F0E_ARMS`): `tall` (the larger-overlap fix, as tall tiles at the old width so the detector's input scale is unchanged and the tile count stays about the same); `bands` (shelf-aligned: a box-only pass on 3100/1300 tiles finds the bands, then one tile row per band, band height plus 12 % above and below); post steps after NMS: `strips`, `join` (union pieces stacked end to end in one column, re-mask with SAM; *spine pieces*, not OCR fragments), `extend` (re-mask each short upright box with its box stretched to the band's height at that x, then drop duplicates).
- **Shipped for whole-case photos:** `bands+strips` (`CASE_TILING`, named in each run's `boxProducer` provenance and in each detection's `layout`). It beat `tall+strips` paired on the same photos (fewer partial-height and nested boxes, slightly longer upright boxes) with about a fifth fewer fine tiles; its risk is a shelf the coarse pass misses. With F-0's readers on all 31 photos, distinct confirmed works per photo did not change (+0.2, −0.6 to +1.1) while the share of boxes reaching `text-read` and `confirmed` rose (+2.0 and +1.5 points): cleaner boxes, no books lost, none gained yet (machine agreement, not accuracy). The yardstick keeps 3100/1300 with no layout change: its tiles already hold a whole shelf. `extend` was rejected: it looked best on `pilot-000` but cost 6.3 points of yardstick title recall.

## Cover-out books (F-0c)

F-0's prompt (`book spine.`) and its aspect filter (under 1.5 dropped) leave out every book shown cover-forward. F-0c adds a cover pass, gives every box a kind, and reads covers from their text. Code: `helpers/label/detect.py` (post step `covers`), `src/eval/f0c.ts` (kinds, cover text; pure), `src/eval/f0c-cli.ts` (runner), `helpers/label/render_f0c.py` (private review page). Results: [`evals/F0c/report.md`](../evals/F0c/report.md).

```
node src/eval/f0c-cli.ts detect pilot-000   # the cover pass on the set's cached default boxes (also: yardstick)
node src/eval/f0c-cli.ts read pilot-000     # Vision, PP-OCR and Qwen (cover prompt) on the kept covers
node src/eval/f0c-cli.ts base pilot-000     # F-0's decisions on the default's cached readings (cached)
node src/eval/f0c-cli.ts analyse            # evals/F0c/ (aggregates only)
node src/eval/f0c-cli.ts render             # the data root's private/f0c/renders/pilot-000/index.html (private)
```

- **Cover pass.** After the spine path, Grounding DINO runs again with `book cover.` on the shelf-scale grid (3100/1300) of every photo, SAM 2.1 masks each box, and cover-shaped boxes (long side under twice the short) are kept in a separate `covers` list after NMS. The spine path is not touched: with only this step, `--from` copies a cached run's spines, bands and gaps verbatim, and a fresh run's spines are identical with the step on or off. The shelf-scale grid, not the spine path's band tiles, because a shelf of only face-out books has no band and a 1600 px tile can cut a cover.
- **Kinds** (`kinds`, every box one `Spine.kind`): a cover box is `face-out` if it is cover-shaped (short over long 0.5–0.9), at least 1.5 median spine widths across, at most twice the photo's spine height, and less than half covered by spine-path boxes (more is a group of spines, the cover prompt's commonest false box); a spine-path box with 60 % of its area inside a kept cover is **absorbed** (the cover stands for that book); a spine-path box is `not-a-book` when it lies flat and is longer than 1.5 band spine heights, is a flat thin strip, or holds two or more kept covers; everything else is `spine`.
- **Cover read.** Crop `rect;rot=cover;clip=frame` (`COVER_CROP`): the whole face, clipped to the frame, at 0° (90° and 270° for a landscape crop, a book lying on its side), never the spine rotations. Vision and PP-OCR read it as a spine; Qwen gets a cover prompt (`read.py --prompt cover`) for title, author and imprint, and the catalog sees its title and author only (`coverText`). Text only: no cover-image matching, no cover downloads, no image embeddings (owner ruling 2026-11-03; the Open Library covers API is display-only, `docs/licences.md`).
- **Identify.** F-0's `decide` and catalog bar unchanged, on the default catalog.
- **Measured** in [`evals/F0c/report.md`](../evals/F0c/report.md), against the keep rules pre-registered there. **Cover pass: off by default.** On `pilot-000` it keeps 4.6 face-out boxes a photo; 3.5 % are confirmed (5 new works, +0.16 a photo, 0.03 to 0.29). But the covers arm's net change in works per photo (+0.10, −0.03 to 0.23, after 2 absorbed confirmed spines) does not exclude 0. Qwen's cover read passes the bar on a quarter of covers, while Vision and PP-OCR rarely read stylised cover lettering, so two-reader agreement holds most covers back. **Not-a-book flags: on by default** (no harm). `f0-cli.ts` labels flagged boxes `not-a-book` with their rule in `notes` and does not read them. On the default boxes they are rare (7 of 6,145 on `pilot-000`, none confirmed), because F-0e's `strips` already drops most strips.
