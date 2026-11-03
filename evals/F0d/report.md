# F0d: imprint read (F-0d)

Card F-0d, 2026-11-03. **Question:** if the vision-language reader also reports a spine's publisher or imprint
(as text, or recognised from a logo), does using it as a **tie-breaker** against the catalog editions' publishers
lift identification without adding wrong accepts? The owner asked for this on 2026-11-03 (a Tor logo at a shelf
photo's edge would have identified that book). An imprint is a clue, never identity on its own. Cover-out books are
out of scope (F-0c).

Two sets, never merged (OC35): **`pilot-000`** (31 real-use photos, B2 boxes; every figure is **machine agreement,
never accuracy**, INV-17) and the **yardstick (PROXY)**, F-0's 40-image Library Dataset sample with B2 boxes, where
`confirmed` means accepted *and* annotated in the image and `wrong` means accepted but not annotated. No hand
labels (OC36); nothing was trained or tuned on the yardstick. Aggregates only: per-box reads and the review page
stay in the data root's `private/f0d/`.

## Answer first

- **The tie-break does not ship (off).** It changed no outcome on either set: confirmed +0 points (0 to 0) on the 32
  `pilot-000` boxes it could act on, and the yardstick has **no** such box, so wrong accepts cannot rise there.
  The keep rule's first clause fails.
- **Why nothing moved:** the rule can only choose between candidates two readers already pass, and F-0's bar
  leaves almost no such ambiguity. Only **32 of 6,894** `pilot-000` boxes (0.5 %) and **0 of 1,132** yardstick boxes
  are *reorderable*. Five of the 32 got an imprint; on all five it named a house **none** of the passing candidates'
  editions carry, so it could not separate them. Even a perfect imprint reader would change at most those 32
  `pilot-000` boxes.
- **The imprint itself is a real clue.** Imprint read rate on `pilot-000`: **18.3 %** (14.9–21.5) of read boxes,
  19.5 % (13.9–23.7) on confirmed ones. Precision on confirmed boxes, against any edition's house: **39.5 %**
  (20.7–54.4; 15/38), against a chance level of 7.8 %. Logos are **27.3 %** of imprint reads; logo precision 46.2 %
  (6/13), text 36.0 % (9/25). Where it matches, the imprint keeps a median 44 % of the work's editions: it narrows
  the edition, not the work.
- **Invented imprints are rare:** 1 of 60 `pilot-000` and 0 of 40 yardstick boxes with no text got one.
- **C-4's not-in-ISFDB books:** **8 of 22** carry a readable imprint, so publisher data from Open Library could be
  used as evidence for them once it is imported.
- **Logo detector: not recommended.** Logos are common (27 % ≥ 25 %) and as precise as text, so two of the three
  pre-registered conditions hold. But the reader's misses cannot be counted without labels, and the binding limit is
  not the reader: the tie-break has 32 boxes to act on. A detector would raise a read rate that today buys nothing.
  Revisit if imprint evidence enters retrieval or adjudication itself (below).

## Method (pre-registered)

This section was committed before the first imprint read. Constants live in `src/eval/f0d-cli.ts` (`SELECT`,
`REGISTRANT`), `src/eval/f0d.ts` (`TIE_K`) and `src/catalog/imprint.ts` (`GENERIC`, `ALIASES`, `PARENT`, `CLUB`);
`metrics.json` echoes them.

### 1. The imprint read

A separate reader variant, `helpers/label/imprint.py`: Qwen3-VL-4B-Instruct 8-bit (MLX, local, the same weights as
F-0's R2), cut exactly as F-0's readers cut a crop, with the shipped crop method (`rect;rot=fixed;clip=frame`) at
both rotations. The prompt asks for JSON (`title`, `author`, `imprint`, `imprint_from`: `text` or `logo`, or null)
and says to report an imprint only if it is visible on the spine, never inferred from the title, the author or
memory. It writes to its own file, so F-0's cached `qwen` reads stay valid and F-0's decisions are not re-run with
its text: only the `imprint` field is used. One Qwen process at a time (the GPU is shared with F-0e); runtime is
logged per call.

**Box imprint:** each rotation's imprint is normalised to a key (below). No rotation names one → none; every naming
rotation gives the same key → that key; two different keys → none, counted as a conflict. The source is `logo`
when every naming rotation said logo, else `text`.

### 2. Which boxes are read

Read order is priority order; a cap bounds the Qwen calls (boxes × rotations) per set.

| role | `pilot-000` | yardstick |
|---|---:|---:|
| **reorderable**: F-0 left the box unknown, and some candidate that passes F-0's bar would be accepted if it alone carried the imprint (`reorderable` in `f0d.ts`). The only boxes the tie-break can change. | all | all |
| **confirmed**: seeded sample of accepted boxes, for precision | 200 | 200 |
| **no-text** control: no reader read text; an imprint here is invented | 60 | 40 |
| **C-4 not-in-ISFDB**: C-4's resolved books ISFDB lacks | all 22 | — |
| `readers-disagree` (seeded sample) | 80 | 20 |
| `single-reader` (seeded sample) | 400 | 160 |
| cap on Qwen calls | 3,000 | 1,400 |

Seeds: `SEED` 20261103 (+1 to +4 per role); ids are sorted, then shuffled, so the draw does not depend on file order.

### 3. Publisher keys and the alias table

From the ISFDB catalog's `editions.publisher` (40,580 distinct strings). ISFDB writes an imprint of a larger house
as `Imprint / Publisher` ("Del Rey / Ballantine", "Puffin / Penguin Books (US)"): each ` / ` segment is a
**publisher key**, normalised with the catalog's `normalize`, parentheticals dropped, and business words (`books`,
`press`, `publishing`, `inc`, `editions`, …) dropped when 3+ letters remain ("Tor Books" → `tor`; "Ediciones B"
stays whole). A later segment is the earlier one's **parent house** when they appear together on at least 10
editions and at least 5 % of the imprint's (`PARENT`). Book-club and distributor segments (SFBC, BOMC, QPBC, BCE,
…) are keys but never parents. Three hand aliases, public and factual: Tom Doherty Associates → Tor, Harper Collins →
HarperCollins, NAL → New American Library. A work's keys are every edition's keys plus their parents.

