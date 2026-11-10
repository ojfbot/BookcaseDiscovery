# C9: imprint data and the contrast rule (IMP-1)

Card C-9, 2026-11-04. Pre-registration: [`prereg.md`](prereg.md), committed before the first decision run. Spec:
`docs/catalog/identification-research.md` §3.2 and card C-9. Numbers: [`metrics.json`](metrics.json). Method and
schema: `docs/catalog.md` § Imprint data (C-9).

The two sets are reported apart (OC35). `pilot-000` figures are machine agreement only, never accuracy (INV-17).
The yardstick is a PROXY. Intervals are 95 % paired photo-cluster bootstraps.

## Answer first

| arm | keep rule | result | verdict |
|---|---|---|---|
| **Data fix** (every Open Library publisher string, ISFDB publisher series, Wikidata parents) | p1 rises ≥ 10 points with the chance level up ≤ 2 | p1 **38.9 → 41.7 %** (+2.8 points, 0 to 9.3); chance 8.4 → 10.4 % (+2.0) | **off** |
| **IMP-1** (imprint contrast withhold) | yardstick wrong accepts on eligible boxes fall, interval excluding 0, **and** `pilot-000` withholds ≤ 5 % of eligible accepts | yardstick: 1 eligible box, 0 wrong, 0 withheld; `pilot-000`: 0 of 36 withheld | **uninformative (off)** |

- **The data fix moves p1 by one box, and that box came through Wikidata.** On the 36 confirmed `pilot-000` boxes
  in the sample, adding every Open Library publisher string matched no new box, and neither did ISFDB's publisher
  series. One Wikidata parent link matched one more box (14 → 15 of 36). The chance level rose by as much as p1.
  F-0d's misses are not a data-plumbing problem: on these works the read house is in no edition the catalog knows,
  under any string. This repeats C-R2's caution that the binding limit is catalog data, but here the gap is in the
  sources, not in the import.
- **IMP-1 had nothing to act on, so the yardstick arm is uninformative, as the spec warned.** F-0d chose its read
  sample from the *closed-set* decisions, so it barely overlaps the *open-catalog* accepts IMP-1 is for.
  - Of the yardstick's 14 wrong accepts on v2, F-0d read 4 boxes, and none of the 4 has an imprint.
  - On both sets, IMP-1 found a passing runner-up within the margin on only 2 eligible boxes (both `pilot-000`),
    and on neither did the runner-up carry the read house.
  - `pilot-000`'s 0 % meets the ≤ 5 % bound, but a pass needs both conditions, and the yardstick condition cannot
    be met with 0 withholds.
- **The shelf-mark filter works without labels.** On the yardstick it drops 38 of the 44 reads that F-0d matched to
  the library's own sticker (86 %), and 13 of the other 65 (20 %). On `pilot-000` it drops 6 of 139 reads (4 %).
- **Everything ships switched off, nothing downstream changes.**
  - IMP-1 is in `src/eval/f0d.ts` with `IMP1.enabled = false`.
  - The new columns change no existing reader. The rebuilt catalogs reproduce today's edition rows and publisher
    strings exactly, and today's accepts at 1.000.
  - Today's `catalog.sqlite` and `catalog-v2.sqlite` were not touched.
- **No catalog gap closes.** The data fix adds no work and no title form, so Q-3's `catalog-gap` (1,322 `pilot-000`
  books) is unchanged by construction. That gap was never this card's aim.

## What was built

