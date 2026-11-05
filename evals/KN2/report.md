# KN2: genre prior for identify, shadow mode — report

**Verdict: the keep rule is not met. The section prior stays in `shadow` (default `off`), and it is not recommended
for `re-rank`.** On `pilot-000` it would add one accept in 31 photos, which is no more than a shuffled row's mix
adds. On the stress test it changes the accept of one out-of-place book to a namesake. On the yardstick it changes
nothing, so the yardstick is too small to read, as expected. Promotion is the owner's ruling; this report gives the
figures that ruling reads. Pre-registration: [`prereg.md`](prereg.md) (0c17829); aggregates:
[`metrics.json`](metrics.json). `pilot-000` figures are machine agreement, never accuracy (INV-17). The yardstick is
**PROXY (library shelves)**.

## Keep rule (pre-registered)

| | rule | measured | holds |
|---|---|---|---|
| G1 | F-0's vote on the 20-deep cache reproduces F-0's `decide` ≥ 99.9 % | `pilot-000` 5,757 of 5,757 (1.000); yardstick 1,038 of 1,038 (1.000) | yes |
| K1a | new accepts per photo, 95 % photo-cluster bootstrap, lower bound > 0 (`pilot-000`) | 0.032 (0.000–0.097): 1 new accept in 31 photos | **no** |
| K1b | zero new wrong accepts (yardstick, PROXY) | 0 new accepts of any kind | holds, **uninformative** (too small to read) |
| K2 | out-of-place books (form ≠ row majority) lose no accepts (`pilot-000`, leave one out) | 1 of 31 changed to another work | **no** |

The re-decided accepts also agree with the stored base that F-0h and SC-1 read, at 1.000 on both sets.

## What the prior did

| `pilot-000` (machine agreement) | |
|---|---|
| book boxes / rows | 5,757 / 320 |
| in force: `readers-agree` / copy / context | 726 / 9 / 89 |
| targets (no basis in force) | 4,933 |
| would-be changes: new / lost / changed accepts | 1 / 0 / 0 |
| new accepts with third-reader dissent | 0 |
| shuffle control: new accepts, real against shuffled mixes (200, mean / p95) | 1 against 1.12 / 2 |

- **The one new accept** is a target where Vision already confirmed a work on its own. PP-OCR's top was another work
  0.018 above it; the prior moved PP-OCR to Vision's work, which fits the row's mix better, and
  F-0's vote then had two readers. The shuffle control finds about as many new accepts from a random other row's mix.
  So this is not evidence of a row effect: the store's general genre does as well as the row's own.
- **The stress test's one failure is a namesake tie.** The book is a short-story collection on a row whose other books mostly share another form. Its
  two readers confirmed it, and both readers' second candidate was a different book with the same title by another
  author, at **exactly the same score** (0.895 and 0.761). With the collection left out, the row's mix favoured the
  namesake's genre and form, and the prior moved both readers to it: `changed-accept`. Retrieval breaks such exact ties by edition
  count, and the prior breaks them by section fit. Neither is evidence from the spine's text, and the pre-registered
  rule counts this as a loss. Machine agreement cannot say which work is on the shelf.
- **Over all 655 `readers-agree` boxes left out**, that is the only change (654 unchanged). Of the 11 boxes out of
  place by genre, none changed.