**Match:** the read key equals a key, or is a whole-word prefix of one ("tor" ~ "tor teen"; never "tor" ~
"tordotcom"), and has 3+ letters.

**Yardstick publishers.** The yardstick's inventory catalog records no publisher (every edition says `Library`),
but each book has its ISBN, and an ISBN's registrant is its publisher. Each inventory book takes the publisher ISFDB
records on its longest ISBN-13 prefix of 7 to 10 digits shared by at least 3 ISFDB editions, 90 % of them under one
first segment (`REGISTRANT`). A book whose prefix ISFDB does not hold has no publisher and cannot be matched.

### 4. The tie-break rule (`tieBreak` in `f0d.ts`)

On a box F-0 left unknown, for each reader: its top 3 retrieval candidates (F-0's own call) that pass F-0's bar
(`confirms`: score ≥ 0.72, title evidence ≥ 0.8, coverage ≥ 0.5). If the read imprint matches some but not all of
them, the reader votes for the best-ranked match instead of its F-0 vote. Votes are then counted as F-0 counts them:
at least two readers, uniquely, and the accepted work must itself carry the imprint. So:

- a box F-0 accepted (two readers agreeing) is never touched;
- a candidate that fails the bar is never promoted, nor a reader's only passing candidate;
- one reader plus an imprint is never an accept.

### 5. Measures, both sets, never pooled

- **Imprint read rate** per role, with 95 % photo-cluster bootstrap intervals (2,000 draws).
- **Precision** on confirmed boxes: the read imprint names a house of the accepted work's editions (`pilot-000`;
  lenient, since a popular work has editions from many houses) or of the book's ISBN registrant (yardstick). The
  **chance level** is the same boxes with their imprints shuffled among them (200 seeded shuffles). Split text /
  logo.
- **Logo versus text** share of imprint reads.
- **Tie-break:** before → after confirmed share (and wrong-accept share on the yardstick) on the reorderable boxes,
  paired photo-cluster bootstrap as F-0b, split into whole boxes and cut or partial ones (F-0b's definition: cut by
  a tile edge, or long side under 55 % of the shelf band's height); and the counts added over the whole set.
- **C-4 not-in-ISFDB books** carrying a readable imprint (for when Open Library publisher data arrives).
- **No-text control:** the share of boxes with no text on which an imprint is reported.

### 6. Keep rule and the logo-detector question

- **Keep** the tie-break when the `pilot-000` confirmed-share interval on the reorderable boxes excludes 0 upward
  and the yardstick's wrong-accept share does not rise beyond its interval (F-0b's form).
- **Recommend a trained logo detector** only if logos are common (logo reads ≥ 25 % of `pilot-000` imprint reads),
  useful (logo precision not below text precision by more than 10 points, and above its chance level), and the
  reader evidently misses them; otherwise not. Misses cannot be counted without labels, so this is judged from the
  read rate on confirmed boxes and stated as such.
## Findings

