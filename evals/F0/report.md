# F0: machine labelling (F-0)

Two scores, never merged (OC35, OC36): the **yardstick (PROXY)** scores the pipeline against labels it did not
produce; **`pilot-000` (real use)** reports machine agreement only. Method: `docs/machine-labelling.md`.

## Box arms on the yardstick (PROXY)

Same 40 held-out images, same prompt (`book spine`), tiling, readers and acceptance bar; only the box step
changes (B2–B4 feed SAM 2.1; B1 is SAM 3 alone). Box recall and precision stay pending (no box ground truth), so arms are
compared through the end-to-end title score. Δ vs B2 is in percentage points with a paired bootstrap 95 % interval over the
images (10,000 resamples); an interval that spans 0 is not a clear difference. "All stages" is detection plus every reader's
summed stage time, divided by images (PP-OCR's three CPU workers are summed, not wall clock).

| arm | box step | images | boxes | boxes/image p50 (max) | title recall | Δ recall vs B2 | title precision | Δ precision vs B2 | author | all stages s/image | gap share | detect s/image p50 | detector peak MB (RSS / MPS) | device |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| B1 | sam3 (text prompt, masks direct) | 40 | 1504 | 30 (149) | 40.3 % | +3.4 (-2.4 to 9.5) | 92.3 % | -0.4 (-3.6 to 3.1) | 93.8 % | 97 | 19.1 % | 11.03 | 12457 / 37446 | mps |
| B2 | grounding-dino-base -> sam2.1-hiera-base-plus | 40 | 1132 | 25 (84) | 36.9 % | — | 92.7 % | — | 92.6 % | 128 | 13.4 % | 5.08 | 10988 / 15263 | mps |
| B3 | owlv2-base-patch16-ensemble -> sam2.1-hiera-base-plus | 40 | 4389 | 85 (425) | 42.7 % | +5.8 (1.8 to 10.4) | 90.0 % | -2.7 (-5.9 to 0.4) | 90.1 % | 188 | 19.2 % | 11.11 | 15524 / 13074 | mps |
| B4 | mm-grounding-dino-large-all -> sam2.1-hiera-base-plus | 40 | 1529 | 29 (222) | 35.5 % | -1.4 (-4.2 to 1.6) | 91.0 % | -1.7 (-3.4 to -0.3) | 94.2 % | 123 | 15.5 % | 11.03 | 6721 / 33560 | mps |

Intervals that exclude 0: recall above B2: B3; recall below B2: none; precision above B2: none; precision below B2: B4. Stage times were taken one arm at a time on one Mac, but other work shared the GPU at times, so compare them loosely.

## F0-yardstick-b1: F-0 pipeline on the yardstick (PROXY), box arm B1

Run 2026-11-02. **PROXY**: the Library Dataset (Llabrés et al. 2024, MIT; library shelves in Catalan and Spanish, not a
bookstore). It was not produced by this stack and is never trained on (OC36). Titles are matched against the dataset's
own inventory (closed set, 15,229 books) through C-3's index and retrieval. Sample: 40 of 388 annotated split images, every k-th by name.

| title (image-level, against the annotation) | value |
|---|---:|
| ground-truth books in sample | 653 (+49 annotated but not matched to the inventory, left out) |
| accepted predictions | 285 |
| **title recall** | **40.3 %** (263) |
| **title precision** | **92.3 %** |
| per-image recall p50 / precision p50 | 46.2 % / 100.0 % |
| **author accuracy** (accepted labels whose author's surname is among the image's annotated authors) | **93.8 %** (271/289) |

**Misses by reason** (390 ground-truth books not found): at least 0 by too few boxes
(image had fewer boxes than annotated books); 22 accepted labels were wrong books. Detected spines left unknown:
single-reader 118, no-catalog-match 341, no-text 756. Without spine geometry in the annotation a
miss cannot be tied to one box, so these are counts side by side, not a partition.

**Box recall and precision: pending.** Zhong/Yang set (figshare file 24026015) returned HTTP 504 on 2026-11-02; Library Dataset geometry is not released.

Machine figures on the sample: 1504 boxes, catalog-confirmed 19.2 %, gap share 19.1 %.
Runtime: detection p50 11.03 s per image; PP-OCR p50 1.3 s per crop; Qwen p50 2.066 s per crop
(424 of 1304 hard crops, cap 15 per image). Spend $0.

## F0-yardstick: F-0 pipeline on the yardstick (PROXY), box arm B2

Run 2026-11-02. **PROXY**: the Library Dataset (Llabrés et al. 2024, MIT; library shelves in Catalan and Spanish, not a
bookstore). It was not produced by this stack and is never trained on (OC36). Titles are matched against the dataset's
own inventory (closed set, 15,229 books) through C-3's index and retrieval. Sample: 40 of 388 annotated split images, every k-th by name.

| title (image-level, against the annotation) | value |
|---|---:|
| ground-truth books in sample | 653 (+49 annotated but not matched to the inventory, left out) |
| accepted predictions | 260 |
| **title recall** | **36.9 %** (241) |
| **title precision** | **92.7 %** |
| per-image recall p50 / precision p50 | 33.3 % / 100.0 % |
| **author accuracy** (accepted labels whose author's surname is among the image's annotated authors) | **92.6 %** (249/269) |

**Misses by reason** (412 ground-truth books not found): at least 0 by too few boxes
(image had fewer boxes than annotated books); 19 accepted labels were wrong books. Detected spines left unknown:
single-reader 160, no-catalog-match 412, no-text 290, readers-disagree 1. Without spine geometry in the annotation a
miss cannot be tied to one box, so these are counts side by side, not a partition.

**Box recall and precision: pending.** Zhong/Yang set (figshare file 24026015) returned HTTP 504 on 2026-11-02; Library Dataset geometry is not released.

Machine figures on the sample: 1132 boxes, catalog-confirmed 23.8 %, gap share 13.4 %.
Runtime: detection p50 5.08 s per image; PP-OCR p50 2.582 s per crop; Qwen p50 2.467 s per crop
(478 of 963 hard crops, cap 15 per image). Spend $0.

## F0-yardstick-b3: F-0 pipeline on the yardstick (PROXY), box arm B3

Run 2026-11-02. **PROXY**: the Library Dataset (Llabrés et al. 2024, MIT; library shelves in Catalan and Spanish, not a
bookstore). It was not produced by this stack and is never trained on (OC36). Titles are matched against the dataset's
own inventory (closed set, 15,229 books) through C-3's index and retrieval. Sample: 40 of 388 annotated split images, every k-th by name.

| title (image-level, against the annotation) | value |
|---|---:|
| ground-truth books in sample | 653 (+49 annotated but not matched to the inventory, left out) |
| accepted predictions | 310 |
| **title recall** | **42.7 %** (279) |
| **title precision** | **90.0 %** |
| per-image recall p50 / precision p50 | 43.8 % / 94.7 % |
| **author accuracy** (accepted labels whose author's surname is among the image's annotated authors) | **90.1 %** (329/365) |

**Misses by reason** (374 ground-truth books not found): at least 0 by too few boxes
(image had fewer boxes than annotated books); 31 accepted labels were wrong books. Detected spines left unknown:
no-catalog-match 1211, single-reader 171, no-text 2641, readers-disagree 1. Without spine geometry in the annotation a
miss cannot be tied to one box, so these are counts side by side, not a partition.

**Box recall and precision: pending.** Zhong/Yang set (figshare file 24026015) returned HTTP 504 on 2026-11-02; Library Dataset geometry is not released.

Machine figures on the sample: 4389 boxes, catalog-confirmed 8.3 %, gap share 19.2 %.
Runtime: detection p50 11.11 s per image; PP-OCR p50 0.752 s per crop; Qwen p50 1.98 s per crop
(570 of 4125 hard crops, cap 15 per image). Spend $0.

## F0-yardstick-b4: F-0 pipeline on the yardstick (PROXY), box arm B4

Run 2026-11-02. **PROXY**: the Library Dataset (Llabrés et al. 2024, MIT; library shelves in Catalan and Spanish, not a
bookstore). It was not produced by this stack and is never trained on (OC36). Titles are matched against the dataset's
own inventory (closed set, 15,229 books) through C-3's index and retrieval. Sample: 40 of 388 annotated split images, every k-th by name.

| title (image-level, against the annotation) | value |
|---|---:|
| ground-truth books in sample | 653 (+49 annotated but not matched to the inventory, left out) |
| accepted predictions | 255 |
| **title recall** | **35.5 %** (232) |
| **title precision** | **91.0 %** |
| per-image recall p50 / precision p50 | 38.5 % / 100.0 % |
| **author accuracy** (accepted labels whose author's surname is among the image's annotated authors) | **94.2 %** (245/260) |

**Misses by reason** (421 ground-truth books not found): at least 0 by too few boxes
(image had fewer boxes than annotated books); 23 accepted labels were wrong books. Detected spines left unknown:
no-catalog-match 399, single-reader 139, no-text 730, readers-disagree 1. Without spine geometry in the annotation a
miss cannot be tied to one box, so these are counts side by side, not a partition.

**Box recall and precision: pending.** Zhong/Yang set (figshare file 24026015) returned HTTP 504 on 2026-11-02; Library Dataset geometry is not released.

Machine figures on the sample: 1529 boxes, catalog-confirmed 17.0 %, gap share 15.5 %.
Runtime: detection p50 11.03 s per image; PP-OCR p50 1.718 s per crop; Qwen p50 2.331 s per crop
(474 of 1371 hard crops, cap 15 per image). Spend $0.

## F0-pilot-000: machine labels on `pilot-000` (F-0, real use)

Run 2026-11-02. **Real-use data (OC35). Every figure is machine agreement, not accuracy (INV-17)**: no person checked
any of it, and no V-6 taps exist yet. Aggregates only; labels stay in `$BOOKCASE_DATA/labels/pilot-000.machine.json`.

Stack: one box producer (Grounding DINO base → SAM 2.1 base-plus, tiled). SAM 3 (B1) arrived mid-card and was run on
the yardstick only, so box agreement between two producers is unavailable here. Readers: Apple Vision, PP-OCRv5 server, and Qwen3-VL-4B (8-bit, local) on hard
crops only (at most 40 per image). No paid calls: **spend per spine $0**.

| | value |
|---|---:|
| images | 31 |
| spine boxes | 6894 (per image p50 222, min 69, max 377) |
| box score p10 / p50 / p90 | 0.172 / 0.243 / 0.339 |
| **catalog-confirmed share** (≥ 2 readers name one ISFDB work that passes the bar) | **10.4 %** (718) |
| confirmed by 2 / by 3 readers | 718 / 0 |
| **gap share** (band length covered by no box, gaps ≥ ½ median spine width) | **13.9 %** (471 gaps) |
| hard crops (OCR readers not agreed) / sent to Qwen | 6345 / 1240 |
| accepted with Qwen among the agreeing readers | 169 |

**Unknown, by reason:** single-reader 923, no-text 1738, no-catalog-match 3435, readers-disagree 80.

**Reader agreement** (spines where both readers' top candidate passed the catalog bar; share naming the same work):

| pair | read by both | both confirmed a work | same work |
|---|---:|---:|---:|
| Vision vs PP-OCR | 6894 | 612 | 549 (89.7 %) |
| Vision vs Qwen (OCR vs VLM) | 1240 | 167 | 135 (80.8 %) |
| PP-OCR vs Qwen (OCR vs VLM) | 1240 | 57 | 34 (59.7 %) |

Per reader, spines whose top candidate passed the bar: vision 1307/6894, ppocr 853/6894, qwen 378/1240.

**Runtime** (one Mac, M-series, 48 GB): detection p50 78.33 s per image (max 99.33, total 2206 s);
Vision 848 s for 6894 crops; PP-OCR 8277 s for 6894 crops (p50 1.033 s);
Qwen 1973 s for 1240 crops (p50 1.492 s). Wall clock for this invocation 751 s (cached stages are not re-run).
