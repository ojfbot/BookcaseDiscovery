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
3. **Readers.** Every crop is read rotated to horizontal at 90° and 270° (the catalog decides which is right):
   - R1 Apple Vision `.accurate`, language correction off and on (`helpers/ocr-vision`, through `src/perceive/ocr.ts`);
   - R3 PP-OCRv5 server det + rec with the textline classifier, CPU;
   - R2 Qwen3-VL-4B-Instruct 8-bit (MLX), **hard crops only**: crops on which R1 and R3 have not agreed on a confirmed work, capped per image (`--qwen-cap`, highest box score first). The prompt asks for the printed words only, with `unreadable` allowed and no catalog hints.
   The paid OC10 VLM is not called (no key or ceiling is set): spend is $0.
4. **Catalog.** Each reader's readings of one spine are one `retrieve` call (C-3), top candidate kept.
5. **Decision (OC36 yardstick 2).** A label is accepted when at least two readers' top candidates are the same work, uniquely, and each passes the bar: evidence score ≥ 0.72 (above the highest no-match top score in C-3’s golden run, 0.721; never tuned on the yardstick), title evidence ≥ 0.8, query coverage ≥ 0.5 (`ACCEPT` in `f0.ts`). Otherwise the spine stays `unknown` with its reason: `no-text`, `no-catalog-match`, `single-reader` or `readers-disagree`. There is no human queue.

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