1. **The tie-break has almost nothing to break.** F-0 accepts on two readers agreeing; a box it leaves unknown is
   nearly always unknown because readers do not both pass *any* common work, not because two works tie. Among
   `pilot-000`'s unknown boxes only 32 have a work that two readers both pass in their top three; 14 whole, 18 cut
   or partial. On the yardstick's closed 15,229-book inventory there are none. That ceiling was visible before any
   read (the selection step) and was not used to change the rule.
2. **Read rate is modest and position-independent.** About one box in five yields an imprint on `pilot-000`
   (single-reader 20.3 %, readers-disagree 10.6 %, confirmed 19.5 %). Boxes at the frame's edge or partly out of it
   read about as often as boxes further in (16.7 % against 19.1 %, descriptive), so the owner's Tor-at-the-edge case
   is not a special failure. Rotations disagreed on 62 of 761 boxes, which the pre-registered rule counts as no
   imprint.
3. **Precision is well above chance but lenient.** On `pilot-000`, a match means the read house appears among any
   of the confirmed work's editions; popular works have many, which is why the chance level (imprints shuffled
   among the same boxes) is 7.8 % and not near 0. 39.5 % against 7.8 % says the reader mostly reads a real mark,
   not a guess from the title. Interval widths reflect 38 boxes.
4. **The yardstick is a poor test of imprints.** Its spines carry the library's shelf-mark sticker, and the reader
   reports it as an imprint: post hoc, 44 of its 109 imprint reads are a shelf mark of a book in the same image. Its
   inventory has no publisher, and the ISBN-registrant mapping through ISFDB covers only 24 of the 200 sampled
   accepted boxes, so precision rests on 10 boxes (1/10; chance 1.2 %). Treat the yardstick's imprint figures as
   uninformative, not as a failure.
5. **Cost.** Qwen imprint calls p50 1.33 s on `pilot-000` (1,522 calls, 35 min) and 3.65 s on the yardstick's
   larger crops (802 calls, 50 min), one process, with the GPU shared with F-0e. Spend $0.

## What to try next

1. **Use the imprint as evidence, not only as a tie-break.** It narrows a confirmed work to about half its editions
   (median 44 %), which is what edition-level identity needs, and it could be one more evidence kind in retrieval or
   in the expensive pass's adjudication (an imprint matching a candidate's edition house). Either is a new
   pre-registration, since it would let the imprint move scores rather than only reorder passing candidates.
