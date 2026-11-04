# Per-book information extraction (pass 2): research and the F-0j design (F-R2)

Research card F-R2, 2026-11-03 (`claude/fr2-extraction`). **Question:** the owner proposed two passes at different
resolutions and tilings (2026-11-03):
- **pass 1** maps where the books are (geometry and volumes; F-R1 researches it);
- **pass 2** takes each mapped book region and pulls out the book's own information (title, author, imprint, jacket
  or cover art) with its own model, resolution and tiling.

What should pass 2 be, how is it judged, and where does it run?

Research plus a label-free measurement on cached data. No pipeline code, no GPU (S-1 holds it), no model or dataset
downloads, no accounts, no paid calls. No title, photo, crop, path or image id from the owner's data went into any
search or external service.

Four threads ran in parallel:
- (a) layout parsing, searched on arXiv directly;
- (b) resolution and tiling;
- (c) reading models;
- (d) field-structured output.

The measurement is [`evals/FR2/report.md`](../../evals/FR2/report.md).

Labels, as in [`identification-research.md`](../catalog/identification-research.md):
- **verified**: read on the primary page (paper abstract or body, model card, repo file, official docs), or in this
  repo's own reports. "Verified by thread x" means a thread read it and this doc did not re-open it.
- **re-checked**: a thread's claim re-opened for this doc (the hub entries for the shortlisted models).
- **snippet**: seen only in a search summary or a secondary page.
- **hypothesis**: inferred, including every time and memory estimate below.

Real-use figures (`pilot-000`) are machine agreement, never accuracy (INV-17). The yardstick is a PROXY (OC35).

## Answer first

- **Measured: pass 1 does not starve the readers of pixels.** The losses are in reading correctness and evidence
  structure.
  - On `pilot-000`, crops are a median 140 px across the spine, and only 6.6 % hit `read.py`'s 1,600 px cap.
  - The largest unknown pool (no-catalog-match, 3,121 boxes) has the same size and contrast as the confirmed boxes.
  - Where a text line exists, the readers read text 98 % of the time, but only 13–18 % confirm.
  - So pass 2 is worth building for **what** it reads and **how the reading is scored**, not for more pixels per
    box.
- **Measured: the per-line resolution problem is the author and imprint lines, not the title.**
  - The tallest line in a crop is a median 59 px in recogniser pixels, above PP-OCR's 48 px input height.
  - But 31.6 % of all detected lines are under 32 px, and the second-tallest line is under 32 px in 26 % of crops.
  - Title and author lines are close in size (median ratio 1.22), so size alone cannot tell the title.
- **Measured: stylised type needs a second reader independent of Qwen.** On 201 of the 413 `pilot-000` hard crops
  where Qwen's top candidate passes the bar (49 %), neither OCR reader passes. Two-reader agreement holds those back,
  as it should (INV-6).
- **Recommended pass 2: card F-0j, "zone, read per line, emit fields".** It takes F-0i's clean book regions:
  1. Find text lines with PP-OCR's DB detector, at the working copy's native resolution.
  2. Cut each line from the working copy and scale it to the recogniser's height (48 px for PP-OCR; at least 32 px,
     one Qwen token, for the VLM). Use plain resampling only, never generative super-resolution.
  3. Read each line with Vision and PP-OCR, and the whole region with Qwen through a **transcript-first JSON**
     prompt. That prompt emits title, author and imprint as separate fields, each pointing at transcribed lines.
  4. Feed the fields to **C-7** as separate rarity-weighted title and author evidence; the imprint is IMP-1
     contrast only.
  5. Each reader still casts **one** vote (INV-6).

  Judge it in three arms (lines, fields, VLM fields) by F-0b's rule, plus H-2's works guard and a
  leave-one-reader-out check (§5).
- **Readers.**
  - **Now, no download:** PP-OCRv5 line reads, Vision line reads, and Qwen3-VL-4B in field mode.
  - **Next, needs the owner's download approval:** PP-OCRv6 medium as the independent stylised-type reader, which
    reports +7 points on Paddle's "Artistic" category over v5-server (verified by thread (c)).
  - **Then on Yuri at night:** a second VLM family.
  - **Not in F-0j:** a logo detector (F-0d, C-R2) and any use of cover art for identity (owner's text-only ruling,
    F-0c). F-0j still zones the art so that text reads skip it.
