# KN3: shelf signals for recommend — report

**Verdict: all three pre-registered rules hold on `pilot-000`. The verdicts recommend moving co-shelving (with the
mix half of section terms) from `shadow` to `on`, and recommend surfacing the out-of-place flag. Sign terms stay off.
The switch's default stays `off`, and promotion is the owner's ruling.** The effects are real but small, and
same-author shelving accounts for most of the co-shelving effect. The out-of-place rule passes by a narrow margin, on
form alone. The sections below give the detail. Pre-registration: [`prereg.md`](prereg.md) (ad6fe64); aggregates:
[`metrics.json`](metrics.json). Every figure is `pilot-000` machine agreement, never accuracy (INV-17). There is no
recommendation ground truth. The yardstick is not used.

## Verdicts (pre-registered)

| | rule | measured | holds |
|---|---|---|---|
| C1 | at least 50 % of confirmed works have a `row` neighbour | 479 of 556 (86.2 %) | yes |
| H1 | co-shelved `readers-agree` row pairs share a genre family or form more often than a store-wide shuffle: D's 95 % photo-cluster lower bound above 0 | D = 0.109 (0.085–0.133); H 0.813 against E 0.704, lift 1.15; 2,214 pairs in 17 photos | yes |
| O1 | fewer books flagged out of place in the real rows than in the same books dealt into the same slots at random: below the shuffles' 5th percentile | 9.64 % of 560 determinable members, against a shuffled mean of 11.72 % and a 5th percentile of 10.16 % | yes, narrowly |

- **Co-shelving:** the pre-registered rule recommends `shadow → on`.
- **Out-of-place flag:** the rule recommends surfacing it as a discovery feature. It flags 37 works.
- **Sign terms:** stay off whatever this card finds, until SC-1's own K2 holds.
- **Default:** `off`. Nothing ranks on the signals today. No ranker exists yet (R-2's `rank.ts`), so under `on` the
  features are only what `featuresUnder` hands to one.

## The signals on `pilot-000`

| coverage (all bases; 824 confirmed boxes of 556 works, 320 rows) | |
|---|---|
| confirmed boxes in no row (lying, face-out): no shelf signal | 71 |
| rows with two or more confirmed books | 85 |
| works with a `row` neighbour / with any neighbour | 479 (86.2 %) / 517 |
| rows with SC-1 sign terms / with a section mix / both | 67 / 81 / 30 |
| works on a row with any section term | 490 (88.1 %) |
| rows / works where out of place is determinable | 63 / 376 |
| works flagged out of place: genre / form / either | 11 / 28 / 37 |

Each work's signals are written privately, one line per work, to `private/kn3/pilot-000/signals.jsonl` under the data
root, because they name works.

## Co-shelving neighbours share terms (H)

| arm (`either` unless named) | pairs | H | E (shuffle) | D (95 % CI) | lift |
|---|---|---|---|---|---|
| **primary**: `readers-agree` row pairs | 2,214 | 0.813 | 0.704 | **0.109 (0.085–0.133)** | 1.15 |
| genre family only | 2,188 | 0.722 | 0.592 | 0.129 (0.091–0.166) | 1.22 |
| form only | 941 | 0.825 | 0.755 | 0.070 (0.023–0.117) | 1.09 |
| all three bases | 2,962 | 0.822 | 0.703 | 0.119 (0.094–0.148) | 1.17 |
| **same-author pairs removed** | 1,887 | 0.731 | 0.697 | **0.034 (0.002–0.063)** | 1.05 |
| each work pair once across photos | 1,488 | 0.782 | 0.697 | 0.085 (0.064–0.111) | 1.12 |
| distance 1 / 2 / 3+ | 153 / 156 / 1,905 | 0.837 / 0.814 / 0.797 | 0.697 / 0.706 / 0.709 | 0.140 / 0.108 / 0.088 | 1.20 / 1.15 / 1.12 |
| `case` pairs (same photo, other row) | 10,432 | 0.709 | 0.690 | 0.018 (−0.014–0.038) | 1.03 |

H and E are weighted by co-shelving weight (1 / d in a row). The 200 random shuffles agree with the exact
expectation: their mean is 0.705 and their 95th percentile 0.729 on the primary arm, against a real 0.813.

- **The row carries the signal; the case adds none.** Pairs on different rows of one photo are no more alike than the
  shuffle (the interval spans 0). The effect falls with distance along the row, which fits the 1 / d weight. The
  weight was pre-registered, not fitted.
- **Most of it is the author.** 357 of the 2,214 primary pairs share an author: shops shelve by author, and an
  author's books share a genre. Without those pairs D falls to 0.034, and the lower bound is just above 0. Beyond the
  author, a row's books are only slightly more alike than the store's books in general. So co-shelving mostly says
  "the shop puts these near this author", plus a small section effect.
- **The circularity check.** Context labels were confirmed *because* their neighbours fit an author bracket. Adding
  them raises D only slightly (0.119), so the primary's restriction to `readers-agree` costs little.

## The out-of-place flag (O)

| facet | determinable | real flagged | shuffled mean | shuffled 5th pct |
|---|---|---|---|---|
| **either** | 560 | **9.64 %** (54) | 11.72 % | 10.16 % |
| genre | 556 | 2.16 % (12) | 2.55 % | 1.61 % |
| form | 313 | 14.06 % (44) | 16.53 % | 14.24 % |

O1 holds on `either`, by half a point. **The genre flag alone does not beat the shuffle:** almost every row's mix
includes sf or fantasy, so few books fall outside it in any arrangement. The form flag carries the result. It mostly
marks short-story collections, criticism, drama or poetry shelved among bare `fiction`. That is the discovery case the
card has in mind (a different kind of book on the shelf), but the margin is thin.

## Stability (S)

- **F-1 near-duplicate pairs: 0**, so the card's stability measure is **vacuous** on this fixture, as expected (TS-0:
  the closest pair of photos is 18 bits apart, against a threshold of 8).
