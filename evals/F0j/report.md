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

### Addendum: arm C on a `pilot-000` subsample (fixed 2026-11-04, before any arm C result on `pilot-000`)

The conductor capped arm C's `pilot-000` field reads at about 45 minutes of GPU (the full selection is about 4 h), after
arms A and B had run on both sets and arm C on the yardstick. Every arm already fails rule 3 on the yardstick, so no
pilot figure can change a verdict; this only bounds what is reported.

- **Subsample:** 6 of the 31 `pilot-000` photos, drawn by a seeded shuffle of the photo ids (`rng(20261104)` from
  `src/eval/q1.ts`, the first 6 after sorting by draw). Their 240 regions in arm B's Qwen selection are read (39 were
  read before the cap); F-0d's no-text control boxes are read only where they fall in these photos.
- **Arm C on `pilot-000` is decided and reported on these 6 photos only** (every region of the 6 photos, against A0
  on the same regions), labelled as a subsample, with photo-cluster intervals over 6 clusters (wide by construction).
  Qwen author-field coverage is reported on the same subsample.
- Arm C's verdict rests on the yardstick (all 40 photos), where it was run in full.

## Verdict (run 2026-11-04, after the pre-registration above): a negative result

Aggregates are in [`metrics.json`](metrics.json); the tables below the marker are generated by
`src/eval/f0j-cli.ts analyse`. `pilot-000` figures are machine agreement, never accuracy (INV-17); the two sets are
reported apart (OC35).

**No arm ships. Every arm fails rule 3: the yardstick's wrong accepts rise beyond their interval.** Pass 2 confirms
more books on both sets, and more of them wrong on the yardstick.

| arm | `pilot-000` confirmed (rule 1) | `pilot-000` works (rule 2) | yardstick confirmed | **yardstick wrong (rule 3)** | leave one reader out (rule 4) | keep |
|---|---|---|---|---|---|---|
| A `lines` | +3.9 (2.7 to 5.1) ✓ | 631 → 830 ✓ | +4.9 (2.9 to 7.2) ✓ | **+0.7 (0.2 to 1.3) ✗** | 0 of 2,084 / 0 of 738 ✓ | **off** |
| B `fields` | +4.6 (3.3 to 5.8) ✓ | 631 → 868 ✓ | +8.9 (6.3 to 11.4) ✓ | **+2.7 (1.5 to 4.0) ✗** | 0 of 2,159 / 0 of 866 ✓ | **off** |
| C `vlm-fields` | +3.7 (2.0 to 5.9) ✓, 6-photo subsample | 166 → 212 on the subsample ✓ | +7.1 (4.6 to 9.6) ✓ | **+2.3 (1.2 to 3.5) ✗** | 0 of 534 / 0 of 797 ✓ | **off** |
| D (PP-OCRv6 medium) | not run: no download was requested or approved | | | | | **not run** |

Points of the set's regions, A0 → arm, 95 % paired photo-cluster intervals. Wrong accepts on the yardstick: A0 22 of
269 accepts (8.2 %), A 29 of 327 (8.9 %), B 50 of 390 (12.8 %), C 46 of 367 (12.5 %). The shipped pipeline is
unchanged: F-0's whole-crop readers, `decide` and catalog bar, `rect;rot=fixed;clip=frame`.

## Findings

1. **Line reads find real text the whole-crop reads miss.** On `pilot-000`, arm A adds 3.9 points of confirmed
   regions and about 200 distinct works (machine agreement). Of A's 954 accepts, 276 rest on an agreeing reader whose
   whole-crop reading alone would not confirm the work. The lift holds in every stratum, including lines under 32 px
   (+5.5) and cut or partial boxes (+4.2). On the yardstick the lift is +4.9 points of *correct* accepts.
2. **Where arm A's wrong accepts come from.** 7 new yardstick wrong accepts, all of them needing the line
   variants. 4 are another book by an author annotated in the same image, 2 share a title word with an annotated
   book, 1 neither. A line read gives a clean author line and a partial title, and the whole-string matcher then
   prefers that author's other book. That is the "same author, another book" class C-5 and C-7 describe, now reached
   through better author reads.
3. **Where arms B and C's wrong accepts come from: the field path, through a shared zoner.** B adds 28 new wrong
   accepts: 22 through a reader's field-path vote, 6 through line variants. C adds 24: 20 and 4. In both arms 23 of
   them are Vision and PP-OCR agreeing. The two OCR readers read the *same* zoner-cut lines and fill the *same*
   roles, so when the zoner hands both a short title group (a series line, a word of the title), both readers' fields
   point at the same wrong book. Per-design §4 called agreement through a shared zoner weaker evidence; this run
   measures it. Field-path agreement between two OCR readers is not INV-6 independent in practice.
