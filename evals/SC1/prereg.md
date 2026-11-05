# SC1: shelf-context reader — pre-registration

Fixed 2026-11-04, before any full-set run and before any reader output was looked at. Nothing below changes after
seeing a result. Any change is logged as a deviation in `implementation-notes.md`, and the report
(`evals/SC1/report.md`) says which figures it touches. The constants live in `src/eval/sc1.ts` (`SC1`, `LEXICON`) and
`src/eval/sc1-cli.ts` (`KEEP`) at this commit.

**Question.** A store tells its customers what its shelves hold: section and end-cap signs, genre strips on the shelf
edge ("alphabetical by author"), letter tabs between authors, row labels. F-0h reads only F-0f's `shelf-strip` boxes,
which cover 5 of 320 `pilot-000` rows and 0 of 90 yardstick rows on RB-1's box set. Can a naive few-shot reader of the
non-book regions (no per-store training) give many more rows a **shelf context** (genre, ordering, letter range), and
does that context agree with the books the readers already confirmed, beyond chance?

**Sets, never merged (OC35).** Both on RB-1's box set (F-0i's partition less NB-3's `on-lip` boxes; `loadBoxSet`).

- **`pilot-000`** (31 real-use photos, F-0e's `bands+strips` boxes): every figure is **machine agreement, never
  accuracy** (INV-17).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample with F-0's B2 boxes, its inventory catalog. Evaluation
  only: nothing is tuned on it.

No hand labels (OC36). Nothing is trained. No box, outline, reading or decision of an earlier card is changed.
**Confirmed books** are F-0's `readers-agree` accepts (`f0c/<set>/base-decisions.jsonl`, the base F-0h reads); context
and copy bases are left out, so no measure reads F-0h's own output. **Rows** are F-0h's (`buildRows` on the set's
book boxes, keys `<photo>|<k>`), so a record lands on exactly the row F-0h reads.

**Looked at before fixing this text (disclosed).** One `pilot-000` photo was run once through a full-photo PP-OCR
pass and once through the Vision line pass, to time them (317 s and 29 s; 58 and 35 lines). Only those counts and
timings were looked at, never a line's text or position. The caches' fields and row counts were read; no image or crop
was looked at.

## The reader

### Regions and text detection

- **Painted out:** every spine-kind box (F-0c's and F-0f's kinds, covers off) except NB-3's `on-lip` boxes: the kept
  books and F-0i's dropped pieces of them. Text on books is never read.
- **Text lines (GPU, ANE):** `helpers/ocr-vision` product `ocr-vision-lines` on the painted photo: square tiles of
  2,048 px overlapping by 256, `VNRecognizeTextRequest` `.accurate`, language correction off, en-US; a line found in
  two tiles is kept once (the more confident). Each line keeps its quad and Vision's text and confidence. This reaches
  every non-book region: not-a-book boxes (F-0c, F-0f, NB-3's `on-lip`), S-1's lip, F-0i's partition gaps and
  signage that never became a box.
- **Second reader (CPU):** PP-OCRv5 server (`read.py --reader ppocr`) reads the crop of every line whose Vision text
  has a letter, the quad padded by 15 % of its height on every side, rotation 0.
- **Not-a-book boxes:** each one with cached reader text (F-0's Vision, PP-OCR and, where it ran, Qwen readings of the
  box) is a unit of its own; per reader, the variant whose class ranks first (promotion, price, ordering, letter,
  section, other) stands for it.
- **Region of a line** (first that holds): `not-a-book` (its centre inside a not-a-book box), `lip` (at least 50 % of
  its quad on S-1's lip label, `private/s1/<set>/maps`), `gap` (its centre inside a row's span between its boxes' tops
  and bottoms: a partition gap or something standing in the row), `free` (anywhere else).

### Classes (`classify`, `combine`)

Each reader's text is classed by the lexicon (`LEXICON` in `src/eval/sc1.ts`) into one of **section**, **ordering**
rule, **letter** range or divider, **promotion** or talker, **price**, **other**:

1. **Promotion** first: F-0f's talker patterns plus sale, % off, bestsellers, new releases, staff picks, recommends,
   awards and winners, signed, book club, featured, coming soon, pre-order, buy-N, gifts, bargains, favourites,
   must-reads, top N. **Price**: a currency sign before a digit, or `d.dd`. Neither carries any field.
2. **Ordering**: alphabetical by author (F-0f's strip wording; "alphabetical by author/surname", "arranged/sorted/
   shelved/filed by author", "by author").
3. **Letter**: a whole text that is a range (`A - C`, `Ma to Mc`: one capital, optionally one lower-case letter, each
   end), or a range inside a text that also names a section or ordering or has at most three words; or a whole text
   that is one capital (optionally one lower-case letter): a **divider**.
4. **Section**: the first matching family of 13 (`sf-fantasy`, `sf`, `fantasy`, `horror`, `mystery`, `romance`,
   `young-adult`, `children`, `graphic`, `poetry-drama`, `classics`, `nonfiction`, `literature`), its wording kept.

A text may carry a section and an ordering or range together; its class is the first that applies in the order above.

**Readers combined per unit:** any reader reading a promotion or price **vetoes** the unit (never evidence). The class
is the one most readers give; a tie goes to ordering, then letter, then section. Two local readers naming different
classes drop the unit (`disagree`) unless Qwen's vote breaks the tie. A **divider needs two readers on the same
letter**. Confidence: the agreeing readers' mean confidence, times 0.5 when only one reader gives the class; a unit
under 0.3 is dropped.

**Qwen few-shot, only where needed** (`needsQwen`): a line whose two local readers disagree on the class (neither
reading a promotion or price), or only one of them names a class, or neither does although a reader's text has at
least 4 letters. At most **12 lines per photo on `pilot-000` and 6 on the yardstick**, largest quad first. Qwen3-VL-4B
8-bit reads the padded crop with the fixed few-shot prompt `QWEN_SIGN_PROMPT` in `helpers/label/read.py` (eight
examples, one per class, answer `KIND | TEXT`); its KIND is its vote and its TEXT is classed by the lexicon for the
fields (a section the lexicon cannot map keeps Qwen's wording, family none). Not-a-book boxes get no new Qwen read.

### Scope (`scopeOf`) and the record (`rowContext`)

- A **divider** marks a surname boundary at its x in the row nearest along y whose x-span holds it, within one row
  height (the row above wins a tie).
- Text **on the lip**, in a **strip-like box** (`shelf-strip`, `flat-strip`, `spans-books`, `on-lip`), or that F-0h's
  `stripLabels` places just below a row, **covers that row**.
- Text inside a row's span covers that row.
- Anything else is an **end-cap or header sign** and **covers its case**: rows below it whose centre x lies within its
  x-span widened by one sign width each side.

Per row, the **shelf context** record (`ShelfContext`, a superset of F-0h's `RowContext`): genre (wording and family),
ordering, letter range, dividers, source (`sc1:<region>:<scope>`), confidence (the best contributing unit's). Each
field comes from a row-level cue before a case-level one, then the more confident. Promotions, talkers and prices
never reach a record.

### Arms

- **`sc1`**: Vision + PP-OCR + Qwen few-shot where needed. **`sc1-no-qwen`**: the same without Qwen. Both are reported.
- **Main arm:** `sc1` when Qwen read every selected line inside the GPU budget, else `sc1-no-qwen` (the fallback).
- **Baseline:** F-0h's strip adapter (`stripContext`), its figures as RB-1 left them in `evals/F0h/metrics.json`.

## Measures (label-free, each set reported apart)

Shuffle controls: 1,000 permutations, seed 20261104, one-sided p (share of permutations at or above the real value).
Intervals on real values: 95 % photo-cluster bootstrap, 2,000 draws, seed 20261104.

- **M1 coverage:** the share of rows with a shelf context (any of genre, ordering, letter range, divider), against
  the baseline's rows labelled. Reported beside it: rows per field, per source and per genre family, photos with any
  context, units by region and class, drops by reason, scoped and unscoped cues, Qwen lines.
- **M2 letter agreement:** over (confirmed book, letter cue) pairs in rows with a cue: a range agrees when the
  primary author's surname (`surnameKey`) lies in it by prefix (as many letters as the bound); a divider agrees when a
  book left of it files before its letter and a book right of it at or after. **Control:** ranges permuted among the
  rows that hold one, and divider letters among all dividers of the set (positions kept).
- **M3 order agreement:** the in-order share of consecutive confirmed pairs (F-0h's `orderPairs` rule) in rows whose
  record has an ordering rule. **Control:** the ordering mark permuted among rows with at least one pair. Reported
  beside it: the in-order share in unmarked rows.
- **M4 section agreement:** over (confirmed book with known facets, row family) pairs: the work's catalog facets
  (ISFDB tags, `ttype`, `non_genre`, `graphic`; `workFamilies`) agree with the row's family (`familyAgrees`;
  `sf-fantasy` takes either, `literature` and `classics` take each other). A work with no facet is left out.
  **Control:** families permuted among rows that hold one.
- **M5 F-0h v2 check:** `node src/eval/f0h-cli.ts analyse --row-context sc1` (the flag is off by default) against the
  default run: every F-0h decision (basis and work) per box, `confirmed-by-context` counts, rows set ordered, and the
  hidden-reader hypothesis check (top-1, top-5, bracket top-1). Its outputs go to `private/sc1/f0h-v2/`, never
  `evals/F0h/`.

## Keep rule: wiring SC-1 into F-0h v2 (report only; promotion is a later card)

SC-1's adapter is **recommended** to replace F-0h's strip adapter in F-0h v2 when all hold, on the main arm:

- **K1 coverage:** `pilot-000` rows with a shelf context ≥ the baseline's rows labelled + 10.
- **K2 evidence:** on `pilot-000`, M2 or M4 is measured (at least 20 pairs) and its real value exceeds its shuffle p95.
- **K3 no contradiction:** on both sets, every measured M2, M3 and M4 (at least 20 pairs) is at least its shuffle
  mean.
- **K4 never a confirmer:** M5 shows no F-0h decision changed on either set, and no promotion or price unit reached a
  record.

Otherwise it is **not recommended**. Either way nothing in F-0h's default changes in this card; KN-2 reads the
section signal later.

## GPU budget and fallback

Before each GPU step (`lines`, `qwen`): `pgrep` for any running mlx, torch, Qwen or Vision helper job (Fleet Runner
`read-qwen` included); if one runs, wait. The conductor is told when the GPU work is done.

- **Budget: 60 GPU-minutes for the card**, both sets. Expected: Vision lines about 15 min on `pilot-000` and 10 on the
  yardstick; Qwen at most 612 crops, about 15 min.
- **Order:** yardstick lines, `pilot-000` lines, then Qwen (yardstick, `pilot-000`).
- **Fallback to Vision and PP-OCR only:** if Qwen cannot run inside what is left of the budget, or another job holds
  the GPU for more than an hour, the main arm is `sc1-no-qwen` and the report says so. If the Vision line pass itself
  cannot finish, SC-1 is reported on the not-a-book boxes' cached readings alone and K1–K3 are read on that.

## Private outputs

The data root's `private/sc1/<set>/`: `lines.jsonl` (quads, Vision text), `ppocr.jsonl`, `lip.jsonl`, `qwen.jsonl`,
`units*.jsonl` (per unit: region, class, cue, scope inputs), `rows.jsonl` (the main arm's records, read by F-0h's
flag) and `rows-no-qwen.jsonl`; `private/sc1/gpu.jsonl` (GPU seconds per step); `private/sc1/f0h-v2/` (M5). Only
aggregates reach the repo (`evals/SC1/report.md`, `metrics.json`).