- **Substitute: repeat sightings within one F-1 capture group.** 80 works give 129 (work, photo-pair) comparisons.

  | | pairs | agreement |
  |---|---|---|
  | out-of-place flag (both determinable) | 96 | 97.9 % |
  | the row mix's top genre family | 114 | 69.3 % |
  | the row's SC-1 sign family | 64 | 35.9 % |
  | row neighbours, Jaccard (mean) | 128 | 0.186 |

  The flag's agreement is high, but most members are in place both times (about 90 % are), so it says little. A
  third of repeat sightings land in rows whose mix leads with another genre family. Rows seen twice share under a
  fifth of their confirmed neighbours. Overlapping shots cut rows differently and confirm different neighbours, so
  one photo gives a partial neighbour list. Taking each neighbour's maximum over sightings joins those lists without
  counting a neighbour twice. The sign family agrees on only about a third of repeat sightings, which fits SC-1's own
  K2 failure and is why sign terms stay off.

## How much the catalog and SC-1 limit this (plainly)

- **ISFDB's single-genre catalog.** 81.3 % of confirmed works have a genre family. Of those, **95.4 % are sf or
  fantasy**, and 12 families occur in all. Two random books from this store share a genre family 59 % of the time,
  so the genre test starts from a high base. Real shelving can raise that by only 0.13.
- **Form says little.** Form is known for 52.9 % of works, and **86.7 % of those are bare `fiction`** (`novel`:
  2.0 %). So sharing a form mostly means "both fiction". The `either` facet's E (0.70) is high for the same reason.
- **SC-1's thin coverage.** 67 of 320 rows (20.9 %) carry a sign, in five families (sf-fantasy, nonfiction,
  fantasy, sf, literature). The sign family agrees across repeat sightings 35.9 % of the time. So sign terms are
  coverage only.
- **Few rows have enough confirmed books.** Only 85 rows have two or more confirmed books, and 81 have a section mix.
  71 confirmed boxes stand in no row. Out-of-place is determinable on 63 rows. Every signal rises with recognition
  coverage, not with this card's constants.

## What this does not show

- Whether recommendations get better. No ranker exists and there is no ground truth. These measures only show that
  the signals carry information beyond a shuffle of the same store.
- Accuracy. `pilot-000` has no taps, and the confirmed books are machine labels.
- Whether this holds in another store or catalog. `pilot-000` is one shop's SF/fantasy shelving on ISFDB. On a broad
  catalog the genre base rate would be lower and the test less saturated.
- Why the yardstick is not used. It is PROXY library shelving. KN-1 finds a genre or form on 14.2 % of its confirmed
  works, and KN-2 found 12 rows with a mix there. Recommend has no use for it.

## The wall and the rules, as built

- **One way.** `src/recommend/shelf-signals.ts` imports KN-1's `SECTION_GENRES` and KN-2's `buildMix`,
  `majorityForm` and `PRIOR`. `test/shelf-signals.test.ts` checks every file under `src/identify`, `src/perceive` and
  `src/catalog`, transitively: none reaches the signals or `src/eval/kn3*`. A probe file that imported them made the
  test fail.
- **Never taste.** The import closure of the signals and of KN-3's eval reaches no profile, seeds, overlay,
  vocabulary or lens file.
- **No popularity.** The test refuses edition, year, rating, vote, award and feature-count terms in the signals' code.
  Neighbours keep their maximum weight, never a sum.
- **Discovery, not penalty.** The flag only adds `discovery: true` and the facets; no output is negative.

## Reproduce

```
node src/eval/kn3-cli.ts analyse   # about 4 s on CPU; evals/KN3/metrics.json and private/kn3/pilot-000/signals.jsonl
```

Inputs: TS-0's label ledger (`v-4e0ec70a69de`), F-0g's RB-1 boxes, F-0h's rows, SC-1's
`private/sc1/pilot-000/rows.jsonl` and `catalog-kn1.sqlite`. Re-run after any of them changes.
