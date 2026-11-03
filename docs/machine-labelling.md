# Machine labelling (F-0)

Card F-0 (OC34 as amended by OC36): open-weight models label every spine with no owner time, the catalog confirms identity, and a public yardstick the stack did not produce scores the pipeline. Code: `src/eval/f0.ts` (stages, decision, aggregates), `src/eval/f0-cli.ts` (runner), `helpers/label/` (Python: `detect.py`, `read.py`). Models and yardstick: [`docs/models/open-weights.md`](models/open-weights.md). Results: [`evals/F0/report.md`](../evals/F0/report.md).

```
cd helpers/label && uv sync                          # torch, transformers, mlx-vlm, paddleocr (weights are never fetched here)
cd helpers/ocr-vision && swift build -c release      # R1
node src/eval/f0-cli.ts yardstick --arm b2 --limit 40 # PROXY: Library Dataset sample (also --arm b1, b3, b4)
node src/eval/f0-cli.ts pilot                        # real use: every pilot-000 photo
node src/eval/f0-cli.ts publish                      # join both aggregates into evals/F0/
```

Weights are read from `$BOOKCASE_DATA/models/`; nothing is downloaded by the code. Stages are cached as JSON Lines in `$BOOKCASE_DATA/f0/<session>/` (`detect`, `vision`, `ppocr`, `qwen`, `decisions`), so an interrupted run resumes where it stopped. Those files hold recognised text and stay private. Machine labels go to `$BOOKCASE_DATA/labels/<session>.machine.json` in the V-1a schema ([`docs/labels.md`](labels.md)). Only aggregates reach `evals/F0/`.

## Pipeline

1. **Boxes (B2 by default).** Grounding DINO base, prompt `book spine.`, on overlapping tiles (box threshold 0.15), because every detector shrinks its input. Tiling depends on photo scale: whole-case photos (`pilot-000`, a spine about 2 % of the frame) use 1600 px tiles with 700 px overlap; shelf-scale photos (the yardstick, a spine about 2400 px tall) use 3100 px tiles with 1300 px overlap, so a spine fits in one tile. Each box goes to SAM 2.1 base-plus; the mask's minimum-area rotated rectangle is the 4-point polygon in working-copy pixels. Boxes over 35 % of a tile (a shelf), boxes wider than 2.5 median spine widths (a group of books), and boxes under aspect 1.5 (face-out covers) are dropped. Duplicates across tiles are removed by rotated-rectangle IoU, keeping boxes not cut by a tile edge first. Each run has **one** box producer, so there is no box agreement; the box score and the gap test stand in. Three more arms swap only the box step (`--arm`): **B3** OWLv2 base patch16 ensemble (threshold 0.1) and **B4** MM Grounding DINO large feed SAM 2.1 the same way (added by the owner); **B1** SAM 3 segments `book spine` instances directly from the text prompt (instance score ≥ 0.3, its `transformers` default), and its masks take the same polygon, filter and merge steps. SAM 3 is under the SAM License (local use only, never redistributed). The arms are compared on the yardstick, where `evals/F0/report.md` has the per-arm table; `pilot-000` ran B2 only. On the 40-image sample only B3 raised title recall beyond the bootstrap noise (+5.8 points), with 3.9× B2's boxes, lower precision and about 1.5× the compute; B1 and B4 did not differ from B2 in recall, and B4 lost precision. B2 stays the default; switching to B3 (recall over cost) or B1 (licence) is the owner's call.
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

A change ships only when its confirmed-share interval on `pilot-000` excludes 0 upward and the yardstick is not hurt (`evals/F0b/report.md`, Verdicts). Shipped: **clip** only (`rect;rot=fixed;clip=frame`): confirmed +1.1 points (0.2 to 2.0) on `pilot-000` and +10.0 (3.2 to 15.2) on the yardstick on boxes partly out of frame, no wrong accepts added. **orient** is off: the boxes it changes are mostly not spines lying flat but shelf lips, gaps and face-out covers, and its confirmed share did not move. **face** is off: it raised matches but also wrong accepts on the yardstick and lowered the text-read share on both sets. **pad** is off: no effect. A re-run re-reads every spine whose cached readings name a different crop. The face test needs mask outlines, which detection does not keep yet; `helpers/label/outline.py` re-derives them for cached boxes.

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
