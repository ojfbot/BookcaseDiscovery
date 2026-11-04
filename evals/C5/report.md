# C5: Open Library breadth import (`catalog-v2.sqlite`)

Card C-5, 2026-11-03. **Question:** C-4 found that ISFDB holds 59.5 % (48.6–71.2) of `pilot-000`'s readable labels,
which fires OC20's reopening rule. Does adding Open Library in C-4's two layers (shelf-held plus a breadth layer of
English works first published 1960 or later with 2+ editions) close that gap, without breaking C-3's retrieval bar or
letting lookalikes through F-0's unchanged accept bar? What does it cost?

Counts and shares only. The per-box and per-spine detail stays in the data root (`catalog/c5/`, `private/c4/`).
Real-use figures (`pilot-000`) are machine agreement, never accuracy (INV-17); the yardstick is a PROXY (OC35).
Method and file layout: `docs/catalog.md` § Open Library breadth import (C-5). Numbers: `metrics.json`.

## Answer first

- **The breadth subset is 4,021,093 works** (exact count on the 2026-10-31 dump), under the 8M stop line, with
  12.3M editions. C-4's unstable search-API figure was 4.0M; the dump agrees. Projected index 5.3 GB; built **6.18 GB**
  in **8.4 minutes** (1.6 GB peak RAM).
- **Coverage of `pilot-000`'s readable labels: 59.5 % → 95.9 % (89.7–100)** on C-4's own sample, offline. That figure
  includes the shelf-held layer, which was built from this same sample, so it is the repeat-scan figure. **Without
  the shelf-held layer (first sightings): 84.2 % (74.5–93.4).**
- **C-3's bar holds:** clean golden fragments top-5 **100 %** on v2 (bar ≥ 90 %), top-1 unchanged at 98.9 %. Noisy
  fragments fall from 100 % to **95.6 %** top-5 (3 of 68 lost). **p95 latency is 5.8× v1's: 549 ms against 94 ms**
  on the same host today (C-3 recorded 79 ms).
- **Lookalike verdict: more wrong accepts per spine, beyond v1's interval, at the same precision.** On the yardstick
  (PROXY), v2 confirms 3.9 % of spines against v1's 1.1 % (+2.7 points, 1.4–4.2), and wrong accepts per spine rise
  from 0.5 % to 1.5 % (+1.0 point, 0.2–1.7). As a share of accepts, wrong accepts do not rise (46 % → 39 %,
  intervals overlap), but at about 40 % both are far worse than F-0's closed-set 9 %. Top-1/top-2 margins shrink.
  **Proposal below: a bar change for open catalogs, not made here.** On `pilot-000` (real use), confirmations rise
  from 10.4 % to **14.4 %** of spines (+4.0 points, 2.0–6.2). 342 of them are Open Library works, and 34
  confirmations switch to another work, 31 of them to an Open Library one. Without labels, those switches cannot be
  called right or wrong.

## 1. Subset counts (Open Library dump 2026-10-31)

Every count is exact, from one streaming pass over the three dumps (`pnpm catalog:ol measure`, 436 s).

| subset | works |
|---|---:|
| all works | **41,731,960** |
| English-language (any edition lists `/languages/eng`) | 21,871,726 |
| first published 1960 or later (earliest year of the work or any edition) | 33,165,743 |
| at least two editions | 6,392,308 |
| **breadth: all three** | **4,021,093** |
| shelf-held (layer 1) | 171 (86 of them outside breadth) |
| **kept (either layer)** | **4,021,179** |
| works with no known year | 1,534,338 |

Editions: 56,900,884 in the dump; **12,308,591 belong to kept works**; 1,882,101 name no work and 4,518 name a
work missing from the works dump (both dropped). Authors: 15,474,645 in the dump, 2,274,469 needed. One editions line
was malformed and skipped; no other line was.

**Shelf-held layer.** C-4's private tables hold 80 distinct resolved books (sample and tuning). They match 171 Open
Library works: 76 by the resolving record's work key, 8 by ISBN, 87 by title plus author surname. Most of the
title-plus-surname matches are Open Library's own duplicate work records of the same book. Only 34 of these works
were new to the catalog. The rest crosswalked to ISFDB or were already breadth works.

## 2. Crosswalk and the built catalog