| item | figure |
|---|---|
| Open Library editions with 2+ publisher strings (`editions.publishers`) | **531,138** of 12,070,318 Open Library editions |
| ISFDB editions with a publisher series (`editions.pub_series`) | **141,382** of 943,917 |
| Wikidata export (one query, private) | 455 statements on 307 ISFDB publishers; 125 dated |
| Wikidata parent links after joining to ISFDB names | 393 links on 282 houses; 116 dated |
| `catalog-c9.sqlite` (v1, schema 3) | 22.5 s; 438.5 MB |
| `ol-staging-c9.sqlite` + `catalog-v2-c9.sqlite` (v2, schema 3) | stage about 9 min; build 350 s; 6.25 GB (today's v2: 6.18 GB) |

**Gates (all passed):**
- **Rebuilt editions.** Both rebuilt catalogs hold the same editions as today's files (943,917 and 13,014,235), and
  0 `publisher` strings differ.
- **Today's accepts.** Re-deciding F-0's cached readings on every box F-0d read reproduces C-6's unguarded accepts
  at 1.000 on all four set and catalog pairs.
- **F-0d's p1.** With F-0d's data, p1 is again 15/38 (39.5 %, 20.7–54.4) with chance 7.8 %.

## Arm 1: the data fix (p1)

The sample is F-0d's `confirmed` boxes in RB-1's box set whose work has a key before the fix. That leaves 36 boxes
on 13 photos (2 of F-0d's 38 left the box set). The boxes and works are the same on both sides.

| data | v2: p1 | v2: chance | v1: p1 | v1: chance |
|---|---|---:|---|---:|
| today (first publisher string, F-0d's ISFDB parents) | 38.9 % (20.0–54.8); 14/36 | 8.4 % | 38.9 % (20.0–54.8); 14/36 | 8.2 % |
| + every Open Library publisher string | 38.9 %; 14/36 | 8.4 % | (no Open Library editions) | 8.2 % |
| + ISFDB publisher series | 38.9 %; 14/36 | 8.4 % | 38.9 %; 14/36 | 8.2 % |
| + Wikidata parents (the C-9 data) | **41.7 % (20.7–61.1); 15/36** | **10.4 %** | 41.7 % (20.7–61.1); 15/36 | 10.0 % |
| **Δ (paired)** | **+2.8 points (0 to 9.3)** | **+2.0** | +2.8 (0 to 9.3) | +1.8 |

The bar is a 10-point rise: **off**. The chance level's rise (2.0) sits exactly on its own limit, so the extra
matches cost as much specificity as they bought. No box was "known" only after the fix.

## Arm 2: IMP-1

The **primary cell** is v2, today's data (the data fix is off), with the shelf-mark filter on. **Eligible** means
accepted by F-0's rule, in RB-1's box set, with a usable imprint read.

| set | catalog / data | accepts F-0d read | eligible (photos) | with a close passing runner-up | withheld | wrong among eligible: before → after |
|---|---|---:|---:|---:|---:|---|
| `pilot-000` | **v2 / today** | 197 | **36** (14) | 2 | **0** (0 %) | — |
| `pilot-000` | v2 / C-9 data | 197 | 36 (14) | 2 | 0 | — |
| `pilot-000` | v1 / today | 187 | 33 (12) | 1 | 0 | — |
| yardstick | **v2 / today** | 21 | **1** (1) | 0 | **0** | **0 → 0** (Δ 0; 0 to 0) |
| yardstick | v2 / C-9 data | 21 | 1 (1) | 0 | 0 | 0 → 0 |
| yardstick | v2 / today, no shelf-mark filter | 21 | 5 (4) | 0 | 0 | 0 → 0 |
| yardstick | v1 / today | 4 | 0 | 0 | 0 | — |

The other cells (v1 with the C-9 data, and the filter off on `pilot-000`) give the same counts; they are in
`metrics.json`.

**Why there is nothing to measure** (descriptive, added after the pre-registration, decides nothing):

| set | catalog | accepts in the box set | F-0d read | with an imprint | wrong accepts | wrong, read | wrong, with an imprint |
|---|---|---:|---:|---:|---:|---:|---:|
| `pilot-000` | v1 | 687 | 187 | 37 | — | — | — |
| `pilot-000` | v2 | 950 | 197 | 40 | — | — | — |
| yardstick | v1 | 12 | 4 | 1 | 5 | 1 | 0 |
| yardstick | v2 | 41 | 21 | 5 | 14 | 4 | **0** |

On the yardstick, IMP-1 could only withhold a wrong accept that has an imprint read, and none does. The verdict
follows the pre-registered rule: **uninformative (off)**, not a pass and not a failure. On `pilot-000`, 40 of 950 v2
accepts have an imprint read, and close runners-up are rare among them (2 of 36 eligible). IMP-1's reach on today's
reads is small whatever its precision.

**Verdict:** IMP-1 stays in the code, switched off (`IMP1.enabled = false`). A fair test needs imprint reads on the
open-catalog accepts themselves: about 41 yardstick boxes and the 950 v2 `pilot-000` accepts, or at least those with
a passing runner-up within the margin. That is a GPU read (F-0d's `imprint.py`) and a new pre-registration, outside
this card.

## Shelf-mark filter

Label-free, fixed in the pre-registration. A read is dropped when it holds a digit, or when every word is at most
3 letters and one of them begins a surname among the box's candidate authors. F-0d's sticker match (the annotation's
`tag`) was used for this table only.

| set | imprint reads | dropped | digit | Cutter | stickers dropped | others dropped |
|---|---:|---:|---:|---:|---|---|
| yardstick | 109 | 51 | 37 | 14 | **38 of 44** (86 %) | 13 of 65 (20 %) |
| `pilot-000` | 139 | 6 | 5 | 1 | — | — |

Some of the 13 "others" may be stickers that F-0d's tag match missed, such as a class number with no author letters.
Without labels this cannot be told apart from a real house the rule dropped, so 20 % is an upper bound on the
filter's false drops on this set. The filter is part of IMP-1's hygiene and ships with it, switched off.

## Caches an adoption would invalidate

Adoption means pointing `BOOKCASE_CATALOG` at a schema-3 catalog (or rebuilding `catalog.sqlite` /
`catalog-v2.sqlite` with this code). Retrieval and F-0's accepts are unchanged (gate 1.000), but these caches are
stamped with the catalog file (size and mtime) or were computed against it, so they would need a re-run, not new
reasoning:

- **Stamp-checked:** `private/c6/readings`, `private/c7/readings` (with the stats sidecars
  `catalog{,-v2}.stats.sqlite`, rebuilt by `bookcase catalog stats --db …`), `private/c8/readings`, and C-9's own
  `private/c9/lists`.
- **Computed against the file, not stamped:**
  - C-5's re-decisions (`catalog/c5/private/`);
  - F-0d's `catalog/imprint-table.json` and `private/f0d/<set>/state.jsonl`;
  - Q-3's `private/q3/pilot-000/v2.jsonl`;
  - F-0's stage decisions (`f0/<set>/decisions.jsonl`);
  - the F-0c, F-0e, F-0j, TS-1 and U-4 runners' decision caches.
- **Not affected:** F-0d's imprint reads, and every detection, partition and reading cache. The catalog is not an
  input to any of them.

Nothing was re-run here.

## The Wikidata export

The export is kept private, under the data root's `private/c9/wikidata/`. It holds 455 rows, plus the query and the
response's SHA-256. It is not committed, and this card does not propose committing it:

- the arm it feeds is off;
- the query is committed (`WIKIDATA_QUERY`) and re-runs in seconds;
- the live data changes, so a committed copy would go stale without a refresh rule.

If the owner wants a pinned copy for reproducibility, it is CC0 and holds no owner data.

## Limits

- **p1's sample is small** (36 boxes, 13 photos). The interval on Δp1 runs from 0 to 9.3 points, so the data fix's
  real effect could still be a few points. A 10-point rise is outside it.
- **IMP-1 is measured on F-0d's read sample only.** No new reads (no GPU), as the card required.
- **The yardstick's open-catalog judge** is C-5's approximation (title and author match, Spanish and Catalan
  articles). See `evals/C5/report.md`.
- **Wikidata links are one level deep.** An imprint's parent's parent is not followed. Modelling is uneven, as C-R2
  found: some houses point only at a current owner.
- **The date is UTC.** The export file is named 2026-11-05 because it was fetched after midnight UTC on 2026-11-04,
  local time.