2. **Open Library publishers for C-4's gap.** 8 of 22 not-in-ISFDB books show a readable imprint; once the Open
   Library import (backlog #4) carries publishers, the same alias rules apply.
3. **Re-run after F-0e.** Whole-spine boxes show both ends of a spine, where imprints usually sit; 4 of the 5
   reorderable boxes with an imprint were cut or partial.

## Private outputs

Per-box imprint reads, the selection and the recomputed F-0 state are under the data root's
`private/f0d/<set>/`; the review page (crop at both rotations, context, read imprint and source, each reader's
candidates with whether their editions carry it, before and after) is `private/f0d/renders/<set>/index.html`. The
imprint table built from the catalog is `catalog/imprint-table.json` there. Nothing per box or per photo is in the
repository.

## Limits

- Machine agreement only on `pilot-000` (INV-17): "confirmed" is two readers agreeing, and a confirmed box can be
  the wrong book (C-4).
- Precision on `pilot-000` is against any edition of the work, not the copy on the shelf.
- The yardstick's publishers come from ISBN prefixes as ISFDB records them; most Spanish and Catalan registrants
  are absent from ISFDB.
- Misses (an imprint visible but not read) are not counted; there are no labels for them.

<!-- generated by src/eval/f0d-cli.ts analyse: edit above this line -->

## pilot-000 (real use (OC35): machine agreement, never accuracy (INV-17))

6894 boxes; F-0's decision recomputed from its cached readings differs on 0. Qwen imprint calls 1522, p50 1.326 s, p90 1.631 s per call (one crop at one rotation), 2110 s in all.

**Imprint read rate** (box has one imprint across its rotations; 95 % photo-bootstrap interval):

| boxes | selected | read | imprint read | logo share of reads | conflicting rotations |
|---|---:|---:|---|---:|---:|
| reorderable | 32 | 32 | 15.6 % (0–30); 5/32 | 20 % | 5 |
| confirmed | 200 | 200 | 19.5 % (13.9–23.7); 39/200 | 33.3 % | 17 |
| no-text | 60 | 60 | 1.7 % (0–5.8); 1/60 | 100 % | 0 |
| c4-not-in-isfdb | 22 | 22 | 36.4 % (17.6–56); 8/22 | 12.5 % | 2 |
| readers-disagree | 47 | 47 | 10.6 % (2.5–22); 5/47 | 20 % | 5 |
| single-reader | 400 | 400 | 20.3 % (16–25.2); 81/400 | 25.9 % | 33 |
| *at the frame's edge or partly out of it* (descriptive) | | 264 | 16.7 % (11.4–22.9); 44/264 | | |
| *further in* (descriptive) | | 497 | 19.1 % (16–21.9); 95/497 | | |
| **all read** | 761 | 761 | 18.3 % (14.9–21.5); 139/761 | 27.3 % | 62 |

**Precision** on accepted boxes: the read imprint names a house of one of the work's editions. Chance level: the same boxes with their imprints shuffled.

| imprint from | precision | chance level |
|---|---|---:|
| text or logo | 39.5 % (20.7–54.4); 15/38 | 7.8 % |
| text | 36 % (12.5–56.3); 9/25 | 9.9 % |
| logo | 46.2 % (22.2–69.2); 6/13 | 9.2 % |

Where the imprint matches, it keeps a median 44.4 % of the work's editions (p90 75 %; 15 boxes).

**Tie-break** on the 32 boxes it could change (F-0 left them unknown, and some passing candidate would be accepted if it alone carried the imprint). Shares in % before → after (Δ points; 95 % paired photo-bootstrap interval).

| boxes | read | with imprint | fired | reader switched | outcome changed | confirmed |
|---|---:|---:|---:|---:|---:|---|
| all | 32 | 5 | 0 | 0 | 0 | 0 → 0 (+0; 0 to 0) |
| whole boxes | 14 | 1 | 0 | 0 | 0 | 0 → 0 (+0; 0 to 0) |
| cut or partial boxes | 18 | 4 | 0 | 0 | 0 | 0 → 0 (+0; 0 to 0) |

Over the whole set: 0 confirmed added among 6894 boxes.

**C-4's not-in-ISFDB books:** 8 of 22 carry a readable imprint.

**No-text control** (no reader read any text): an imprint was reported on 1 of 60.

## yardstick-library-b2 (PROXY: Library Dataset sample, box arm B2; confirmed = accepted and annotated in the image)

1132 boxes; F-0's decision recomputed from its cached readings differs on 0. Qwen imprint calls 802, p50 3.647 s, p90 4.995 s per call (one crop at one rotation), 3005 s in all.

**Imprint read rate** (box has one imprint across its rotations; 95 % photo-bootstrap interval):

| boxes | selected | read | imprint read | logo share of reads | conflicting rotations |
|---|---:|---:|---|---:|---:|
| readers-disagree | 1 | 1 | 100 % (100–100); 1/1 | 0 % | 0 |
| single-reader | 160 | 160 | 28.8 % (19.1–39.4); 46/160 | 10.9 % | 18 |
| confirmed | 200 | 200 | 31 % (24.4–37.6); 62/200 | 8.1 % | 10 |
| no-text | 40 | 40 | 0 % (0–0); 0/40 | — % | 0 |
| *at the frame's edge or partly out of it* (descriptive) | | 85 | 28.2 % (16.7–38.6); 24/85 | | |
| *further in* (descriptive) | | 316 | 26.9 % (21.3–32.3); 85/316 | | |
| **all read** | 401 | 401 | 27.2 % (21.5–32.6); 109/401 | 9.2 % | 28 |

*Post hoc:* 44 of the 109 imprint reads are the library's own shelf-mark sticker (the annotation's `tag` for a book in the same image), not a publisher.

**Precision** on confirmed (accepted and annotated) boxes whose ISBN registrant names a publisher: the read imprint names a house of the book's ISBN registrant. Chance level: the same boxes with their imprints shuffled.

| imprint from | precision | chance level |
|---|---|---:|
| text or logo | 10 % (0–37.5); 1/10 | 1.2 % |
| text | 10 % (0–33.3); 1/10 | 1.2 % |
| logo | — | — % |

**Tie-break** on the 0 boxes it could change (F-0 left them unknown, and some passing candidate would be accepted if it alone carried the imprint). Shares in % before → after (Δ points; 95 % paired photo-bootstrap interval).

| boxes | read | with imprint | fired | reader switched | outcome changed | confirmed | wrong |
|---|---:|---:|---:|---:|---:|---|---|
| all | 0 | 0 | 0 | 0 | 0 | — | — |
| whole boxes | 0 | 0 | 0 | 0 | 0 | — | — |
| cut or partial boxes | 0 | 0 | 0 | 0 | 0 | — | — |

Over the whole set: 0 confirmed and 0 wrong accepts added among 1132 boxes.

**No-text control** (no reader read any text): an imprint was reported on 0 of 40.

## Verdict

| pilot-000 confirmed interval excludes 0 upward | yardstick wrong accepts not up | keep |
|---|---|---|
| no | yes | **off** |
