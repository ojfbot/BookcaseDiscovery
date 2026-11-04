# RB-1 · batched re-baseline (2026-11-04)

**Answer.** Six downstream cards were re-run once on F-0i's partition with NB-3's `on-lip` boxes left out. **No keep
rule or go rule flips.** F-0g's `confirmed-by-copy` and F-0h's `confirmed-by-context` still ship. Q-2b is still
NO-GO, and H-2's `face3d` crop still does not ship. S-1's `on-lip` rule still meets its keep rule. Q-3's five leading
causes keep their order on both sets.

The two sets are reported apart (OC35). `pilot-000` figures are machine agreement, never accuracy (INV-17). No
default changed in this card.

## Why

Each card measured its baseline on the box set of its day. Since then:

- **F-0i (#51)** partitioned the shipped default boxes:
  - `pilot-000`: 6,121 → 5,761 boxes. It dropped 360 (196 pieces of a whole spine, 138 duplicates, 18 merged
    parents, 8 absorbed) and changed the outline of 1,001 of the boxes it kept.
  - Yardstick: 1,116 → 1,040. It dropped 76 and changed 134.
  - Box ids and detection rectangles do not change, because the refit crop did not ship.
- **NB-3 (#61)** ships the `on-lip` not-a-book cause in the default path. It removes 4 more `pilot-000` boxes and 2
  more yardstick boxes.
- **F-0m (#60) and F-0k (#62)** shipped nothing, so the box set is F-0i's.

**RB-1's box set** therefore holds 5,757 `pilot-000` boxes and 1,038 yardstick boxes (`src/eval/rb1.ts`).

## What ran

All of it ran on the CPU, from caches. No reader re-read, depth did not re-run, and the GPU was not used. The steps
ran in this order, each with the card's own CLI:

1. **F-0g:** `pairs`, `evidence`, `imprint --dry-run` (0 boxes to read) and `analyse`.
2. **Q-2b and U-4:** `u4`, `diag`, `analyse` and `render`. U-4's outlines are F-0i's exclusive outlines.
3. **H-2:** `faces` (new) and `analyse`.
4. **S-1:** `shelf` on both sets, then `analyse`.
5. **F-0h:** `analyse`.
6. **Q-3:** `v2` (all cached), `audit pilot-000`, `audit yardstick` and `analyse`.

`node src/eval/rb1-cli.ts summary` then wrote each card's dated section and this summary from the cards' metrics as
published (main 116f4e9) and as re-run. `--box-set pre-rb1` on any of the CLIs reproduces the published figures.

The places where the territory differed from the brief are logged under Deviations in `implementation-notes.md`:

- the shared box-set loader;
- borrowed helper venvs;
- F-0i's outlines standing in for a SAM re-run;
- H-2's face rows keyed by rectangle;
- S-1's `on-lip` population;
- S-2 used as cached;
- F-0g2 left as published.

## The delta, card by card

- **F-0g (copy groups).**
  - Lift: 0.29 confirmed boxes a photo (0.06 to 0.58), unchanged.
  - The same 9 boxes are confirmed by copy, and the series guard blocks 432 of 432 hard-negative views.
  - Groups: 5.00 → 4.97 a photo.
  - The yardstick still propagates nothing: wrong accepts stay at 22.
  - Verdict holds: on.
- **Q-2b (teacher and student).**
  - Student AUC 0.711 → 0.710; gain over crop width +0.297 → +0.305.
  - τ moves 0.72 → 0.73, inside the band Q-2b called fragile.
  - Still NO-GO.
  - U-4: 79.2 % of boxes are now drawn from their own outline (83.2 % on Q-2b's SAM outlines). F-0i's exclusive
    outlines are cut to the pixels each box owns, so more of them cover less than 60 % of their box.
- **H-2 (face shares).**
  - Over-selecting: 49.4 % → 49.1 %.
  - `face3d`: confirmed −0.3 → −0.4 points (−1.4 to 0.6); distinct confirmed works Δ −7 → −8.
  - Still off. The yardstick is not hurt in either run.
- **S-1 (voids).**
  - `pilot-000` void share: 1.2 % (0.4 to 2.2), unchanged. Lip found on 98 % of rows (96 % before).
  - `on-lip` reproduces: 4 and 2 boxes, none confirmed.
- **F-0h (neighbour context).**
  - Half B: +3.50 → +3.44 confirmed a photo (1.19 to 6.19), 56 → 55 accepts. The lost accept was a piece F-0i
    dropped.
  - Shuffle: 4.6 % of real accepts (p95 9.1 %).
  - Leave one reader out: 0 wrong of 220.
  - Yardstick: 12 accepts and 23 wrong accepts, as before.
  - Still on.
  - No accept is new, so the owner's neighbour-context example is not recovered by the partition.
- **Q-3 (gap audit).**
  - `pilot-000`: 6,068 → 6,064 books; lost 5,244 → 5,240 (86.4 %).
  - Yardstick: lost 799 → 797.
  - Q-3 already ran on the partition. Its change comes from `on-lip` and from the upstream re-runs.

## Verdict flips

None. A flip would be reported here and not acted on: defaults do not change in RB-1.

## Q-3's causes, re-ranked (feeds the next queue choice)

`pilot-000` (machine agreement), by books lost:

1. `catalog-gap`: 1,322 (973–1,707). It was 1,358.
2. `frame-edge`: 885 (766–1,006).
3. `single-reader`: 740 (511–973).
4. `tiling-or-side-case`: 643 (438–895).
5. `top-face`: 642 (443–850).

`misread` (444) and `dark-or-low-contrast` (225) follow. As before, ranks 2–5 overlap within their intervals, and
`catalog-gap` alone stands clear.

The yardstick's order is also unchanged: `catalog-gap` 272, `single-reader` 135, `frame-edge` 86,
`tiling-or-side-case` 68, `dark-or-low-contrast` 55. **The queue choice Q-3 pointed to stands: the catalog gap
first.**

## Limits

- **Qwen's per-photo cap is not re-selected anywhere.** Re-selecting it would need the GPU. Slots freed by dropped
  boxes stay empty, alike in every arm.
- **S-2 was not re-run.** Q-3's rows and gaps still count the `on-lip` boxes as books: 4 on `pilot-000` and 2 on the
  yardstick.
- **F-0g2's figures are as published**, though it reads F-0g's re-run pairs.

<!-- generated by src/eval/rb1-cli.ts summary: edit above this line -->

## Every card's headline figures, as published and on RB-1's box set

### F-0g ([report](../F0g/report.md))

**pilot-000** (machine agreement, never accuracy (INV-17))

| figure | as published | RB-1 |
|---|---|---|
| boxes | 6121 | 5757 |
| neighbour pairs | 4424 | 4367 |
| copy groups per photo | 5.00 (3.45 to 6.65) | 4.97 (3.42 to 6.65) |
| groups with a confirmed copy | 41 | 41 |
| confirmed boxes (F-0) | 731 | 726 |
| **extra confirmed boxes per photo** (confirmed-by-copy) | 0.29 (0.06 to 0.58) | 0.29 (0.06 to 0.58) |
| confirmed-by-copy boxes | 9 | 9 |
| visually same, both confirmed: different works (%) | 9.8 (2.7 to 19.4) | 9.8 (2.7 to 19.4) |
| hard-negative one-reader views | 420 | 432 |
| of them blocked (%) | 100.0 (100.0 to 100.0) | 100.0 (100.0 to 100.0) |

**yardstick** (PROXY, library shelves)

| figure | as published | RB-1 |
|---|---|---|
| boxes | 1116 | 1038 |
| copy groups | 15 | 15 |
| confirmed-by-copy boxes | 0 | 0 |
| wrong accepts with propagation | 22 | 22 |
| wrong share of accepted (%) | 8.2 (3.6 to 13.9) | 8.3 (3.7 to 14.0) |

propagation ships (`confirmed-by-copy`): yes → yes (no flip).

### Q-2b ([report](../Q2b/report.md))

**pilot-000** (machine agreement, never accuracy (INV-17))

| figure | as published | RB-1 |
|---|---|---|
| detected boxes | 6121 | 5757 |
| student population | 3555 | 3478 |
| τ | 0.72 | 0.73 |
| filled share of the population (%) | 59.6 (54.1 to 64.7) | 59.2 (53.6 to 64.2) |
| **student AUC** (leave one photo out) | 0.711 (0.664 to 0.754) | 0.710 (0.661 to 0.753) |
| gain over crop width | 0.297 (0.225 to 0.368) | 0.305 (0.232 to 0.377) |
| whole only: student AUC | 0.688 (0.640 to 0.734) | 0.687 (0.638 to 0.735) |
| precision of "filled" at FILL_P (%) | 75.9 (68.8 to 81.5) | 75.4 (68.0 to 81.0) |
| U-4 boxes drawn from their own outline (%) | 83.2 | 79.2 |
| U-4 filled spines (%) | 50.2 | 51.0 |

**yardstick** (PROXY, library shelves)

| figure | as published | RB-1 |
|---|---|---|
| detected boxes | 1116 | 1038 |
| student population | 793 | 757 |
| student AUC (one pilot fit) | 0.802 (0.746 to 0.870) | 0.797 (0.732 to 0.861) |
| precision of "filled" at FILL_P (%) | 93.3 (88.7 to 98.0) | 91.8 (86.4 to 97.7) |

Q-2's go rule (GO): no → no (no flip).

### H-2 ([report](../H2/report.md))

**pilot-000** (machine agreement, never accuracy (INV-17))

| figure | as published | RB-1 |
|---|---|---|
| over-selecting kept boxes (%) | 49.4 (46.4 to 52.6) | 49.1 (46.1 to 52.6) |
| trim feasible, of over-selecting (%) | 57.8 (53.5 to 61.7) | 58.4 (53.9 to 62.7) |
| **`face3d` confirmed Δ (pts)** | -0.3 (-1.2 to 0.7) | -0.4 (-1.4 to 0.6) |
| distinct confirmed works, `face3d` arm | 512 | 511 |
| distinct confirmed works Δ (`face3d` − `clip`) | -7 (-11 to 3) | -8 (-11 to 2) |

**yardstick** (PROXY, library shelves)

| figure | as published | RB-1 |
|---|---|---|
| over-selecting kept boxes (%) | 50.7 (43.6 to 57.8) | 49.9 (42.6 to 57.3) |
| `face3d` confirmed Δ (pts) | -1.9 (-4.6 to 0.5) | -2.0 (-5.1 to 0.6) |
| `face3d` wrong Δ (pts) | 0.5 (0.0 to 1.6) | 0.5 (0.0 to 1.7) |

`face3d` crop ships: no → no (no flip).

### S-1 ([report](../S1/report.md))

**pilot-000** (machine agreement, never accuracy (INV-17))

| figure | as published | RB-1 |
|---|---|---|
| rows | 168 | 167 |
| **void share** (pooled, %) | 1.2 (0.4 to 2.2) | 1.2 (0.4 to 2.2) |
| rows with a void (%) | 14.3 (8.0 to 21.8) | 14.4 (8.1 to 21.9) |
| candidate share (%) | 12.2 (9.9 to 14.8) | 12.4 (10.1 to 15.0) |
| of candidates, `outline-gap` (%) | 90.3 (84.2 to 96.6) | 90.3 (84.3 to 96.5) |
| `on-lip` removes (spine path) | 4 | 4 |
| `on-lip` removes confirmed | 0 | 0 |

**yardstick** (PROXY, library shelves)

| figure | as published | RB-1 |
|---|---|---|
| rows | 48 | 48 |
| void share (pooled, %) | 1.7 (0.6 to 3.2) | 1.8 (0.7 to 3.3) |
| candidate share (%) | 7.4 (4.5 to 10.7) | 7.5 (4.8 to 10.5) |
| `on-lip` removes (spine path) | 2 | 2 |

`on-lip` keep rule met: yes → yes (no flip).

### F-0h ([report](../F0h/report.md))

**pilot-000** (machine agreement, never accuracy (INV-17))

| figure | as published | RB-1 |
|---|---|---|
| half B: book boxes | 3238 | 3057 |
| half B: confirmed-by-context | 56 | 55 |
| **half B: extra confirmed per photo** | 3.50 (1.19 to 6.25) | 3.44 (1.19 to 6.19) |
| all 31 photos: confirmed-by-context | 90 | 89 |
| shuffle: share of real accepts (%) | 4.2 | 4.6 |
| shuffle: p95 seed (%) | 7.2 | 9.1 |
| leave one reader out: wrong of accepted | 0 | 0 |
| leave one reader out: accepted | 220 | 220 |

**yardstick** (PROXY, library shelves)

| figure | as published | RB-1 |
|---|---|---|
| book boxes | 1116 | 1038 |
| confirmed-by-context | 12 | 12 |
| wrong accepts with context (22 without) | 23 | 23 |
| wrong share of accepts with context (%) | 8.2 (3.9 to 13.6) | 8.3 (3.9 to 13.7) |

`confirmed-by-context` ships: yes → yes (no flip).

### Q-3 ([report](../Q3/report.md))

**pilot-000** (machine agreement, never accuracy (INV-17))

| figure | as published | RB-1 |
|---|---|---|
| books a person can see | 6068 (5058 to 7130) | 6064 (5053 to 7127) |
| **lost below `confirmed`** | 5244 (4428 to 6061) | 5240 (4425 to 6052) |
| lost share (%) | 86.4 | 86.4 |

**yardstick** (PROXY, library shelves)

| figure | as published | RB-1 |
|---|---|---|
| books a person can see | 1077 (893 to 1276) | 1075 (892 to 1272) |
| lost below `confirmed` | 799 (625 to 985) | 797 (623 to 982) |
| lost share (%) | 74.2 | 74.1 |
| annotated books found (reference, %) | 38.3 | 38.3 |

### Q-3 causes by books lost

`pilot-000` (machine agreement):

| rank now | cause | books lost now | rank before | books lost before |
|---|---|---|---|---|
| 1 | `catalog-gap` | 1322 (973–1707) | 1 | 1358 (1001–1748) |
| 2 | `frame-edge` | 885 (766–1006) | 2 | 877 (760–995) |
| 3 | `single-reader` | 740 (511–973) | 3 | 741 (511–974) |
| 4 | `tiling-or-side-case` | 643 (438–895) | 4 | 638 (437–885) |
| 5 | `top-face` | 642 (443–850) | 5 | 634 (438–840) |
| 6 | `misread` | 444 (338–557) | 6 | 435 (331–545) |
| 7 | `dark-or-low-contrast` | 225 (152–309) | 7 | 220 (147–305) |
| 8 | `shape-filter` | 117 (78–160) | 8 | 116 (77–158) |

Yardstick (PROXY):

| rank now | cause | books lost now | rank before | books lost before |
|---|---|---|---|---|
| 1 | `catalog-gap` | 272 (206–343) | 1 | 278 (210–351) |
| 2 | `single-reader` | 135 (104–170) | 2 | 135 (104–170) |
| 3 | `frame-edge` | 86 (56–123) | 3 | 86 (56–123) |
| 4 | `tiling-or-side-case` | 68 (48–91) | 4 | 68 (47–92) |
| 5 | `dark-or-low-contrast` | 55 (34–80) | 5 | 55 (34–80) |