4. **The author field rarely withdraws a wrong accept.** The author counter-evidence withdrew 28 (Vision) and 17
   (PP-OCR) reader votes on `pilot-000` and 12 and 10 on the yardstick, but no wrong A0 accept disappears in any
   arm. Author accuracy (F-0's yardstick measure) falls from 92.6 % to 88.5 % (B) and 88.6 % (C).
5. **Leave one reader out never switches an accept to another work** (0 of 2,159 cases at most, Wilson upper bound
   0.2–0.7 %); losing one of the two agreeing readers abstains, as expected with two readers required. So rule 4
   cannot tell correlated readers from independent ones, and finding 3 is the measure that does.
6. **Zoning is cheap and consistent with F-R2.** 0.38 s a region on the CPU (`pilot-000`, contended host), no
   errors. 28.3 % of regions on both sets have no text line (F-R2's sample: 28.4 % and 26.3 %). 2.0 kept lines a
   region on `pilot-000` and 2.9 on the yardstick; 30 % of `pilot-000`'s kept lines are under 32 px.
7. **Qwen's field read.** On the regions it read, Qwen writes an author field on 74.2 % (67.1–81.3 %, 6 photo
   clusters, the declared subsample) of `pilot-000` and 68.0 % (60.4–75.1 %, 40 clusters) of yardstick regions.
   On accepts its author field matches the work 94 % of the time on both sets. But 7 % of rotations
   (`pilot-000` subsample, 34 of 480) and 9 % (yardstick, 74 of 782) ran past 256 tokens. The substring check rejected 95 title fields
   of 480 rotations. And on F-0d's no-text control boxes in the subsample (where F-0's readers read nothing), Qwen
   transcribed lines on 11 of 12 and named a title on 10. Without labels, reading text the OCR readers missed cannot
   be told from inventing a transcript. The substring check cannot catch an invented transcript, because the fields
   point at Qwen's own lines.
8. **The reported-only non-text zones are loose.** The `art` rule fires on 21 % of `pilot-000` regions and
   `imprint-logo` on most ends. Painted, textured spines clear an edge density of 0.12. On library spines the
   `imprint` role often lands on a library sticker. Neither feeds identity; both need a calibrated rule before any
   use.

## The author-field question (the v2 switch)

C-6 lost six golden titles and C-7 one (two on v2) for lack of author evidence. The v2 view (generated table below)
re-decides A0, A and B on `catalog-v2.sqlite` with C-7's `c7` basis.

- **The golden losses cannot move.** C-3's golden queries are text fixtures with no photo, so no pass-2 read reaches
  them; c075 and c079 are bare common-word titles. C-7's K5 fails exactly as before, so **neither arm B nor arm C
  closes the golden gap**, and nothing here supports switching the default to v2 on its own.
- **On the photos, the author evidence comes from the line reads, not from the field structure.** Of A0's 530
  `pilot-000` reader votes that C-7's namesake test withdraws on v2 (no surname read), arm A turns 23 into
  confirmations, because a line read carries the author's line into the whole string. Arm B, with the zoner's author
  field, turns 20 (yardstick: 1 and 1 of 26).
- **Arm A alone clears the two conditions C-7's switch failed, on this data.** On v2 with the `c7` basis it confirms
  +6.5 points of `pilot-000` regions against v1's A0 (3.7 to 9.6; C-7's K3 needs the lower end above 0). Its
  yardstick wrong rate is 0.67 % a region (0.11–1.27 %), under v1's bound of 1.05 % (K1b), with 29 right accepts
  against A0's 26. Arm B does not: 2.79 % wrong (1.38–4.14 %).
- **This is a post-hoc reading, not a pass.** The view was reported, not ruled; C-5's judge is C-7's on another
  region set (F-0i's partition, re-run Qwen selection); A0 itself scores −1.4 points here (−3.9 to 1.5), where C-7 had
  +1.35 (−0.55 to 3.54) on F-0's 6,894 boxes. And K5 still fails. The next step is a fresh pre-registration of "line
  reads plus `c7` on v2", with K5 resolved by an owner ruling on title-only golden refusals (C-7's "what would close
  the gap", item 3).
- **Arm C was not re-decided on v2:** its `pilot-000` reads are a 6-photo subsample under the GPU cap. Qwen does
  write an author field on about 70 % of the regions it reads (finding 7), and that field matches the accepted work's
  author 94 % of the time. That is the strongest author signal measured here, but it comes from the reader whose
  transcripts the no-text control cannot vouch for.

## Quality signal for F-0i

- **Multi-book regions are rare:** 13 of 5,761 on `pilot-000` and 10 of 1,040 on the yardstick, so the partition
  hands pass 2 almost no two-book boxes that its line geometry can see.
- **No-line regions** (1,631 and 294) fall mostly on unchanged members (1,113 and 216). On `pilot-000`, 56 are F-0i
  group children and 42 are remainders; per-role counts are in the generated tables.
- **Neighbour text:** 1,511 of 12,929 detected `pilot-000` lines (11.7 %) and 654 of 3,682 on the yardstick (17.8 %)
  lie mostly on pixels another kept box owns. The shipped crop rectangle still holds a neighbour's lettering, and the
  partition's label map is what removes it here.

## Caches

Nothing ships, so no cache is invalidated: F-0's, F-0e's and F-0c's readings and decisions, Q-2/Q-2b, U-4, F-0g,
F-0h, C-4 and F-0d stand. `read.py` is untouched, so the `read-*` job keys are valid. F-0j's own caches are private
under the data root's `private/f0j/<set>/`: `zones/` (lines, neighbour shares, edge profiles), `mosaics/` (line
cells), `lines/` (Vision and PP-OCR line reads, `line;h=48;clip=frame`), `whole/` (Qwen spine reads for re-selected
regions), `fields/` (Qwen field reads), per-arm `decisions.jsonl` and `selection.jsonl`, `v2/`, and the review pages
under `private/f0j/renders/`.