| | |
|---|---:|
| Open Library works merged | 4,021,179 |
| crosswalked to an ISFDB work by ISBN | 90,297 (8,484 of them with a title key that differs: a quality probe, see caveats) |
| crosswalked by title plus author surname | 26,407 |
| **new works** (`ol:OL<n>W`) | **3,904,375** (34 shelf-held only) |
| editions added | 12,070,318 (278,371 of them to ISFDB works) |
| authors added / Open Library authors folded into an ISFDB author by name | 2,063,865 / 348,936 |
| **catalog-v2.sqlite** | **4,245,204 works, 13,014,235 editions, 4,723,111 title forms; 6,178,123,776 bytes** |

`catalog.sqlite` (v1, 426 MB) was not modified. v2 is schema version 2 (`editions.source`), and readers accept both.

## 3. C-3 golden fragments on v1 and v2

Same 161 hand-written queries (sha256 `9b464c41…`), same code, same host, back to back. No catalog gaps on either.

| subset | n | v1 top-1 | v1 top-5 | **v2 top-1** | **v2 top-5** | v2 top-10 |
|---|---:|---:|---:|---:|---:|---:|
| **clean** (bar ≥ 90 % top-5) | 87 | 98.9 % | 100 % | 98.9 % | **100 %** | 100 % |
| noisy | 68 | 95.6 % | 100 % | 94.1 % | **95.6 %** | 97.1 % |
| clean, test half | 43 | 97.7 % | 100 % | 97.7 % | 100 % | |
| noisy, test half | 34 | 94.1 % | 100 % | 94.1 % | 94.1 % | |

| latency per `retrieve` (warm) | p50 | **p95** | max | mean |
|---|---:|---:|---:|---:|
| C-3 (2026-11-02) | 31.5 ms | 78.7 ms | 110 ms | 35 ms |
| v1, today | 35.4 ms | 93.8 ms | 125 ms | 40 ms |
| **v2** | 195.6 ms | **548.5 ms** | 1,737 ms | 247 ms |

**The three lost noisy queries** (top-5 to out of the top 5): `n025` "UBIK PHILIP K. DI" (rank 1 → not in the top 10),
`n062` "PERMUTATION CI TY GREG EG" (3 → 8), `n066` "BABEL-l7 DELANY" (5 → not in the top 10). Two mechanisms, neither
a scoring change:

- **Candidate generation is capped.** "Ubik" still scores 0.759 when it is a candidate, but on v2 it is never one. The
  title FTS query ORs every phrase of the spine, so the tens of thousands of short Open Library titles containing
  "philip" outrank the one "ubik" form for the 250 slots. Raising `ftsLimit` to 2,500 (a diagnostic run, not adopted)
  recovered only one of the three and tripled p95.
- **Crowding by same-word titles.** "Babel" and "Permutation(s)" now have many Open Library namesakes. With the
  author truncated ("GREG EG") or misread, they tie or beat the target.

The no-match queries (cookbook, atlas, dictionary, textbook) now have real candidates (top score max 0.721 → 0.933),
because v2 holds those books. That class no longer means "not in the catalog" on v2.

## 4. Coverage of C-4's sample, offline

C-4's 235 sampled boxes (72 resolved) re-checked against each catalog with C-4's `isfdbHolds` (ISBN first, then
clean title plus surname), weighted to F-0's population with C-4's stratified bootstrap (10,000 resamples, seed
20261103). No network call. The v1 run reproduces C-4 exactly.

| catalog | A: unresolved excluded | B: unresolved as not held | match miss (of readable) |
|---|---:|---:|---:|
| v1 (ISFDB) | 59.5 % (48.6–71.2) | 16.2 % (12.6–19.9) | 28.8 % |
| **v2** | **95.9 % (89.7–100)** | 26.1 % (20.7–31.5) | 65.1 % |
| **v2 without the shelf-held layer** (first sightings) | **84.2 % (74.5–93.4)** | 22.9 % (18.0–27.8) | 53.4 % |

20 of the 72 resolved boxes change class (all toward "held"). On v2, 2 sampled resolved boxes remain not held; 9
without the shelf-held layer.

Read the v2 row as the repeat-scan figure: the shelf-held layer was built from exactly these resolved books. The
first-sighting figure removes every Open Library row that came in only through that layer. Even so, it is above
C-4's 85 % trigger. **Match miss grows to most of the readable labels.** That is the point of the import: books F-0
left `unknown` are now in the catalog, and turning them into confirmations is F-0's matching (a rerun of F-0 on v2,
not done here).

## 5. Lookalike risk: F-0's cached readings re-decided on v1 and v2

