# Machine labelling (F-0)

Card F-0 (OC34 as amended by OC36): open-weight models label every spine with no owner time, the catalog confirms identity, and a public yardstick the stack did not produce scores the pipeline. Code: `src/eval/f0.ts` (stages, decision, aggregates), `src/eval/f0-cli.ts` (runner), `helpers/label/` (Python: `detect.py`, `read.py`). Models and yardstick: [`docs/models/open-weights.md`](models/open-weights.md). Results: [`evals/F0/report.md`](../evals/F0/report.md).

```
cd helpers/label && uv sync                          # torch, transformers, mlx-vlm, paddleocr (weights are never fetched here)
cd helpers/ocr-vision && swift build -c release      # R1
node src/eval/f0-cli.ts yardstick --limit 24         # PROXY: Library Dataset sample
node src/eval/f0-cli.ts pilot                        # real use: every pilot-000 photo
node src/eval/f0-cli.ts publish                      # join both aggregates into evals/F0/
```

Weights are read from `$BOOKCASE_DATA/models/`; nothing is downloaded by the code. Stages are cached as JSON Lines in `$BOOKCASE_DATA/f0/<session>/` (`detect`, `vision`, `ppocr`, `qwen`, `decisions`), so an interrupted run resumes where it stopped. Those files hold recognised text and stay private. Machine labels go to `$BOOKCASE_DATA/labels/<session>.machine.json` in the V-1a schema ([`docs/labels.md`](labels.md)). Only aggregates reach `evals/F0/`.

## Pipeline

1. **Boxes (B2).** Grounding DINO base, prompt `book spine.`, on 1600 px tiles with 700 px overlap (box threshold 0.15), because every detector shrinks its input and a spine is about 2 % of an ultra-wide frame. Each box goes to SAM 2.1 base-plus; the mask's minimum-area rotated rectangle is the 4-point polygon in working-copy pixels. Boxes over 35 % of a tile (a shelf), boxes wider than 2.5 median spine widths (a group of books), and boxes under aspect 1.5 (face-out covers) are dropped. Duplicates across tiles are removed by rotated-rectangle IoU, keeping boxes not cut by a tile edge first. SAM 3 (B1) is not downloaded, so there is **one** box producer and no box agreement; the box score and the gap test stand in.
2. **Shelf bands and gaps.** No band producer exists, so bands are rows of spine boxes (vertical overlap ≥ ½, broken by 8 median widths of empty space, ≥ 3 boxes). The gap share is the band length covered by no box, counting gaps ≥ ½ a median spine width. It sees gaps between boxes only, not missed spines at a row's end: a lower bound.
3. **Readers.** Every crop is read rotated to horizontal at 90° and 270° (the catalog decides which is right):
   - R1 Apple Vision `.accurate`, language correction off and on (`helpers/ocr-vision`, through `src/perceive/ocr.ts`);
   - R3 PP-OCRv5 server det + rec with the textline classifier, CPU;
   - R2 Qwen3-VL-4B-Instruct 8-bit (MLX), **hard crops only**: crops on which R1 and R3 have not agreed on a confirmed work, capped per image (`--qwen-cap`, highest box score first). The prompt asks for the printed words only, with `unreadable` allowed and no catalog hints.
   The paid OC10 VLM is not called (no key or ceiling is set): spend is $0.
4. **Catalog.** Each reader's readings of one spine are one `retrieve` call (C-3), top candidate kept.
5. **Decision (OC36 yardstick 2).** A label is accepted when at least two readers' top candidates are the same work, uniquely, and each passes the bar: evidence score ≥ 0.8, title evidence ≥ 0.8, query coverage ≥ 0.5 (`ACCEPT` in `f0.ts`). Otherwise the spine stays `unknown` with its reason: `no-text`, `no-catalog-match`, `single-reader` or `readers-disagree`. There is no human queue.

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

- One box producer; box agreement is unavailable until SAM 3 is fetched.
- Bands are inferred from boxes; the gap share undercounts.
- The yardstick is in Catalan and Spanish while Vision runs `en-US` (P-1 fixed it for reproducibility), and it is a library, not a bookstore.
- The library inventory is a closed set of 15,229 books, an easier catalog than ISFDB's; yardstick precision is optimistic against the real catalog.