## Limits

- **Arm C on `pilot-000` is a 6-photo subsample** (declared before its results were read). Its intervals are over 6
  clusters, and its verdict rests on the yardstick.
- **Arm D was not run**: PP-OCRv6 medium would need a download, which was not requested.
- **The yardstick is a PROXY** (library shelves, a closed 15,229-book inventory, Catalan and Spanish). Its wrong
  accepts are counts in the tens, and every interval is wide.
- **`pilot-000` is machine agreement.** Its gains are not known to be right; the yardstick says some are not.
- **The zoner's author role reads the shipped catalog's name forms.** It found an author group on only 17–22 % of
  read regions, while Qwen writes an author on about 70 % of what it reads. So the OCR readers' author fields are
  limited by the zoner, not by what is printed.

<!-- generated by src/eval/f0j-cli.ts analyse: edit above this line -->

## Zoning, both sets

| figure | `pilot-000` | yardstick (PROXY) |
|---|---:|---:|
| regions (F-0i kept boxes) / zoned / errors | 5761 / 5761 / 0 | 1040 / 1040 / 0 |
| lines detected / a neighbour's (dropped) / noise (dropped) | 12929 / 1511 / 1 | 3682 / 654 / 0 |
| lines kept / per region | 11418 / 1.98 | 3028 / 2.91 |
| kept lines under 32 px / column lines | 3440 / 1076 | 83 / 268 |
| **no-line regions** (not read) | 1631 (28.3 %) | 294 (28.3 %) |
| **multi-book regions** (handed back, not read) | 13 (0.2 %) | 10 (1.0 %) |
| regions read by pass 2 / groups per read region | 4117 / 2.08 | 736 / 2.72 |
| art zones / imprint-logo ends (reported only) | 1212 / 4428 | 14 / 91 |
| zone-det seconds per region (p50) / total | 0.382 / 2500 | 0.458 / 566 |

Quality signal for F-0i (regions by F-0i role):

- pilot-000: no-line group-child, changed 9; group-child 47; member, changed, flagged 36; member, changed 384; member 1113; remainder, changed, flagged 4; remainder, changed 38. Multi-book member, changed 2; member 11.
- yardstick-library-b2: no-line group-child, changed 7; group-child 24; member, changed, flagged 4; member, changed 28; member 216; remainder, changed 15. Multi-book member, changed 1; member 6; remainder, changed 3.

## pilot-000: arm `a` against A0 (real use (OC35): machine agreement, never accuracy (INV-17))

5761 regions. Shares in % of them, A0 → arm (Δ points; 95 % paired photo-bootstrap interval).

| regions | n | photos | text read | confirmed |
|---|---:|---:|---|---|
| **all** | 5761 | 31 | 78.5 → 79 (+0.4; 0.2 to 0.7) | 12.6 → 16.6 (+3.9; 2.7 to 5.1) |
|   read by pass 2 | 4117 | 31 | 98.2 → 98.8 (+0.6; 0.3 to 1) | 17.4 → 22.9 (+5.5; 4 to 6.9) |
|   not read (no line or multi-book) | 1644 | 31 | 29.3 → 29.3 (+0; 0 to 0) | 0.6 → 0.6 (+0; 0 to 0) |
|   smallest line < 32 px | 1735 | 31 | 98.6 → 98.9 (+0.3; 0 to 0.9) | 15.9 → 21.4 (+5.5; 3.4 to 7.5) |
|   smallest line ≥ 32 px | 2382 | 31 | 97.9 → 98.7 (+0.8; 0.4 to 1.2) | 18.6 → 24.1 (+5.5; 4 to 6.9) |
|   with a column line | 512 | 28 | 100 → 100 (+0; 0 to 0) | 17.6 → 21.9 (+4.3; 1.8 to 7) |
|   no column line | 3605 | 31 | 97.9 → 98.6 (+0.7; 0.3 to 1.1) | 17.4 → 23.1 (+5.7; 4.2 to 7.1) |
|   contrast < 60 | 96 | 26 | 96.9 → 96.9 (+0; 0 to 0) | 6.3 → 9.4 (+3.1; 0 to 8.9) |
|   contrast ≥ 60 | 4021 | 31 | 98.2 → 98.8 (+0.6; 0.3 to 1) | 17.7 → 23.3 (+5.5; 4 to 7) |
|   whole boxes | 3638 | 31 | 84.2 → 84.7 (+0.5; 0.2 to 0.8) | 13.4 → 17.1 (+3.8; 2.4 to 5.2) |
|   cut or partial boxes | 2123 | 31 | 68.8 → 69.1 (+0.3; 0.1 to 0.7) | 11.4 → 15.6 (+4.2; 2.4 to 5.7) |