F-0's cached reader output per spine, re-decided offline by F-0's own `decide` with F-0's unchanged bar
(`ACCEPT`: score ≥ 0.72, title evidence ≥ 0.8, coverage ≥ 0.5, two readers agree). Before anything else, each set
was re-decided on the catalog F-0 used and reproduced every cached decision (1.000). Intervals: image-cluster
bootstrap, 2,000 resamples.

### Yardstick `yardstick-library-b2` (PROXY: 40 photos, 1,132 spines; a Barcelona library)

F-0 scored the yardstick against a closed set (the dataset's own 15k-book inventory). Against an open catalog, a
**wrong accept** here is an accepted work that matches none of the photo's annotated books, by ISBN on any edition
or by main title plus an author surname (the judge, `isAnnotated`).

| catalog | confirmed | confirmed share | Open Library works | wrong accepts | **wrong share of accepts** | **wrong per spine** |
|---|---:|---:|---:|---:|---:|---:|
| F-0's inventory catalog (closed set, reference) | 269 | 23.8 % (18.3–29.7) | — | 24 | 8.9 % (5.1–13.5) | 2.1 % (1.2–3.2) |
| v1 (ISFDB) | 13 | 1.1 % (0.3–2.3) | — | 6 | 46.2 % (25.0–83.3) | 0.5 % (0.1–1.1) |
| **v2** | **44** | **3.9 % (2.0–6.3)** | 34 | **17** | **38.6 % (21.5–63.0)** | **1.5 % (0.6–2.4)** |
| **v2 − v1** (paired) | +31 | **+2.7 points (1.4–4.2)** | | +11 | | **+1.0 point (0.2–1.7)** |

Transitions v1 → v2: 33 spines gained a confirmation (13 of them wrong), 2 lost one (to `readers-disagree`), 1
switched work (to an Open Library work, wrong), 10 unchanged. The wrong accepts are mostly short generic titles that
match a word on the spine ("Africa", "Asia", "Tibet", "Catalan", "Lonely Planet"), a person's name that is also a
title, same-title books by another author, another book by an annotated author, and editions in another language.

**Top-1 / top-2 score margin** per reader reading (the gap between the best and the second-best work):

| catalog | readings | p10 | p25 | p50 | p75 | margin < 0.02 | margin < 0.05 |
|---|---:|---:|---:|---:|---:|---:|---:|
| inventory (closed set) | 2,021 | 0.009 | 0.044 | 0.164 | 0.298 | 14.4 % | 26.6 % |
| v1 | 2,023 | 0 | 0.007 | 0.023 | 0.053 | 44.4 % | 73.6 % |
| **v2** | 2,038 | 0 | 0 | 0.017 | 0.044 | **53.8 %** | **78.7 %** |
| *only readings whose top-1 passes the bar:* | | | | | | | |
| inventory | 700 | 0.156 | 0.246 | 0.326 | 0.403 | 3.9 % | 4.9 % |
| v1 | 45 | 0 | 0 | 0.084 | 0.200 | 31.1 % | 46.7 % |
| **v2** | 164 | 0 | 0.010 | 0.071 | 0.181 | 29.9 % | 38.4 % |

### `pilot-000` (real use, machine agreement only: 31 photos, 6,894 spines)

| catalog | confirmed | confirmed share | Open Library works | `single-reader` | `readers-disagree` | `no-catalog-match` | `no-text` |
|---|---:|---:|---:|---:|---:|---:|---:|
| v1 (ISFDB) | 718 | 10.4 % (6.7–14.0) | — | 923 | 80 | 3,435 | 1,738 |
| **v2** | **992** | **14.4 % (11.4–17.2)** | 342 | 1,371 | 189 | 2,604 | 1,738 |
| **v2 − v1** (paired) | +274 | **+4.0 points (2.0–6.2)** | | | | | |

Transitions v1 → v2: **311 gained** a confirmation, **37 lost** one (18 to `readers-disagree`, 15 to
`single-reader`, 4 to `no-catalog-match`), **34 switched** work (31 to an Open Library work), 647 unchanged. A loss or
a switch is where a namesake now competes. `readers-disagree` more than doubles (80 → 189): readers that agreed on an
ISFDB work now land on different works with the same words. No accuracy can be stated here (no labels, INV-17), and
the switches are exactly the cases a person would have to look at.

| top-1 / top-2 margin | readings | p25 | p50 | p75 | < 0.02 | < 0.05 |
|---|---:|---:|---:|---:|---:|---:|
| v1, all | 9,419 | 0.008 | 0.040 | 0.117 | 36.1 % | 54.8 % |
| v2, all | 9,785 | 0 | 0.034 | 0.122 | 41.7 % | 57.8 % |
| v1, top-1 passes the bar | 2,538 | 0.065 | 0.168 | 0.251 | 14.5 % | 22.0 % |
| **v2, top-1 passes the bar** | 3,843 | 0.020 | 0.124 | 0.215 | **24.9 %** | **32.8 %** |

One in four confirming readings on v2 has a runner-up within 0.02 of it, against one in seven on v1.

### Verdict

**Wrong accepts per spine rise beyond v1's interval** on the yardstick: v2's 1.5 % is above v1's upper bound (1.1 %),
and the paired difference excludes zero. The share of accepts that are wrong does not rise, but it is already about
40 % on both open catalogs, against 9 % on the closed set F-0's bar was set for. About a third of the confirming
top-1 readings have a runner-up within 0.02. F-0's bar was set on C-3's golden set and never had to separate a book
from its namesakes. **The bar was not changed or tuned here.**

**Proposal (for the conductor; not adopted, not evaluated):** before the default switches to v2, add a lookalike
guard to F-0's accept rule for open catalogs. Candidates, to be pre-registered and evaluated on the yardstick's other
arms or a fresh sample, never tuned on this run:

1. **Margin:** the agreed work's score beats the best *different* work (one that is not the same title by the same
   author) by at least a fixed gap, for example 0.05.
