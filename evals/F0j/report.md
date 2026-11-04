# F0j: zone, read per line, emit fields (F-0j)

## Pre-registration (committed before the first zone read)

Fixed 2026-11-04, before any region was zoned, any line was read or any field was emitted. Nothing below is changed
after seeing a result; any change is logged as a deviation in `implementation-notes.md`, and the report says which
figures it touches. The design is [`docs/models/per-book-extraction.md`](../../docs/models/per-book-extraction.md)
§5 (F-R2), with its run plan §6.

**Question.** Does pass 2 (zone each book region into text lines, read each line at its own resolution, and emit
title and author as separate fields) confirm more books than reading the whole region as one string, without more
wrong accepts? And do the fields carry the author evidence the open catalog's switch is waiting on?

**Sets, never merged (OC35).**

- **`pilot-000`**: 31 real-use photos. The regions are **F-0i's partition**: its kept boxes (5,761 of Q-2b's 6,121
  kept ids; dropped boxes are not regions and are not read), each region its detection rectangle, since F-0i's
  refit box did not ship (`evals/F0i`). F-0i's label maps say which pixels each kept box owns. The whole-crop
  readers are the ones F-0e cached. Every figure is **machine agreement, never accuracy** (INV-17). A dev set (OC11).
- **Yardstick (PROXY)**: the 40-image Library Dataset sample, F-0's B2 boxes, F-0i's partition (1,040 kept boxes),
  F-0's cached readers. *Confirmed* = accepted and annotated in the image; *wrong* = accepted, not annotated
  (C-5's `isAnnotated`, as F-0i). Evaluation only: never trained or tuned on (OC35).

No hand labels (OC36). Nothing is trained. Box ids (`photo:index`) are F-0i's, never renumbered.

**Looked at before fixing the rules (disclosed).** Nothing from a run of this card. F-R2's measurement (`evals/FR2`:
line heights, column share, the tallest-over-second ratio) is public and informed §1's priors; every threshold below
is F-R2's prior or a round number set here. The code is debugged on synthetic regions (the tests) and smoke-run on
the first `pilot-000` photo in input order for crashes only; any threshold change after that is a logged deviation.

### Zoning (`helpers/label/zone.py`, CPU; roles in `src/perceive/zones.ts`, pure)

1. **Region crop.** The whole-crop polygon (below), perspective-warped to an upright rectangle at native resolution
   (no 1,600 px cap), turned so the spine's long axis runs left to right (90° for an upright crop, 0° for a wide
   one): the **reading frame**, *x* along the spine, *y* across it.
2. **Lines.** PP-OCRv5's server DB detector (`PP-OCRv5_server_det`, on disk, CPU), PaddleX defaults (`limit_type`
   min, `limit_side_len` 64, `max_side_limit` 4,000, `unclip_ratio` 1.5). Each line quad is mapped back to
   working-copy pixels. Per line: height (minimum-area rectangle short side, working-copy px), length, angle, and
   the **column** flag (its quad's *y* extent over 1.5 × its *x* extent in the reading frame, F-R2's definition).
   A quad with a short side under 4 px or an area under 64 px² is noise and dropped.
3. **Neighbour lines.** A line is dropped when over **50 %** of its quad's pixels are owned by another kept box in
   F-0i's label map (text of the next book). Counted per region.
4. **Groups.** Two lines join one group when, in the reading frame, their *y* extents overlap by at least 50 % of the
   smaller height, their heights are within a factor 1.5, and the gap along *x* is at most 1.5 × the larger height.
   Column lines group only with column lines. A group's **size** is the sum of its lines' height × length.
5. **Roles** (one per group, in this order):
   - **title**: the largest group;
   - **multi-book**: the region is flagged when another group has at least **0.6 ×** the title's size, its *y*
     extent does not overlap the title's, and the gap between them across the spine is at least **1.0 ×** the larger
     of the two groups' heights. A flagged region is handed back to pass 1 and **not read** by pass 2 (it keeps its
     whole-crop reads in every arm);
   - **author**: a group whose text in **any** OCR reader's line reads matches a catalog author name form: a run of
     two or three of its tokens equals a normalised author form (given-first or surname-first) in the set's catalog,
     or the group has at most three tokens and its last token is a catalog author surname that the catalog holds on
     at least half as many works as an author surname as it holds on works with that word in a title form. The
     largest such group (ties: first in reading order);
   - **imprint**: a group lying wholly in the outer **15 %** of the spine's length at either end, with size at most
     **0.5 ×** the title's;
   - every other group: **unassigned**.