Distinct confirmed works (per photo, summed): 631 → 830 (+199; 126 to 278).

Accepts: 954; through pass 2 only (an agreeing reader's whole-crop reading alone would not confirm the work): 276.
Leave one reader out: 2084 (accept, reader) cases; same work 176, **another work 0 (0.0 %; Wilson upper 0.2 %)**, abstains 1908.
Line reads: Vision 24880 calls, 1592 s; PP-OCR 24880 calls, 3974 s. Qwen-selected regions: 1224 → 1220.

## pilot-000: arm `b` against A0 (real use (OC35): machine agreement, never accuracy (INV-17))

5761 regions. Shares in % of them, A0 → arm (Δ points; 95 % paired photo-bootstrap interval).

| regions | n | photos | text read | confirmed |
|---|---:|---:|---|---|
| **all** | 5761 | 31 | 78.5 → 79 (+0.4; 0.2 to 0.7) | 12.6 → 17.3 (+4.6; 3.3 to 5.8) |
|   read by pass 2 | 4117 | 31 | 98.2 → 98.8 (+0.6; 0.3 to 1) | 17.4 → 23.9 (+6.5; 4.9 to 8) |
|   not read (no line or multi-book) | 1644 | 31 | 29.3 → 29.3 (+0; 0 to 0) | 0.6 → 0.6 (+0; 0 to 0) |
|   smallest line < 32 px | 1735 | 31 | 98.6 → 98.9 (+0.3; 0 to 0.9) | 15.9 → 23.2 (+7.3; 5.1 to 9.4) |
|   smallest line ≥ 32 px | 2382 | 31 | 97.9 → 98.7 (+0.8; 0.4 to 1.2) | 18.6 → 24.5 (+5.9; 4.5 to 7.3) |
|   with a column line | 512 | 28 | 100 → 100 (+0; 0 to 0) | 17.6 → 22.7 (+5.1; 2 to 8.3) |
|   no column line | 3605 | 31 | 97.9 → 98.6 (+0.7; 0.3 to 1.1) | 17.4 → 24.1 (+6.7; 5.1 to 8.1) |
|   contrast < 60 | 96 | 26 | 96.9 → 96.9 (+0; 0 to 0) | 6.3 → 10.4 (+4.2; 0 to 10.4) |
|   contrast ≥ 60 | 4021 | 31 | 98.2 → 98.8 (+0.6; 0.3 to 1) | 17.7 → 24.2 (+6.5; 5 to 8) |
|   whole boxes | 3638 | 31 | 84.2 → 84.7 (+0.5; 0.2 to 0.8) | 13.4 → 17.9 (+4.6; 3.1 to 6.2) |
|   cut or partial boxes | 2123 | 31 | 68.8 → 69.1 (+0.3; 0.1 to 0.7) | 11.4 → 16.2 (+4.8; 3.1 to 6.1) |

Distinct confirmed works (per photo, summed): 631 → 868 (+237; 157 to 323).

Accepts: 995; through pass 2 only (an agreeing reader's whole-crop reading alone would not confirm the work): 337.
Leave one reader out: 2159 (accept, reader) cases; same work 169, **another work 0 (0.0 %; Wilson upper 0.2 %)**, abstains 1990.
Line reads: Vision 24880 calls, 1592 s; PP-OCR 24880 calls, 3974 s. Qwen-selected regions: 1224 → 1220.

**Author-field coverage.** Of 4117 regions read by pass 2, the zoner found an author group on **877 (21.3 %)** and a title group on 4117.

| reader | regions | title field | author field | field-path confirmations | author counter-evidence withdrawals | accepts: title field matches the work | accepts: author field matches the work |
|---|---:|---:|---:|---:|---:|---|---|
| vision | 5761 | 3655 | 865 | 59 | 28 | 694/963 (72.1 %) | 256/307 (83.4 %) |
| ppocr | 5761 | 3816 | 860 | 76 | 17 | 619/970 (63.8 %) | 215/306 (70.3 %) |
| qwen | 1220 | 0 | 0 | 0 | 0 | 0/0 (0.0 %) | 0/0 (0.0 %) |

## pilot-000: arm `c` against A0 (real use (OC35): machine agreement, never accuracy (INV-17))

**Declared subsample (conductor's GPU cap): 6 photos, 1530 regions; intervals over 6 photo clusters.** 1530 regions. Shares in % of them, A0 → arm (Δ points; 95 % paired photo-bootstrap interval).

| regions | n | photos | text read | confirmed |
|---|---:|---:|---|---|
| **all** | 1530 | 6 | 80.7 → 81.2 (+0.5; 0.1 to 1) | 12.5 → 16.2 (+3.7; 2 to 5.9) |
|   read by pass 2 | 1112 | 6 | 97.8 → 98.5 (+0.6; 0.1 to 1.6) | 16.7 → 21.9 (+5.1; 2.6 to 8.1) |
|   not read (no line or multi-book) | 418 | 6 | 35.2 → 35.2 (+0; 0 to 0) | 1.2 → 1.2 (+0; 0 to 0) |
|   smallest line < 32 px | 498 | 6 | 97.6 → 98.2 (+0.6; 0 to 2.2) | 13.5 → 18.3 (+4.8; 1.5 to 9.5) |
|   smallest line ≥ 32 px | 614 | 6 | 98 → 98.7 (+0.7; 0 to 1.8) | 19.4 → 24.8 (+5.4; 2.9 to 8.2) |
|   with a column line | 96 | 6 | 100 → 100 (+0; 0 to 0) | 20.8 → 21.9 (+1; -3.9 to 6.8) |
|   no column line | 1016 | 6 | 97.6 → 98.3 (+0.7; 0.1 to 1.7) | 16.3 → 21.9 (+5.5; 3 to 8.4) |
|   contrast < 60 | 32 | 6 | 100 → 100 (+0; 0 to 0) | 12.5 → 9.4 (-3.1; -13 to 0) |
|   contrast ≥ 60 | 1080 | 6 | 97.8 → 98.4 (+0.6; 0.1 to 1.6) | 16.9 → 22.2 (+5.4; 2.9 to 8.2) |
|   whole boxes | 939 | 6 | 85.1 → 85.5 (+0.4; 0 to 1.3) | 12.8 → 15.5 (+2.8; 1.5 to 5.3) |
|   cut or partial boxes | 591 | 6 | 73.8 → 74.3 (+0.5; 0 to 1.2) | 12 → 17.3 (+5.2; 1.9 to 8.5) |

Distinct confirmed works (per photo, summed): 166 → 212 (+46; 25 to 70).

Accepts: 248; through pass 2 only (an agreeing reader's whole-crop reading alone would not confirm the work): 78.
Leave one reader out: 534 (accept, reader) cases; same work 38, **another work 0 (0.0 %; Wilson upper 0.7 %)**, abstains 496.
Line reads: Vision 24880 calls, 1592 s; PP-OCR 24880 calls, 3974 s. Qwen-selected regions: 1224 → 240.

**Author-field coverage.** Of 1112 regions read by pass 2, the zoner found an author group on **192 (17.3 %)** and a title group on 1112.

| reader | regions | title field | author field | field-path confirmations | author counter-evidence withdrawals | accepts: title field matches the work | accepts: author field matches the work |
|---|---:|---:|---:|---:|---:|---|---|
| vision | 1530 | 981 | 188 | 6 | 3 | 172/237 (72.6 %) | 57/64 (89.1 %) |
| ppocr | 1530 | 1016 | 189 | 17 | 2 | 159/240 (66.3 %) | 47/64 (73.4 %) |
| qwen | 240 | 175 | 178 | 7 | 3 | 29/29 (100.0 %) | 32/34 (94.1 %) |

**Qwen author-field coverage:** 74.2 % of the regions it read (67.1 %–81.3 %, 6 photo clusters).

Qwen field read: 240 regions, 480 rotations, 34 not valid JSON; rejected (not in its own lines) title 95, author 32, imprint 142; imprint from a logo 244. **Invented-field checks:** an author field where the zoner found no author line on 136 of 178 regions with a Qwen author field; any field on F-0d's no-text control 13 of 14. 1915 s, median 180 visual tokens.

## yardstick-library-b2: arm `a` against A0 (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

1040 regions. Shares in % of them, A0 → arm (Δ points; 95 % paired photo-bootstrap interval).

| regions | n | photos | text read | confirmed | wrong |
|---|---:|---:|---|---|---|
| **all** | 1040 | 40 | 75.1 → 75.2 (+0.1; 0 to 0.3) | 23.8 → 28.7 (+4.9; 2.9 to 7.2) | 2.1 → 2.8 (+0.7; 0.2 to 1.3) |
|   read by pass 2 | 736 | 40 | 99.6 → 99.7 (+0.1; 0 to 0.4) | 33 → 39.9 (+6.9; 4.3 to 9.9) | 3 → 3.9 (+1; 0.3 to 1.7) |
|   not read (no line or multi-book) | 304 | 39 | 15.8 → 15.8 (+0; 0 to 0) | 1.3 → 1.3 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) |
|   smallest line < 32 px | 53 | 22 | 98.1 → 100 (+1.9; 0 to 6.7) | 15.1 → 26.4 (+11.3; 4.5 to 17.2) | 1.9 → 1.9 (+0; 0 to 0) |
|   smallest line ≥ 32 px | 683 | 40 | 99.7 → 99.7 (+0; 0 to 0) | 34.4 → 41 (+6.6; 3.9 to 9.5) | 3.1 → 4.1 (+1; 0.3 to 1.9) |
|   with a column line | 85 | 37 | 100 → 100 (+0; 0 to 0) | 28.2 → 35.3 (+7.1; 2.4 to 12.5) | 4.7 → 4.7 (+0; 0 to 0) |
|   no column line | 651 | 40 | 99.5 → 99.7 (+0.2; 0 to 0.5) | 33.6 → 40.6 (+6.9; 4.1 to 9.9) | 2.8 → 3.8 (+1.1; 0.3 to 1.9) |
|   contrast < 60 | 31 | 24 | 93.5 → 93.5 (+0; 0 to 0) | 51.6 → 51.6 (+0; 0 to 0) | 3.2 → 3.2 (+0; 0 to 0) |
|   contrast ≥ 60 | 705 | 40 | 99.9 → 100 (+0.1; 0 to 0.4) | 32.2 → 39.4 (+7.2; 4.6 to 10.4) | 3 → 4 (+1; 0.3 to 1.8) |
|   whole boxes | 720 | 40 | 88.5 → 88.5 (+0; 0 to 0) | 30.6 → 37.2 (+6.7; 4.1 to 9.5) | 2.9 → 3.8 (+0.8; 0.1 to 1.6) |
|   cut or partial boxes | 320 | 32 | 45 → 45.3 (+0.3; 0 to 1.2) | 8.4 → 9.4 (+0.9; 0 to 2.2) | 0.3 → 0.6 (+0.3; 0 to 1) |

Accepts: 327; through pass 2 only (an agreeing reader's whole-crop reading alone would not confirm the work): 94.
Leave one reader out: 738 (accept, reader) cases; same work 84, **another work 0 (0.0 %; Wilson upper 0.5 %)**, abstains 654.
Line reads: Vision 6460 calls, 358 s; PP-OCR 6460 calls, 1029 s. Qwen-selected regions: 468 → 422.

**Where the new wrong accepts come from** (regions A0 did not accept wrongly; 0 of A0's wrong accepts are gone): 7 new. Route: a reader's field-path vote 0, pass-2 line variants needed 7, whole-crop agreement (Qwen re-selection) 0. Agreeing readers: qwen+vision 2, ppocr+qwen 2, ppocr+vision 3. Kind: another book by an author annotated in the image 4, shares a title word with an annotated book 2, neither 1.

Author accuracy (F-0's: accepted labels whose author's surname is annotated in the image): 92.6 % (249/269) → 93.0 % (304/327).

## yardstick-library-b2: arm `b` against A0 (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

1040 regions. Shares in % of them, A0 → arm (Δ points; 95 % paired photo-bootstrap interval).

| regions | n | photos | text read | confirmed | wrong |
|---|---:|---:|---|---|---|
| **all** | 1040 | 40 | 75.1 → 75.2 (+0.1; 0 to 0.3) | 23.8 → 32.7 (+8.9; 6.3 to 11.4) | 2.1 → 4.8 (+2.7; 1.5 to 4) |
|   read by pass 2 | 736 | 40 | 99.6 → 99.7 (+0.1; 0 to 0.4) | 33 → 45.7 (+12.6; 9.4 to 15.7) | 3 → 6.8 (+3.8; 2.2 to 5.5) |
|   not read (no line or multi-book) | 304 | 39 | 15.8 → 15.8 (+0; 0 to 0) | 1.3 → 1.3 (+0; 0 to 0) | 0 → 0 (+0; 0 to 0) |
|   smallest line < 32 px | 53 | 22 | 98.1 → 100 (+1.9; 0 to 6.7) | 15.1 → 34 (+18.9; 5.1 to 28.6) | 1.9 → 7.5 (+5.7; 0 to 15) |
|   smallest line ≥ 32 px | 683 | 40 | 99.7 → 99.7 (+0; 0 to 0) | 34.4 → 46.6 (+12.2; 9 to 15.4) | 3.1 → 6.7 (+3.7; 2 to 5.4) |
|   with a column line | 85 | 37 | 100 → 100 (+0; 0 to 0) | 28.2 → 42.4 (+14.1; 7.5 to 22.9) | 4.7 → 10.6 (+5.9; 0 to 12.8) |
|   no column line | 651 | 40 | 99.5 → 99.7 (+0.2; 0 to 0.5) | 33.6 → 46.1 (+12.4; 8.8 to 16.1) | 2.8 → 6.3 (+3.5; 1.9 to 5.4) |
|   contrast < 60 | 31 | 24 | 93.5 → 93.5 (+0; 0 to 0) | 51.6 → 48.4 (-3.2; -10.7 to 0) | 3.2 → 3.2 (+0; 0 to 0) |
|   contrast ≥ 60 | 705 | 40 | 99.9 → 100 (+0.1; 0 to 0.4) | 32.2 → 45.5 (+13.3; 9.8 to 16.6) | 3 → 7 (+4; 2.3 to 5.9) |
|   whole boxes | 720 | 40 | 88.5 → 88.5 (+0; 0 to 0) | 30.6 → 42.8 (+12.2; 9 to 15.4) | 2.9 → 6.1 (+3.2; 1.8 to 4.8) |
|   cut or partial boxes | 320 | 32 | 45 → 45.3 (+0.3; 0 to 1.2) | 8.4 → 10 (+1.6; 0.3 to 3.2) | 0.3 → 1.9 (+1.6; 0.3 to 3.6) |

Accepts: 390; through pass 2 only (an agreeing reader's whole-crop reading alone would not confirm the work): 167.
Leave one reader out: 866 (accept, reader) cases; same work 88, **another work 0 (0.0 %; Wilson upper 0.4 %)**, abstains 778.
Line reads: Vision 6460 calls, 358 s; PP-OCR 6460 calls, 1029 s. Qwen-selected regions: 468 → 391.

**Where the new wrong accepts come from** (regions A0 did not accept wrongly; 0 of A0's wrong accepts are gone): 28 new. Route: a reader's field-path vote 22, pass-2 line variants needed 6, whole-crop agreement (Qwen re-selection) 0. Agreeing readers: qwen+vision 3, ppocr+qwen 2, ppocr+vision 23. Kind: another book by an author annotated in the image 11, shares a title word with an annotated book 8, neither 9.

Author accuracy (F-0's: accepted labels whose author's surname is annotated in the image): 92.6 % (249/269) → 88.5 % (345/390).

**Author-field coverage.** Of 736 regions read by pass 2, the zoner found an author group on **164 (22.3 %)** and a title group on 736.

| reader | regions | title field | author field | field-path confirmations | author counter-evidence withdrawals | accepts: title field matches the work | accepts: author field matches the work |
|---|---:|---:|---:|---:|---:|---|---|
| vision | 1040 | 713 | 164 | 69 | 12 | 312/384 (81.3 %) | 86/89 (96.6 %) |
| ppocr | 1040 | 725 | 164 | 70 | 10 | 253/385 (65.7 %) | 81/89 (91.0 %) |
| qwen | 391 | 0 | 0 | 0 | 0 | 0/0 (0.0 %) | 0/0 (0.0 %) |

## yardstick-library-b2: arm `c` against A0 (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

1040 regions. Shares in % of them, A0 → arm (Δ points; 95 % paired photo-bootstrap interval).

| regions | n | photos | text read | confirmed | wrong |
|---|---:|---:|---|---|---|
| **all** | 1040 | 40 | 75.1 → 75.2 (+0.1; 0 to 0.3) | 23.8 → 30.9 (+7.1; 4.6 to 9.6) | 2.1 → 4.4 (+2.3; 1.2 to 3.5) |
|   read by pass 2 | 736 | 40 | 99.6 → 99.7 (+0.1; 0 to 0.4) | 33 → 43.2 (+10.2; 6.9 to 13.2) | 3 → 6.3 (+3.3; 1.7 to 4.9) |
|   not read (no line or multi-book) | 304 | 39 | 15.8 → 15.8 (+0; 0 to 0) | 1.3 → 1 (-0.3; -1.1 to 0) | 0 → 0 (+0; 0 to 0) |
|   smallest line < 32 px | 53 | 22 | 98.1 → 100 (+1.9; 0 to 6.7) | 15.1 → 28.3 (+13.2; 0 to 22.2) | 1.9 → 7.5 (+5.7; 0 to 15) |
|   smallest line ≥ 32 px | 683 | 40 | 99.7 → 99.7 (+0; 0 to 0) | 34.4 → 44.4 (+10; 6.9 to 13.1) | 3.1 → 6.1 (+3.1; 1.7 to 4.7) |
|   with a column line | 85 | 37 | 100 → 100 (+0; 0 to 0) | 28.2 → 41.2 (+12.9; 5.1 to 22.5) | 4.7 → 10.6 (+5.9; 0 to 12.8) |
|   no column line | 651 | 40 | 99.5 → 99.7 (+0.2; 0 to 0.5) | 33.6 → 43.5 (+9.8; 6.2 to 13.6) | 2.8 → 5.7 (+2.9; 1.5 to 4.7) |
|   contrast < 60 | 31 | 24 | 93.5 → 93.5 (+0; 0 to 0) | 51.6 → 48.4 (-3.2; -10.7 to 0) | 3.2 → 3.2 (+0; 0 to 0) |
|   contrast ≥ 60 | 705 | 40 | 99.9 → 100 (+0.1; 0 to 0.4) | 32.2 → 43 (+10.8; 7.5 to 14.1) | 3 → 6.4 (+3.4; 1.9 to 5.3) |
|   whole boxes | 720 | 40 | 88.5 → 88.5 (+0; 0 to 0) | 30.6 → 40.3 (+9.7; 6.3 to 13.1) | 2.9 → 5.6 (+2.6; 1.4 to 4) |
|   cut or partial boxes | 320 | 32 | 45 → 45.3 (+0.3; 0 to 1.2) | 8.4 → 9.7 (+1.2; 0 to 2.8) | 0.3 → 1.9 (+1.6; 0.3 to 3.6) |

Accepts: 367; through pass 2 only (an agreeing reader's whole-crop reading alone would not confirm the work): 154.
Leave one reader out: 797 (accept, reader) cases; same work 64, **another work 0 (0.0 %; Wilson upper 0.5 %)**, abstains 733.
Line reads: Vision 6460 calls, 358 s; PP-OCR 6460 calls, 1029 s. Qwen-selected regions: 468 → 391.

**Where the new wrong accepts come from** (regions A0 did not accept wrongly; 0 of A0's wrong accepts are gone): 24 new. Route: a reader's field-path vote 20, pass-2 line variants needed 4, whole-crop agreement (Qwen re-selection) 0. Agreeing readers: qwen+vision 1, ppocr+vision 23. Kind: another book by an author annotated in the image 8, shares a title word with an annotated book 8, neither 8.

Author accuracy (F-0's: accepted labels whose author's surname is annotated in the image): 92.6 % (249/269) → 88.6 % (325/367).

**Author-field coverage.** Of 736 regions read by pass 2, the zoner found an author group on **164 (22.3 %)** and a title group on 736.

| reader | regions | title field | author field | field-path confirmations | author counter-evidence withdrawals | accepts: title field matches the work | accepts: author field matches the work |
|---|---:|---:|---:|---:|---:|---|---|
| vision | 1040 | 713 | 164 | 69 | 12 | 296/362 (81.8 %) | 80/82 (97.6 %) |
| ppocr | 1040 | 725 | 164 | 70 | 10 | 247/363 (68.0 %) | 76/82 (92.7 %) |
| qwen | 391 | 263 | 266 | 30 | 14 | 55/57 (96.5 %) | 48/51 (94.1 %) |

**Qwen author-field coverage:** 68.0 % of the regions it read (60.4 %–75.1 %, 40 photo clusters).

Qwen field read: 391 regions, 782 rotations, 74 not valid JSON; rejected (not in its own lines) title 108, author 45, imprint 147; imprint from a logo 502. **Invented-field checks:** an author field where the zoner found no author line on 206 of 266 regions with a Qwen author field; any field on F-0d's no-text control 1 of 33. 4375 s, median 748 visual tokens.

## The v2 switch view (reported, not in the rule)

`catalog-v2.sqlite` with C-7's `c7` basis (all four counter-evidence kinds), each arm on its v1 Qwen selection. `pilot-000`: confirmed share against v1's A0, paired (C-7's K3 needs the lower end above 0). Yardstick: wrong accepts per region, judged by C-5's `isAnnotated` (C-7's K1b bound is v1's 1.05 %).

| set | arm | accepts | K3: confirmed vs v1 A0 (points) | K1b: wrong per region | counter-evidence (reader votes withdrawn) | A0's namesake withdrawals / turned into a confirmation |
|---|---|---:|---|---|---|---|
| pilot-000 | a0 | 645 | 12.6 → 11.2 (-1.4; -3.9 to 1.5) | — | namesake 530, author 93, unexplained 11, language 6 | 530 / 0 |
| pilot-000 | a | 1101 | 12.6 → 19.1 (+6.5; 3.7 to 9.6) | — | author 247, namesake 888, unexplained 10, language 3 | 530 / 23 |
| pilot-000 | b | 1121 | 12.6 → 19.5 (+6.8; 4 to 10.1) | — | author 283, namesake 946, unexplained 12, language 3 | 530 / 20 |
| yardstick-library-b2 | a0 | 33 | — | 0.67 % (0.11 %–1.27 %); 7 wrong, 26 right | namesake 26, author 4, language 3, unexplained 1 | 26 / 0 |
| yardstick-library-b2 | a | 36 | — | 0.67 % (0.11 %–1.27 %); 7 wrong, 29 right | namesake 29, author 9, language 4, unexplained 1 | 26 / 1 |
| yardstick-library-b2 | b | 63 | — | 2.79 % (1.38 %–4.14 %); 29 wrong, 34 right | namesake 53, author 33, language 2, unexplained 5 | 26 / 1 |

## Verdict

| arm | pilot confirmed up | pilot works not down | yardstick confirmed not down | yardstick wrong not up | leave one reader out ≤ 5 % | keep |
|---|---|---|---|---|---|---|
| a | yes | yes | yes | no | yes | **off** |
| b | yes | yes | yes | no | yes | **off** |
| c | yes | yes | yes | no | yes | **off** |