| yardstick (PROXY) | |
|---|---|
| book boxes / rows / targets | 1,038 / 90 / 760 |
| in force: `readers-agree` / copy / context | 266 / 0 / 12 |
| base wrong accepts (C-5's judge) | 24 of 266 |
| rows with a mix | 12 (13.3 %) |
| (target, reader) pairs with any challenger the mix could separate | 0 |
| would-be changes | none; leave one out: 198 boxes, none changed |

## How much the single-genre catalog limits this (plainly)

It limits the prior a great deal, but the binding limit is how rarely a re-rank has anything to choose between.

- **Few rows have a mix.** A mix needs two confirmed neighbours with known features in one row: 81 of 320 `pilot-000`
  rows (25.3 %). 86.2 % of confirmed works have features, but 60.1 % of target tops do, and most rows have fewer than
  two confirmed books. 30 of the 81 mixes took SC-1's sign; 67 rows have one.
- **The mixes that exist say mostly one thing.** The mean top genre family holds 79.7 % of a mix's contributors.
  51.9 % of mixes are at least 80 % one family, and only 12 genre families occur across all mixes. On ISFDB's
  speculative-fiction catalog, a row's mix and a candidate usually both say "sf", so their fit does not differ.
  Form says more (Open Library gives half the confirmed works a form), but most mixes are one form too (mean top share 87.5 %).
- **There is almost never a choice to make.** Per (target, reader), the re-rank's reasons:

  | reason | count |
  |---|---|
  | no mix in the row | 4,380 |
  | no candidates (no text) | 796 |
  | no passing challenger within 0.05 of the top with known features | 1,483 |
  | the top's features unknown (never displaced) | 724 |
  | challenger in band, affinity gap under 0.25 or too small for the score gap | 39 |
  | moved | 11 |

  Only **50** (target, reader) pairs had a passing, known challenger within 0.05 of the top. The mix separated it from
  the top by 0.25 or more in 29 of them (58 %), so where there is a near-tie, a mix often prefers one side. But
  near-ties that pass F-0's bar are rare, and moving one reader still needs a second reader to agree.
- **On the yardstick** only 26.3 % of confirmed works and 19.8 % of target tops have features (general fiction in a
  Barcelona library, mostly outside ISFDB). 12 rows have a mix, and no pair had a challenger to separate.

## Changes after the pre-registration (before any figure)

KN-1's follow-up (#70) and a correction from the conductor arrived after the pre-registration was committed and before
anything was computed. The pre-registration is unchanged; `implementation-notes.md` (KN-2) has the detail.
1. The yardstick is retrieved and decided on its own inventory catalog with KN-1's features
   (`f0-inventory-catalog-kn1.sqlite`), not the v1 catalog. Its stored decisions are not stale there. The v1-catalog
   ranked cache was discarded unread.
2. On the yardstick, F-0g's copy and F-0h's context bases are in force, as on `pilot-000` (their work ids now match).
3. Form is KN-1's `pickForm`: a specific form over bare `fiction`, then the form more sources' records carry.
4. The sign map is KN-1's `SECTION_GENRES`. `classics` now maps to no genre (it was `literary`); the sign still adds to
   the genre facet only.

None of these touches `pilot-000`'s keep-rule figures except item 3, which only picks between a work's own forms.

## What this does not show

- Accuracy: `pilot-000` has no taps. Machine agreement cannot tell whether the new accept or the namesake swap is right.
- Whether a wider band or a looser gap would help. The constants are pre-registered and were not tuned. With 50
  opportunities, any retuning would be fitted to a handful of boxes.
- Other catalogs: on a general catalog (Open Library v2) mixes would be less uniform. They would also have more
  namesakes, which is how the prior failed here.

## Options for a later card (each needs its own pre-registration)

- **Never let the prior break an exact score tie between two different books.** That is the namesake case, and C-6's
  and C-7's guards already treat it as a reason to withhold. With that rule the stress test would have held. It would
  not change K1a.
- Use the mix as a hypothesis weight (like F-0h's context hypotheses) rather than a re-rank of confirmations. It would
  rank what a user might be looking at without changing any accept.
- Revisit after the catalog gains non-genre breadth, and after more rows have two confirmed books.

## Reproduce

```
node src/identify/section-prior-cli.ts ranked pilot-000   # about 28 min on CPU
node src/identify/section-prior-cli.ts ranked yardstick   # about 3 min
node src/identify/section-prior-cli.ts analyse            # seconds; evals/KN2/metrics.json
```

Private outputs are under the data root's `private/kn2/<set>/`: `ranked.jsonl` (the readers' candidates),
`shadow.jsonl` (one record per book box, beside its decision) and `loo.jsonl` (the stress test). No GPU was used.