2. **Author evidence:** an accepted work must have author evidence above zero when its title is a single word or is
   one of many works with the same title form.
3. **Short-title rule:** a one-token title match needs the author, or a second field, to be confirmed.

## 6. Costs

| step | time | peak RAM | output |
|---|---:|---:|---|
| download (3 files, MD5 checked) | about 3 h 20 min (archive.org gave about 0.2 MB/s per connection; 6 + 12 ranged connections) | — | **17,493,844,615 bytes** (editions 12.63 GB, works 4.08 GB, authors 0.78 GB) |
| measure (one pass, 3 dumps) | 436 s | 0.92 GB | per-work facts, counts |
| stage (second pass, kept rows) | 520 s | 1.06 GB | `ol-staging.sqlite`, 2.79 GB |
| **build** (ISFDB + crosswalk + merge + FTS optimise) | **503 s** | **1.62 GB** | **`catalog-v2.sqlite`, 6.18 GB** (projected 5.30) |

Every step ran at `nice -n 10` beside F-0d and F-0e. Disk: about 278 GB free before, 250 GB after (dumps 17.5 GB,
staging 2.8 GB and catalog 6.2 GB kept). Latency is the running cost: see §3.

## Caveats

- **The coverage sample built the shelf-held layer**, so the v2 coverage figure is circular for those books; the
  first-sighting figure is the honest one for a new shelf. Both rest on C-4's resolver, whose sensitivity on good
  text was about 60 %.
- **The yardstick judge was adjusted once, post hoc.** The first run judged wrong accepts with English articles only
  and a date-stripping rule that missed "1470?-1541". This yardstick is a Spanish and Catalan library, so true
  matches such as "El Baile de la Victoria" were counted wrong. The judge now drops Spanish and Catalan articles too
  and strips any trailing dated part. It was applied to all three catalogs; F-0's closed-set figure did not change
  (8.9 %). The judge is still an approximation: an annotated book in another language, or with a subtitle-only
  title, can be called wrong.
- **ISBN crosswalks whose title differs (8,484 of 90,297)** are taken as Open Library's ISBN data says. Some will be
  wrong ISBNs in Open Library (it holds many), which fold an unrelated work into an ISFDB work. They were not checked
  one by one.
- **Open Library's duplicate works stay separate.** Two records of one book become two works with the same forms.
  They tie, and F-0's tie-break is deterministic, so readers agree. But they make the catalog larger, and a
  reader's confirmation may land on either.
- **Author names are as Open Library has them.** Some records fold a narrator or a corporate body into the name. A
  new Open Library work has no series, no tags and `ttype` `BOOK`.
- **Latency.** v2 is 5.8× slower at p95. I-1 with 4 to 6 variants per spine should expect about 0.5 to 1.5 s per
  spine on this Mac. The levers (per-phrase FTS caps, a rare-phrase pass, a smaller breadth layer) are `retrieve`
  changes, out of this card's scope.