- **Two hosts.** Every F-0j job kind is checkable and night-admissible (§6, §7 of the fleet plan).
  - CPU and Neural Engine kinds (line detection and line reads) fit Yojimbo by day without touching the GPU.
  - The Qwen field pass is about 1.2–1.9 h on hard crops only, or 5–8 h on every region (hypothesis). That is a
    Yuri night, or Yojimbo's GPU slot once S-1 frees it.
  - The 9B-class arms belong on Yuri only.

## 0. What we measured (evals/FR2)

| Fact | `pilot-000` | Yardstick | Source |
|---|---|---|---|
| Crop short side p10 / p50 / p90 | 76 / 140 / 270 px | 127 / 270 / 570 px | FR2 |
| Crops shrunk by the 1,600 px cap (PP-OCR, Qwen) | 6.6 % (median ×0.87) | 72 % (median ×0.69) | FR2 |
| Boxes under 64 px effective short side | 4.8 %: confirmed 4–5 % vs 12.5 % at ≥ 96 px | 1.9 % | FR2 |
| Crops with no detectable text line (detector sample) | 28.4 % (readers read text on 23.6 % of them; none confirmed) | 26.3 % | FR2 |
| `text-read` where a line ≥ 24 px exists | ≈ 98 % | ≈ 100 % | FR2 |
| Confirmed by tallest line: 24–32 / 32–48 / ≥ 48 px | 6.7 / 12.8 / 17.5 % | — / 38.9 / 26.5 % | FR2 |
| Tallest line p10 / p50 (recogniser px, upper bound on glyph height) | 33 / 59 px | 44 / 65 px | FR2 |
| All lines under 32 / 24 / 16 px | 31.6 / 14.4 / 2.2 % | 15.8 / 4.1 / 0.7 % | FR2 |
| Second-tallest line under 32 px | 26.3 % | 6.6 % | FR2 |
| Tallest over second-tallest line, median | 1.22 | 1.21 | FR2 |
| Text crops with a column line (stacked, or across the spine) | 15.0 % (outcomes no worse) | 11.2 % | FR2 |
| Contrast < 60 (Otsu class-mean distance) | 3.5 % of boxes; confirmed 2–3 % vs 12.9 % | 11.8 %; 17.6 % of the no-text pool under 45 | FR2 |
| Qwen passes with no OCR partner, of Qwen's passes | 201 / 413 (48.7 %) | 127 / 228 (55.7 %) | FR2 |
| Face-out covers: passes by Qwen / Vision / PP-OCR | 35 / 9 / 6 of 142 | — | `evals/F0c/report.md` |
| Imprint read rate; logo share; precision vs chance | 18.3 %; 27 %; 39.5 % vs 7.8 % | — | `evals/F0d/report.md` |

Three consequences follow (**hypothesis**, from the measured facts):
- Pass 2's resolution work is **per line**, aimed at small secondary lines.
- Its larger value is a **second independent reading** of hard type plus **separate fields** for the evidence model.
- Pass 1 still owns the quarter of regions with no text and the regions spanning two books.

## 1. Zoning a book region (thread a: arXiv)