6. **Non-text zones (reported only, never read for identity).** On a grey-level Canny map (thresholds 0.66 and
   1.33 × the region's median grey) with the line quads dilated by one line height and masked out:
   - **imprint-logo**: an end (outer 15 % of the length) whose unmasked edge density is at least **0.08**;
   - **art**: a run of along-axis windows (side = the region's height, step half of it) each with edge density at
     least **0.12** and under 10 % of the window masked as text, covering at least 15 % of the region's length.
   The art zone is never read for identity (owner's text-only ruling, F-0c); its crop stays private for display.
7. **Contrast** per region: F-R2's Otsu class-mean distance on the region scaled to a 64 px short side.

A region with **no line** left after steps 2–3 is not read by pass 2. No-line and multi-book counts per region are
reported back to F-0i.

### Line reads (`line;h=48;clip=frame`)

- Each kept line of a read region is cut from the **working copy** (never the 1,600 px capped crop), its long axis
  horizontal in the reading frame's direction, scaled so the line's height is **48 px** (bicubic up, area down,
  plain resampling only, never generative super-resolution), with an 8 px margin of the photo's own pixels around it.
  The cells are laid out losslessly in private per-photo mosaics (at most 200 cells a page), and the readers cut each
  cell as a rectangle, so `read.py` and the Vision helper are unchanged (their cached `read-*` job keys stand).
- **Vision** and **PP-OCR** read every line at 0° and 180°; a column line also at 90° and 270° (its unrotated view).
  Within a reader these choose that reader's best reading, they are not votes (INV-6).
- **A reader's nomination is one vote** (INV-6): its whole-crop reading's variants plus three line variants, in one
  catalog retrieval (the catalog picks, as it picks a rotation today):
  1. every line at 0°, in reading order (groups top to bottom across the spine, then left to right);
  2. every line at 180°, in the reverse order;
  3. every line at its own most confident rotation, in reading order.

### Whole-crop readers and Qwen

- The whole-crop polygon and rotations are F-0's cached crop (`rect;rot=fixed`, the crop F-0e's cached readings and
  H-2's `base-decisions` were read with), so A0 is the shipped pipeline's own readings, unchanged.
- **Qwen's hard-crop selection is re-run in every arm and in A0** by F-0's procedure on F-0i's kept boxes: per photo,
  the boxes whose first pass (Vision and PP-OCR only, under that arm's rule) is hard and has text, highest box score
  first, capped at 40 (`pilot-000`) or 15 (yardstick). A selected box missing a cached Qwen spine read is read; a box
  not selected never contributes a Qwen reading.

### Arms (each against A0, judged one at a time, in order)

| Arm | Readers | Decision |
|---|---|---|
| **A0** | cached whole-crop Vision and PP-OCR; Qwen's spine prompt on A0's selection | F-0's `decide`, shipped catalog bar, catalog v1 (yardstick: its inventory catalog) |
| **A** `lines` | A0 plus line reads in each OCR reader's nomination; Qwen's spine prompt on A's selection | as A0: whole-string matching unchanged |
| **B** `fields` | A, plus zoner roles as fields for each OCR reader | per field (below) |
| **C** `vlm-fields` | B, with Qwen's transcript-first field read in place of its spine prompt, on B's selection | per field, Qwen's own fields |
| D (conditional) | C with PP-OCRv6 medium in place of PP-OCRv5 on lines | as C. Runs only if the conductor and the owner approve the download; otherwise reported **not run** |

**Fields (arms B and C).** A reader's **title field** is its text of the title group's lines, its **author field**
its text of the author group's lines (each line at the rotation that reader's nomination won with, else its most
confident one); no author group, no author field. Qwen's fields in arm C are its own (below). With the reader's
ranked candidates (retrieval over its arm-A variants, depth 50, C-6's depth), each candidate is also scored on the
fields alone by retrieval's own scorer (`scoreWorks` on title field plus author field): field score, field title
evidence, field coverage, and the author field's author evidence. Then, per reader:

1. **Whole-string path**: if its top candidate passes F-0's bar on the whole string, that is its confirmation (as A).
2. **Field path**: otherwise, the candidate with the highest field score confirms if it passes F-0's bar *on the
   fields* (field score ≥ 0.72, field title evidence ≥ 0.8, field coverage ≥ 0.5) and no candidate of another book
   ties its field score (to 0.01).
3. **Author counter-evidence (a read, C-R2 §1.3, C-7's author kind)**: a confirmation is withdrawn when the reader has
   an author field, the confirmed work's authors explain it below 0.5, and another book in the reader's ranked 50
   (C-6's `sameBook`) explains it at 0.5 or more.

The vote is F-0's (two readers, one work, uniquely); the catalog is the shipped default (v1), with no lookalike guard
and no rarity basis, as shipped. Each field is counted once per reader; a field read by several readers is not summed.
The imprint field is logged only (C-9 is not merged).

**Qwen field read (`helpers/label/fields.py`, new; arm C).** Qwen3-VL-4B-Instruct 8-bit (MLX), the whole region on
the whole-crop polygon at native resolution scaled so its smallest kept line is at least 32 px (no upscale for a
region without lines), never above a cap of 1,024 visual tokens (1,048,576 px; a larger region is scaled down to the
cap), at 90° and 270° like its spine read. One transcript-first prompt; decoding constrained by `mlx-vlm`'s
JSON-schema processor (llguidance), temperature 0, at most 256 new tokens; the schema is per-book-extraction.md §4's
(`lines`, `title`, `author`, `imprint` with `from`, `unassigned`), at most 12 lines. After parsing, a field whose text
is not a substring (case and whitespace folded) of its own lines' text is **rejected** (set to null, counted); an
output that is not valid JSON (truncated) is an error and the read gives Qwen no vote on that rotation. Qwen's
whole-string variants are its transcript lines joined; its fields enter rules 2–3 as above. The imprint may come
from a logo only when the model says `from: logo` (as F-0d), and is logged only. Outputs go to their own file, never
`qwen.jsonl`.

### Keep rule (per arm; all must hold for an arm to ship)

Intervals are 95 % paired photo-cluster bootstraps, 2,000 draws, F-0b's seeds (`delta`; distinct works seed 61, as
F-0i). Shares are over every region of the set (F-0i's kept boxes), A0 → arm.

1. **`pilot-000` confirmed share:** the change's interval excludes 0 upward (lower end above 0). Machine agreement.
2. **`pilot-000` distinct confirmed works** (per photo, summed): the point change is at least 0 (H-2's works guard).
3. **Yardstick:** the confirmed share's change has its upper end at least 0, and the wrong-accept share's change has
   its lower end at most 0.
4. **Leave one reader out (C-R2 §5):** on the arm's accepts in each set, drop each reader in turn (with its line reads
   and fields; the zoner's author role recomputed from the remaining readers' text) and re-decide. The share of
   (accept, dropped reader) cases that switch to a **different accepted work** is at most **5 %** on each set (point
   estimate; Wilson 95 % upper bound reported). Abstentions are reported, not counted against the arm.

If an arm passes, its decision rule becomes F-0's default for book regions (the conductor merges and schedules the
re-baselines in per-book-extraction.md §5 "Caches it invalidates"). If several pass, the one with the larger
`pilot-000` confirmed change is recommended.

### Reported, not in the rule

- **Author-field coverage**, explicitly: regions with an author group; per reader, the share with an author field; on
  accepted boxes, the share whose author field matches the accepted work's author (author evidence ≥ 0.5), and whose
  title field matches its title (title evidence ≥ 0.8); on the yardstick, F-0's author accuracy (accepted labels
  whose author is annotated in the image).
- **The v2 switch question** (C-6, C-7): on `catalog-v2.sqlite` with C-7's `c7` basis, per arm, C-7's K3 (`pilot-000`
  confirmed against v1, paired) and K1b (yardstick wrong per spine against v1's bound 1.05 %), and how many of C-7's
  namesake withdrawals the arm's author field turns into a read surname. C-3's golden queries are text fixtures with no
  photo, so F-0j cannot change C-7's K5 (golden c075, c079 are bare titles); the report says so rather than claim it.
- **Invented-field rate:** an author field (any reader) on a region whose zoner found no author-like line; any Qwen
  field on F-0d's no-text control boxes (60 `pilot-000`, 40 yardstick); rejected (non-substring) Qwen fields.
- **Agreement only through pass 2:** accepts where an agreeing reader's confirmation needs its line variants or the
  field path (its whole-crop reading alone would not confirm that work), logged apart as weaker evidence (§4).
- **Strata:** smallest line under 32 px against at least 32; regions with a column line against none; contrast under
  60 against at least 60; whole boxes against cut or partial ones (F-0b's `piece`); multi-book and no-line regions.
- **Quality signal for F-0i:** multi-book and no-line counts per set, neighbour-dropped lines, and which F-0i roles
  (member, remainder, group child; changed, flagged) they fall on.
- **Cost:** calls and seconds per region, per kind (`zone-det`, `read-vision-line`, `read-ppocr-line`,
  `read-qwen` re-selection, `read-fields-qwen`, decide).
