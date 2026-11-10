# C9 pre-registration: imprint data and the contrast rule (IMP-1)

Card C-9, 2026-11-04. Spec: `docs/catalog/identification-research.md`, card "C-9 · Imprint data and the contrast rule
(IMP-1)" and §3.2. Committed before the first decision run (`node src/catalog/c9-eval.ts analyse`). Before this
commit, only the catalog builds, the Wikidata export and the per-box candidate lists (`lists`, with their
reproduction gate) had run. No p1, withhold or wrong-accept figure had been computed.

Real-use figures (`pilot-000`) are machine agreement, never accuracy (INV-17). The yardstick is a PROXY (OC35).
Nothing is tuned on either set: every constant below is fixed here.

## Inputs (all cached, CPU only)

- **Imprint reads:** F-0d's cached Qwen imprint reads (`private/f0d/<set>/imprint.jsonl`). No new read. A box's
  imprint is F-0d's `boxImprint`: the one key every naming rotation gives, or none.
- **Readings and decisions:** F-0's cached readings, re-decided with F-0's unchanged rule on C-9's rebuilt catalogs.
  Gate: the rebuilt catalogs must reproduce C-6's unguarded accepts on every box F-0d read, at 0.999 or more.
- **Box set:** RB-1's (`loadBoxSet`), so boxes F-0i's partition or NB-3's `on-lip` dropped are left out.
- **Catalogs:** `catalog-c9.sqlite` (ISFDB) and `catalog-v2-c9.sqlite` (ISFDB + Open Library), schema 3, built by this
  card's code. Today's `catalog.sqlite` and `catalog-v2.sqlite` are not touched.

## Arm 1: the data fix

What it adds, as imprint keys of a work's editions:
1. **Every Open Library publisher string** per edition (C-5 kept the first only).
2. **ISFDB publisher series** on ISFDB editions (`pubs.pub_series_id`).
3. **Wikidata parents:** P749 (parent organisation) and P127 (owned by), with P580/P582 dates, joined to ISFDB
   publishers by P1239. One query export, kept private under the data root's `private/c9/wikidata/`. A dated link
   applies to an edition only when the edition's year lies inside its dates.

**p1** is F-0d's precision: on `pilot-000`'s F-0d `confirmed` sample (boxes F-0 accepted, with an imprint read),
the share whose read imprint names a house of the accepted work's editions (exact key, or a whole-word prefix of 3+
letters; undated parents count, as in F-0d). **Chance level:** the same boxes with their imprints shuffled
(F-0d's 200 seeded shuffles).

- **Gate:** with F-0d's data (v1 publishers, F-0d's imprint table), p1 must be 15/38 and chance 7.8 %, as F-0d
  reported.
- **Primary comparison:** catalog v2. *Before* is today's data (each edition's first publisher string, F-0d's
  ISFDB-derived parents). *After* is the C-9 data (1 + 2 + 3). Same boxes, same works on both sides: the sample is the
  boxes in RB-1's box set whose work has at least one key before the fix.
- **Reported, never deciding:** the same on v1 (where only 2 and 3 apply), and each step on its own (+publishers,
  +series, +Wikidata).

**Keep rule (copied from the spec):** the data fix is kept if p1 rises ≥ 10 points with the chance level up ≤ 2
points. Both are point estimates on the primary comparison. The paired Δp1 interval (95 % photo-cluster bootstrap) is
reported beside them.

## Arm 2: rule IMP-1

**Hygiene, applied to the read before IMP-1 sees it:**
- the key needs 3+ letters, and a club segment (SFBC, BOMC, ...) never counts;
- **shelf-mark filter** (label-free, fixed here from the form of library stickers, not from any yardstick read):
  the read is dropped when its text holds a digit (a class number), or when every word is at most 3 letters and one
  of them begins a surname of an author of the box's candidates (each reader's top 3): a Cutter mark such as
  "N BEL".

**The rule** (`imprintContrast` in `src/eval/f0d.ts`), on a spine F-0 accepted, with a usable read:
- A **runner-up** is a candidate in an agreeing reader's ranked list (depth 50) that is not the same book
  (`sameBook`), passes F-0's bar on its own, and scores within C-6's lookalike margin (0.01) of the accepted work.
- **Withhold** when the accepted work's editions lack the read house *even through an undated parent* **and** some
  runner-up carries it *through what its editions say*: a publisher string segment, its publisher series, or a dated
  Wikidata parent covering the edition's year. A match through an undated parent counts for F-0d's reorder, never
  for the withhold.
- A withheld spine becomes unknown with both works shown. It never switches to the runner-up, never adds a reader,
  never confirms. The switch is off by default (`IMP1.enabled = false`).

**Eligible boxes:** in RB-1's box set, accepted by F-0's rule on the catalog, with a usable imprint read. IMP-1 can
only be measured where F-0d read an imprint, so every IMP-1 figure is on F-0d's read sample, not the whole set.

**Primary cell:** catalog v2, shelf-mark filter on, and the data the data-fix verdict keeps (the C-9 data if Arm 1
is kept, today's data if not). The other cells (v1; the other data; the filter off) are reported, never deciding.

**Keep rule (copied from the spec):** IMP-1 is kept if yardstick wrong accepts on eligible boxes fall with an interval
that excludes 0, **and** `pilot-000` withholds ≤ 5 % of eligible accepts.
- *Fall:* the paired change in the yardstick's wrong-accept share of eligible boxes, after minus before, has a 95 %
  photo-cluster bootstrap interval whose upper end is below 0.
- *Withholds:* withheld eligible accepts over eligible accepts on `pilot-000`, a point estimate.

**Stated caveat (copied from the spec):** the yardstick has no publisher data and its stickers pollute imprint reads,
so an uninformative arm is reported as uninformative, not as a pass. Here *uninformative* means the yardstick
primary cell withholds no accept, or has no wrong accept among its eligible boxes. Then the verdict is
"uninformative (off)".

**The shelf-mark filter** is part of IMP-1's hygiene and has no keep rule of its own. Reported: how many yardstick
reads it drops among those F-0d found to be the library's own sticker (the annotation's `tag`, used for this
evaluation only) and among the rest, and how many `pilot-000` reads it drops.

## Statistics

- 95 % paired photo-cluster bootstrap, 2,000 draws, seed 1 (C-6's), for every IMP-1 interval and for Δp1.
- p1's own intervals use F-0d's bootstrap (2,000 draws, seed 200) so the gate compares like with like.
- The two sets are reported apart (OC35).

## Not done here

- No downstream card is re-run. The report lists which caches an adoption would invalidate.
- The data fix adds no work and no title form, so it cannot close a catalog gap by itself; C-9 targets namesake
  wrong accepts, not the gap.
- The Wikidata export stays private. Committing it as repo data needs the owner's OK.