- **Spine-specific work hardly zones at all.**
  - The PROXY yardstick's own paper (Llabrés et al., [arXiv 2407.19812](https://arxiv.org/abs/2407.19812)) matches
    the whole noisy spine string against title and author records. On the 2.3M-title catalog, its fuzzy baseline
    beat its BERT model (0.505 vs 0.310). It also notes that spines carry abbreviated or partial authors and
    sometimes print a series title larger than the title (**verified by threads a and d**).
  - Scanford ([arXiv 2511.19647](https://arxiv.org/abs/2511.19647)) runs Qwen2.5-VL-7B with catalog candidates in
    the prompt. Book identification went from 32 % to 72 % after fine-tuning on catalog-auto-labelled data. That
    is book-level identification, not zones (**verified by thread a**).
  - Thread (a) found no arXiv paper on separating title from author on a spine, on stacked spine text, or on spine
    imprint logos (**verified absence within its searches**; ICDAR-style venues are thin on arXiv, **hypothesis**).
- **Line detectors transfer; page layout detectors don't.**
  - DB-family detectors ([DBNet 1911.08947](https://arxiv.org/abs/1911.08947),
    [DBNet++ 2202.10304](https://arxiv.org/abs/2202.10304)) and CRAFT
    ([1904.01941](https://arxiv.org/abs/1904.01941)) handle arbitrarily oriented and extreme-aspect text
    (**verified by thread a**). PP-OCRv5's detector is DB-based and already on disk.
  - DocLayout-YOLO ([2410.12628](https://arxiv.org/abs/2410.12628)), PP-DocLayout
    ([2503.17213](https://arxiv.org/abs/2503.17213)) and LayoutLMv3 are trained on pages (**verified by thread a**).
    A 1:15 rotated strip is out of distribution (**hypothesis**).
- **VLM grounding can label lines but localises weakly.**
  - Qwen2.5-VL emits boxes ([2502.13923](https://arxiv.org/abs/2502.13923)), and Florence-2 has OCR with quad
    regions ([2311.06242](https://arxiv.org/abs/2311.06242)) (**verified by thread a**).
  - OCRBench v2 ([2501.00321](https://arxiv.org/abs/2501.00321)) finds multimodal models weak at text localisation
    (**verified by thread a**).
  - So use the VLM to **assign roles to lines a detector found**, not to find the lines (**hypothesis**).
- **Model-free role rules are untested in the literature** (**verified absence**, thread a). Our measurement says
  the size rule alone is weak: tallest over second-tallest is a median 1.22.

  Proposed priors for F-0j's rule zoner (**hypothesis**, to be fixed before its run):
  - The **title** is the line group with the largest height times length.
  - The **author** is a line that matches a catalog author's name form (surname, or initials plus surname).
  - The **imprint** is a short text line, or a non-text blob, in the outer ~15 % of the spine's length.
  - The **art** is a large non-text region with high edge density (covers mostly; F-0f's pixel probe gives edges
    already).
- **Logos** use an open-set, two-stage design in the literature: a generic logo proposal, then gallery matching with
  an image-text embedder ([1911.07440](https://arxiv.org/abs/1911.07440),
  [2309.10206](https://arxiv.org/abs/2309.10206); **verified by thread a**).
  - No public publisher-logo gallery exists (thread a open question).
  - F-0d judged a logo detector not worth it while the imprint has only 32 boxes to break.
  - **Not in F-0j.**

## 2. Resolution, rotation and tiling for thin text (thread b)

| Reader | What it needs | Source | Label |
|---|---|---|---|
| Apple Vision | `minimumTextHeight` is relative to image height, default 1/32. A spine read unrotated (2,000 px tall) would drop glyphs under about 62 px; turned to horizontal, the image height is the spine width and text clears it easily. Our helper reads at 90°/270° at full resolution and does not set it. | [Apple docs](https://developer.apple.com/documentation/vision/vnrecognizetextrequest/minimumtextheight); `helpers/ocr-vision` | verified by thread b (docs); verified (helper) |
| PP-OCRv5 recogniser | Input `[3, 48, 320]`, trained on heights 32/48/64, at most 25 characters a line. Lines under 32 px are stretched. | [PP-OCRv5 server rec config](https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/configs/rec/PP-OCRv5/PP-OCRv5_server_rec.yml) | verified by thread b |
| PP-OCR detector | `limit_type=min`, `limit_side_len=64`, `max_side_limit=4000`, `unclip_ratio=1.5` | PaddleX `OCR.yaml` | verified by thread b |
| PP-OCR orientation | Turns crops with h/w ≥ 1.5 by 90° CCW. The textline classifier knows 0° and 180° only, so stacked letters come out sideways. | PaddleX `crop_image_regions.py`; [OCR pipeline docs](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html) | verified by thread b; consequence hypothesis |
| Qwen3-VL-4B | Patch 16 × merge 2, so one token covers 32 × 32 px. Minimum 65,536 px, maximum 16.8M px. Native aspect is kept up to 200:1, so a 64 × 1,920 strip is about 120 tokens. Do not letterbox. | [preprocessor_config](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct/raw/main/preprocessor_config.json); local copy identical in `models/qwen3-vl-4b-8bit` | verified (local file); verified by thread b |
| VLM text-size cliff | Accuracy falls sharply below about 7 px text with 14 px patches (LLaVAR). By analogy, about 8 px is lost and 24–32 px is safe at 16 px patches. | [arXiv 2306.17107](https://arxiv.org/abs/2306.17107) §5.3 | verified by thread b; the 16 px analogy is hypothesis |
| InternVL-style tilers | At most 12 tiles of 448 px, so a 1:30 strip is squashed to 1:12. Use overlapping ≤ 1:10 tiles if one is ever added. | [InternVL2.5 card](https://huggingface.co/OpenGVLab/InternVL2_5-4B) | verified by thread b; distortion is hypothesis |
| Text super-resolution | On TextZoom the CRNN reader goes bicubic 26.8 % → TSRN 41.4 % → TATT 52.6 %. Perceptual (GAN or diffusion) SR invents sharp, wrong glyphs. | [TSRN 2005.03341](https://arxiv.org/abs/2005.03341); [GLYPH-SR 2510.26339](https://arxiv.org/abs/2510.26339) | verified (TSRN), snippet (numbers, GLYPH-SR) |
| Rotation correction | Gains up to +14 % on closed models and up to 4× on open-weight models. Qwen2.5-VL scores 72.6 upright, 68.2 rotated, 72.3 corrected. | [arXiv 2511.04161](https://arxiv.org/abs/2511.04161) | verified by thread b (abstract); table snippet |
| CLAHE or binarisation on modern scene-text readers | No controlled study found | — | hypothesis |

**Rules for F-0j** (**hypothesis**, from the rows above and §0):
- Cut each line from the **working copy**, never from the 1,600 px capped crop.
- Turn it to horizontal from the line's own angle.
- Scale it so the line box is **48 px** high for PP-OCR. For the VLM, the region keeps its native resolution, with the
  smallest line at ≥ 32 px or the token cap reached.
- Use bicubic or area resampling only. Generative SR may at most propose a candidate that a non-SR read must
  confirm, and it is out of F-0j v1.
- Read column lines unrotated as well; for those only, keep the best of the two orientations within the reader.

**INV-6: which variants are independent evidence** (thread b's classification, adopted):

| Counts as separate evidence | Counts once (same reader, same pixels) |
|---|---|
| A different reader (Vision, PP-OCR, the Qwen family; a second VLM family) | Re-sampling or re-prompting the same LLM on the same crop (INV-6) |
| A different photo, frame or exposure of the book | Scale jitter, CLAHE, gamma, sharpening, binarisation |
| | Super-resolved versions of the same crop |
| | CW vs CCW turns, or whole crop vs line crops, within one reader: these choose that reader's best reading, they are not a second vote |
| | Overlapping tiles of one strip: merge them into one read |

## 3. Readers for pass 2 (thread c)

Shortlist. Every row is Apache-2.0 or MIT, so it is compatible with *using* the weights in a public AGPL project
(**hypothesis**, not legal advice). The hub entries for PP-OCRv6 medium rec, Qwen3.5-9B, its `mlx-community` 4-bit
build, Florence-2-large and SigLIP2-so400m were **re-checked** for licence and size on 2026-11-03. Benchmark figures
are **verified by thread c** from the model cards.

| Role | Model | Params | Licence | Apple Silicon | Mem (4-bit, est.) | Scene / stylised text evidence | Status |
|---|---|---|---|---|---|---|---|
| Line OCR, today | PP-OCRv5 server det + rec | small | Apache-2.0 | CPU (Paddle) | < 1 GB | Our reader; "Artistic" 64.0 (thread c) | on disk |
| **Independent stylised-type reader** | [PP-OCRv6 medium](https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec) det + rec | ≈ 19M rec | Apache-2.0 (re-checked) | CPU; ONNX exports | < 0.3 GB | Weighted 83.2 vs v5-server 78.1; **"Artistic" 71.2 vs 64.0** | needs download approval |
| VLM field reader, today | Qwen3-VL-4B-Instruct 8-bit | 4B | Apache-2.0 | MLX (`mlx-vlm`) | ≈ 5 GB at 8-bit (measured, fleet plan) | Vendor claims robustness to blur and tilt; F-0c: 35 of 142 covers pass | on disk |
| VLM successor, same family | [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) ([MLX 4-bit](https://huggingface.co/mlx-community/Qwen3.5-9B-MLX-4bit)) | 9.7B | Apache-2.0 (re-checked) | MLX, `qwen3_5` arch | ≈ 6–7 GB | OCRBench 89.2, CC-OCR 79.3, RefCOCO 89.7 (4B sibling: 85.0 / 76.7 / 88.1) | Yuri; same family as Qwen3-VL, so it **replaces** the Qwen vote and never adds one (C-R2 §1.7) |
| Second VLM family | InternVL3.5-8B or Gemma 4 E4B | 8B | Apache-2.0 (thread c) | `mlx-vlm` archs listed | ≈ 5–6 GB | Not read | Yuri; a later arm |
| Zoner (alternative) | [Florence-2-large](https://huggingface.co/microsoft/Florence-2-large) | 0.78B | MIT (re-checked) | `mlx-community` builds | ≈ 0.6 GB | Quad OCR regions; stylised text weak (hypothesis) | only if the rule zoner fails |
| Logo or imprint retrieval | [SigLIP2-so400m](https://huggingface.co/google/siglip2-so400m-patch16-384), DINOv2 | 1.1B / 86M | Apache-2.0 | MLX / MPS | ≈ 1 GB | Embedding retrieval needs a gallery we don't have | not in F-0j |

**Avoid** (thread c, verified licence tags): FastVLM (Apple research licence), Moondream 3 (BUSL-1.1), Gemma 3 / 3n
(Gemma terms), Llama 3.2 Vision (EU carve-out), DINOv3 and SAM 3 (custom gated licences), MiniCPM-V-2.6 (gated, no
licence tag).

Document-only OCR VLMs report no scene-text numbers, so they are expected to underperform general VLMs on stylised
covers (**hypothesis**). These are PaddleOCR-VL, GLM-OCR, dots.ocr, olmOCR, DeepSeek-OCR and SmolDocling.

## 4. Field-structured output (thread d)

- **Ask the VLM for a transcript first, then fields that point at it.** The schema:

  ```json
  {"lines": [{"i": 0, "text": "…"}],
   "title": {"line_ids": [0], "text": "…" | null},
   "author": {"line_ids": [1], "text": "…" | null},
   "imprint": {"line_ids": [], "text": null, "from": "text" | "logo" | null},
   "unassigned": [2]}
  ```

  - A field whose text is not a substring of its own lines is rejected after parsing.
  - `null` and `unassigned` mean nothing is forced into a field.
  - Transcript-first is meant to limit both invented authors and the reasoning cost of strict JSON (**hypothesis**;
    the JSON cost is a snippet, Tam et al. 2024).
  - `mlx-vlm` ships a JSON-schema logits processor on llguidance, and its server takes `response_format`
    (**verified by thread d**: [`structured.py`](https://raw.githubusercontent.com/Blaizzy/mlx-vlm/main/mlx_vlm/structured.py)).
  - The missing-field rate and the invented-field rate trade off (snippet,
    [2509.25669](https://arxiv.org/abs/2509.25669)), so F-0j reports both.
- **OCR readers get fields from the zoner.**
  - The zoner assigns a role to each line, and each OCR reader's line reads fill those roles.
  - The zoner is shared upstream of every OCR reader, so agreement that appears only through zone reads is logged
    apart, as weaker evidence. This is the same rule as C-R2 §1.7 for a shared scorer (**hypothesis**).
- **Score each field against each candidate, Fellegi–Sunter style, with term-frequency weights.** This is C-7's
  model with fields made explicit:
  - total weight = prior + Σ log2(m/u);
  - on agreement, *u* is the catalog frequency of the matched value
    ([Splink TF guide](https://moj-analytical-services.github.io/splink/topic_guides/comparisons/term-frequency.html),
    re-checked in C-R2);
  - an unread field scores **0**, never a penalty.

  Open Library's own edition matcher weights fields separately: title exact +600, author exact +125, publisher
  +100, missing publisher 0 (**verified by thread d**:
  [`match.py`](https://github.com/internetarchive/openlibrary/blob/master/openlibrary/catalog/add_book/match.py)).

  Comparators (**hypothesis**, from Splink and Open Library):

  | Field | Comparator | Use |
  |---|---|---|
  | Author | Jaro–Winkler on the surname, with levels for compatible initials and for forename/surname swapped | rarity-weighted evidence |
  | Title | IDF-weighted token-set match over the title field only | rarity-weighted evidence |
  | Imprint | publisher key match (`src/catalog/imprint.ts`) | IMP-1 contrast only (C-R2 §3.2), never positive identity |

- **Count each field once across readers, from independent readers only.** Reader A's title and reader B's author
  count as two pieces of evidence only when A and B are independent under INV-6. A field read by several readers
  takes the best-agreeing independent reader, never a sum (**hypothesis**).
- **Field-level counter-evidence becomes explicit.** C-R2 §1.3's "a name-like run that fails the candidate's author
  list" becomes "an author field that matches none of the candidate's authors". That targets C-5's "same title,
  another author" class directly (**hypothesis**).

## 5. F-0j · Zone, read per line, emit fields (proposed card)

**Goal.** Pass 2 on pass 1's clean book regions:
- zone each region into title, author, imprint and art;
- read each text zone at its own resolution with the best-suited reader;
- emit structured fields that C-7's evidence model scores field by field.

**Entry.**
1. **F-0i merged**, or its clean regions cached. F-0j consumes whole-book regions, with not-a-book boxes dropped and
   two-book boxes split. Without F-0i it may run on F-0e's default boxes after the shipped not-a-book filter, but
   that run is labelled a stand-in, and its keep verdict does not ship.
2. **C-7 merged** for arms B and C (they need a per-field scorer). Arm A runs on whichever accept rule is shipped at
   entry.
3. **N-1's queue** takes F-0j's job kinds, and the GPU slot is free (S-1 done) or Yuri has joined (N-2).
4. The pre-registration below is committed before the first zone read.

**Do.**
1. **Zone** (`helpers/label/zone.py`, new):
   - Run PP-OCRv5's DB detector on each region, cut at native resolution with no 1,600 px cap. This gives line quads
     in working-copy pixels and a column flag.
   - Group the lines.
   - Assign roles with fixed rules (§1 priors; catalog author name forms for `author`).
   - Mark non-text blobs at the spine ends as `imprint-logo` and large high-edge areas as `art`.
   - A region with two disjoint title-sized line groups separated by a gap is flagged `multi-book` and handed back to
     pass 1, not read.
2. **Read per line.** Each line becomes a crop method `line;h=48;clip=frame`: cut from the working copy, turned
   horizontal from its own angle, and scaled to a 48 px line height.
   - Vision and PP-OCR read every text line.
   - Column lines are also read unrotated, and the best orientation is kept within the reader.
   - Each OCR reader's nomination is the better of its whole-crop read (cached) and its line reads: **one vote per
     reader**.
3. **VLM field read** (`helpers/label/fields.py`, new, so `read.py`'s helper hash and every cached `read-*` job key
   stay valid). Qwen3-VL-4B 8-bit reads the whole region at native resolution (smallest line ≥ 32 px, or the token
   cap) with the transcript-first JSON prompt of §4.
   - Decoding is constrained by `mlx-vlm`'s JSON-schema processor, at temperature 0.
   - Fields are kept only if they are substrings of the transcript.
   - The imprint may come from a logo only when the model says `from: logo` (as F-0d).
4. **Decide.**
   - Arm A uses the shipped rule on each reader's best nomination.
   - Arms B and C use C-7's evidence with title and author scored separately.
   - The imprint goes to IMP-1 (C-9) when that is merged, otherwise it is logged only.
   - The art zone is never read for identity (owner's text-only ruling, F-0c). Its crop stays private for display.

**Arms** (each against the base A0, the shipped pipeline on the same regions; judged one at a time, in order):

| Arm | Adds | Isolates |
|---|---|---|
| **A** `lines` | Zone, plus per-line Vision and PP-OCR reads; whole-string matching unchanged | resolution and orientation per line |
| **B** `fields` | A, plus zoner roles as fields, scored per field by C-7 | field structure |
| **C** `vlm-fields` | B, plus Qwen's transcript-first field read in place of its spine prompt | VLM fields |
| D (conditional) | C with PP-OCRv6 medium in place of PP-OCRv5 on lines (one PP-OCR vote either way) | an OCR reader for stylised type |

Arm D runs only after the owner approves the download and the host provisions it (fleet ruling 3).

**Keep rule (pre-registered; all must hold for an arm to ship).** Intervals are 95 % paired photo-cluster
bootstraps, 2,000 draws, with F-0b's seeds.

1. **`pilot-000` confirmed share:** the change's interval excludes 0 upward. This is machine agreement (INV-17).
2. **`pilot-000` distinct confirmed works:** the point change is ≥ 0 (H-2's works guard: more boxes confirmed must
   not mean fewer books).
3. **Yardstick:** the confirmed share does not fall beyond its interval (upper end ≥ 0), and the wrong-accept share
   does not rise beyond its interval (lower end ≤ 0).
4. **Leave one reader out (C-R2 §5):** on the arm's accepts, drop each reader in turn (with its fields) and
   re-decide. The share of accepts that switch to a **different** accepted work is ≤ 5 %, with the Wilson upper bound
   reported. Abstentions are reported, not counted against the arm (with two readers required, losing one usually
   abstains).

**Reported, not in the rule:**
- **Field metrics, per reader and per field.** On accepted boxes, the share whose title field matches the work's
  title and whose author field matches its author, each reported separately. On the yardstick, author accuracy as F-0
  defines it.
- **Invented-field rate.** An author field on a box whose zoner found no author-like line, and any field on F-0d's
  no-text control boxes.
- **Agreement that exists only through zone reads.** Logged apart (§4).
- **Strata:**
  - by smallest line height, under or over 32 px;
  - column lines against along-spine lines;
  - contrast;
  - whole boxes against cut boxes;
  - `multi-book` flags (fed back to F-0i).
- **Cost:** calls and seconds per region, per kind.

**Interaction with C-7.**
- F-0j is C-7's best input. C-7 builds per-title, per-token and per-author rarity tables; F-0j hands it the author and
  title separately.
- C-7 must therefore accept a field-tagged reading beside today's flat string. A reader with no fields keeps today's
  path, so the two coexist.
- The author field turns C-R2's name-run counter-evidence from a heuristic into a read.
- Order: C-7 first (its replay needs no new reads), then F-0j's arm A, which can run before C-7, then arms B and C.

**Interaction with F-0i.** F-0j assumes one region is one book.
- The FR2 sample shows a quarter of crops with no text line, and F-0b and H-2 showed that cut boxes lose text. Both
  are pass 1's to fix, not pass 2's.
- F-0j's `multi-book` and no-line counts per region are a free quality signal for F-0i, reported back in its eval.

**Files (proposed).**
- `helpers/label/zone.py` (new);
- `helpers/label/fields.py` (new);
- `src/perceive/crop.ts` (the `line` crop method and its name);
- `src/perceive/zones.ts` (new, pure role rules);
- `src/eval/f0j.ts` and `src/eval/f0j-cli.ts` (new);
- `src/run/` handlers for the job kinds in §6;
- `contracts/helpers/ocr-response.schema.json`: an optional `fields` object, a contract change under OC13, made by
  F-0j;
- C-7's `src/catalog/` field evidence (C-7's files);
- `evals/F0j/`, `docs/machine-labelling.md` and `CONTEXT.md`.

**Caches it invalidates.**
- **Not invalidated:** F-0's, F-0e's and F-0c's reading caches. Line reads carry a new crop method name, so they are
  never mixed with whole-crop reads (F-0b's rule). `read.py` is untouched, so the `read-ppocr` and `read-qwen` job
  keys stand.
- **Invalidated if an arm ships:**
  - every cached **decision** (F-0's decisions, F-0c's `base-decisions`, the before arms in F-0b and H-2) and
    everything built from decisions;
  - Q-2 and Q-2b's teacher labels;
  - U-4's decided cache under `private/u4/`;
  - F-0g's copy groups (the series guard reads reader text);
  - F-0h's anchors;
  - C-4's gap counts;
  - F-0d's imprint cache, superseded by the imprint field for C-9;
  - **Qwen's hard-crop selection**, which changes once more boxes are OCR-agreed.
- Arm C's field reads live in their own file and never overwrite `qwen.jsonl`.

**Exit.** The keep rule per arm, the reported measures, and a private review page of zones and fields under
`private/f0j/`. Aggregates only in the repo.

**Tier (suggested):** T2 · M–L · Medium (new helper and contract field) · budget 80.

## 6. Run plan for two hosts

Totals cover both sets: 7,277 regions (6,145 `pilot-000`, 1,132 yardstick) and about 17,700 text lines (FR2 found
2.2 lines a crop on `pilot-000` and 3.7 on the yardstick). Only the line detector's speed is measured (FR2, on
capped crops). Every other time and memory figure is a **hypothesis**, scaled from F-0, F-0c and the fleet plan's
§3, until N-1's morning report measures it.

| `bookcase jobs` kind | Bound | Peak memory | Per unit | Total, both sets | Yojimbo (48 GB, busy) | Yuri (64 GB, nights and idle) | Night (§7) |
|---|---|---|---|---|---|---|---|
| `zone-det` (PP-OCRv5 DB, native resolution) | CPU | ≈ 1–2 GB per worker | 0.28–0.34 s measured on capped crops; ≈ 0.5 s at native resolution | ≈ 35–60 CPU-min | yes, at `nice`, by day | yes | **yes** |
| `read-vision-line` | Neural Engine / GPU, light | small | ≈ 0.05–0.1 s a line (F-0: 0.13 s a whole crop) | ≈ 15–30 min | yes | yes | **yes** |
| `read-ppocr-line` (rec + 0/180 classifier) | CPU | ≈ 1–2 GB per worker | ≈ 0.05–0.15 s a line | ≈ 15–45 CPU-min | yes | yes | **yes** |
| `read-fields-qwen` (Qwen3-VL-4B 8-bit, JSON, ≤ 200 tokens) | GPU (MLX) | ≈ 5–6 GB | ≈ 2.5–4 s a region (F-0c: 1.8 s at 96 tokens) | hard crops (1,708): 1.2–1.9 h; every region: 5–8 h | only in the GPU slot (S-1 holds it today) | **preferred** for every region | **yes** |
| `decide-fields` (catalog replay, C-7 evidence) | CPU, disk | small | — | ≈ 15–30 min (U-4: about 15 min for one `pilot-000` decide) | yes (holds the catalog) | after `rsync` of the catalog | **yes** |
| `render-f0j` (private zones page) | CPU | small | seconds a photo | minutes | yes | yes | **yes** |
| `read-ppocr6-line` (arm D) | CPU | < 1 GB | as `read-ppocr-line` | ≈ 15–45 CPU-min | yes | yes | **yes**, once the weights are on the host by hash |
| `read-fields-qwen35-9b` (successor arm, replaces the Qwen vote) | GPU (MLX) | ≈ 7–9 GB | ≈ 4–7 s a region | hard: 2–3.3 h; all: 8–14 h | no (memory and GPU contention) | **yes** | **yes**, once provisioned |
| `read-fields-vlm2` (second VLM family) | GPU (MLX) | ≈ 6–8 GB | ≈ 4–6 s a region | hard: 2–3 h | no | **yes** | **yes**, once provisioned |

- **Today (Yuri not joined; owner setup pending, fleet plan §10).**
  - Arm A's kinds (`zone-det`, `read-vision-line`, `read-ppocr-line`, `decide-fields`) run on Yojimbo with no GPU, by
    day at `nice` or in a night window: about 1–2 h in all.
  - `read-fields-qwen` on hard crops takes Yojimbo's GPU slot for about 1.2–1.9 h after S-1.
- **With Yuri.** One night does F-0j's whole read: the CPU and Neural Engine kinds first, then `read-fields-qwen` over
  every region. Yojimbo keeps `decide-fields`, the analysis and the renders by day, next to the catalog.
- **Night admission.** Each kind has a deterministic success check: output schema, hash, and substring-checked fields
  for the VLM at temperature 0. So once F-0j's pre-registration is merged, the plan is admissible at night
  (§7: I0–I1, R0, V0–V1).
- **Day shift only:**
  - approving new weights (PP-OCRv6, Qwen3.5-9B, a second VLM family) and each host provisioning them itself
    (ruling 3);
  - the keep verdict and the merge;
  - any change to the pre-registration.
- **Never split across hosts:** nothing here is rate-limited. All runs are local, with no API calls.

## 7. Not verified, and caveats

- **Model releases after the author's knowledge.** Qwen3.5, PP-OCRv6 and Gemma 4 come from thread (c). This doc
  re-checked their hub entries (existence, licence, size), not their benchmark tables.
- **The line heights are detector box heights,** an upper bound on glyph height (DB unclip). The thresholds in §2
  speak of glyph or line heights from the sources, so the "under 32 px" shares here are conservative: the real
  shares are larger (**hypothesis**).
- **How much the author field lifts accepts** is unmeasured until arm B runs. The upper bound on boxes it could reach
  is the no-catalog-match and single-reader pools with a readable second line.
- **Whether zoning beats whole-string matching at all** is open. Llabrés et al. did not zone and found plain fuzzy
  matching the most robust at 2.3M titles. Arm A is designed to answer this before the field arms.
- **The INV-6 independence of a shared zoner** is a judgement (§4), not a measurement. Arm reports log zone-only
  agreement apart.
- **Times and memory in §6** are estimates until N-1's morning report measures them.

## Sources

Threads' primary sources are linked inline. Repo sources:
- `evals/F0/report.md`, `evals/F0b/report.md`, `evals/F0c/report.md`, `evals/F0d/report.md`, `evals/H2/report.md`;
- `evals/FR2/report.md` (this card);
- `docs/catalog/identification-research.md` (C-R2);
- `docs/ops/compute-fleet.md`;
- `helpers/label/read.py`, `helpers/ocr-vision`, `src/perceive/crop.ts`.
