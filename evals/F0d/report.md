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
