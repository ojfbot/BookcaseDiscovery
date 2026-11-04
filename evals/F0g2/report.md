# F0g2: pooled reading for copy groups (F-0g2)

Card F-0g2, 2026-11-04. **Question:** a bookstore often shelves several copies of one book together, and sometimes
none of them is confirmed. Each copy is a different crop of a different physical book, so its reader text is new
pixel evidence, not a repeat read of one crop. Can the copies' fragments, fused character by character as in
multi-frame OCR fusion and looked up once in the catalog, say what the book is? And can they do it without pooling
two books of one author's series into one?

Two sets, never merged (OC35):

- **`pilot-000`**: 31 real-use photos. Every reader figure is **machine agreement, never accuracy** (INV-17).
- **The yardstick (PROXY, library shelves)**: the 40-image Library Dataset sample. Evaluation only; nothing is
  trained or tuned on it.

No hand labels (OC36), no paid calls, no GPU, no new reads: CPU only, from cached readings. Aggregates only; photos,
crops, reads and titles stay under the data root.

## Pre-registration (committed before the first measured run)

Fixed before any pooled reading was looked up in the catalog. Nothing below changes after a result is seen; a change
would be logged as a deviation in `implementation-notes.md`, with the figures it touches.

**Looked at before writing this (disclosed).** Counts of structure only, no outcome:

- On `pilot-000`, F-0g's 155 copy groups include 113 with no `readers-agree` copy (248 copies). Groups with two or
  more copies read by one reader model: Vision 64, PP-OCR 68, Qwen 20.
- Of the 41 groups with a confirmed copy, 3 keep two or more copies that are not `readers-agree`. 5 keep one, and
  33 are all confirmed.
- On the yardstick, 14 of its 15 groups have no confirmed copy (35 copies). Its one confirmed group is all confirmed.
- One `pilot-000` group holds a box that F-0i's partition drops.

### Base and box set

The base is F-0g as shipped. Its cached neighbour pairs, appearance similarities and reader tops are used, with its
frozen `VISUAL` score and threshold, its series guard (`pairGuard`, imprint arm included) and its copy groups.
F-0i's partition ships as the geometry cache, and its consumers ignore dropped boxes. So links that touch a box F-0i
drops are removed, and the groups are re-formed from the links left; a group needs two copies.

The readings are each set's cached F-0 readings (`SETS[set].base`), and the decisions are F-0's (`f0c`'s
`base-decisions`). The catalog is each set's default catalog, with C-3's default candidate generation (C-8's stays
opt-in). F-0's decision, F-0g's `confirmed-by-copy` and F-0h's `confirmed-by-context` are unchanged.

### The pooled reading (`src/eval/f0g2.ts`, pure)

A group is **eligible** when no copy in it is `readers-agree`. For each reader model R, a pooled reading is made from
every copy's R reading, in five steps.

1. **Texts.** Each copy's R variants, after `variantsOf`, normalised as the catalog normalises them (`normalize`).
2. **Alignment.** Overlap alignment: match +1, mismatch −1, gap −1 inside the aligned span, and free end gaps on both
   strings. A fragment can therefore be a prefix, a suffix or a piece of another read. Two texts *overlap* when
   their best score is at least 3.
3. **Centre and orientation.** The **centre** is the variant, over all copies, with the highest summed score against
   the best-matching variant of each other copy. Ties go to the longer text, then to shelf order. Every other copy
   contributes the variant that scores best against the centre. A reader's rotations therefore line up without the
   catalog.
4. **Character consensus** (centre-star). Each other copy's text that overlaps the centre is aligned to it.
   - For every centre character, each overlapping text that spans it votes: its aligned character, or an interior
     deletion. Texts that do not span the position abstain. An end gap is a fragment's missing part, never a vote.
   - For the slot between two centre characters, the spanning texts vote on an insertion. A run is inserted only when
     a strict majority of them insert it.
   - Ties go to the centre, so two copies give the centre corrected nowhere. Three or more give a majority vote.
   - A text that runs past either end of the centre extends the consensus with its overhang (the longest overhang on
     each side).
   - The result is the **fused-aligned** text.
5. **Union.** The **fused-all** text is the fused-aligned text plus, after a space, each copy text that does not
   overlap the centre, in shelf order. A title read on one copy and an author on another are both kept. Retrieval
   ignores word order.

**One vote per reader model (INV-6).** R's pooled variants are the fused-aligned and fused-all texts, when two or
more copies have R text, plus every copy's own R variants. They make **one** `retrieve` call (top 3, C-3
generation), and its top candidate is R's single vote for the group. Its errors correlate across copies, so a model
that read four copies still counts once. R's vote **confirms** only when that candidate passes F-0's bar on the
pooled reading (`confirms`: score ≥ 0.72, title evidence ≥ 0.8, coverage ≥ 0.5). Reader models' votes for the group
go through F-0's `vote`: at least two models must confirm one work, and the work must be unique.

### Decision per copy (`confirmed-by-pooling`)

When an eligible group's pooled vote names work W, each copy gets the new decision basis **`confirmed-by-pooling`**
only if:

- its own reads do not contradict W (F-0g's `contradiction`: no reader confirming another work, and no other title
  read with title evidence ≥ 0.8 that outscores W); and
- at least one of its own readers is consistent with W (F-0g's `consistentReaders`: W's title evidence on that
  reader's text ≥ 0.5).

These are F-0g's per-copy tests. Otherwise the copy stays unknown with the reason recorded. Copies are never merged
(INV-4): each keeps its own box and decision, and its record holds:

- the group and its size;
- the basis and the work;
- the **source copies** (whose text is in a supporting model's winning variant);
- the **supporting reader models**;
- per model, how many copies were fused and whether the winning variant was fused or a single copy's.

### Evaluation

Intervals are 95 %, from 2,000 photo-bootstrap resamples. Shares judged against a bar also get a Wilson 95 % upper
bound. All views below run the same code as the decision, with confirmations hidden: no copy is `readers-agree` in
a view, while each reader's own `passes` stays as computed.

1. **Leave one reader out (LORO), on confirmed groups.** The groups are those with a `readers-agree` copy whose
   `readers-agree` copies all name one work W (mixed groups are left out and counted). For each reader model that
   read text in the group, that model's readings are removed from every copy and the whole group is pooled.
   - **Outcome:** right (W), wrong (another work) or none.
   - **Trivial view:** some copy still has two remaining models confirming one work on its own text, so F-0 would
     decide it without pooling. Non-trivial views are where pooling is needed.
2. **Hide the confirmed copy.** In groups with a confirmed copy, each `readers-agree` copy h is hidden in turn, and
   the copies left are pooled. That needs two or more copies left; groups with fewer are counted and skipped.
   - **Views:** all readers, and each model left out of the remaining copies.
   - **Target:** h's work. Outcomes and trivial views as in LORO.
3. **Hard negatives: shared author, different work.** These are F-0g neighbour pairs (F-0i drops removed) that are
   both `readers-agree`, different works and share an author. Each pair is pooled as a two-copy group, with all
   readers and with each model left out. A view does **harm** when pooling gives either copy a work other than its
   own confirmed one; "pooled into one" (both copies get one work) is the worst case.
   - **Gated:** the pair passes F-0g's gates in that view: `visuallySame`, and `pairGuard` on the view's evidence
     with acceptances hidden.
   - **Ungated:** the pair is forced to pool. This shows what the gates are protecting against.
4. **Yardstick wrong accepts.** Accepted boxes whose work is not annotated in the image, before pooling and with it,
   and boxes labelled a work beyond its annotated copies. Few groups there are eligible (14, with 35 copies), so this
   part can only show harm, not an error rate. The report says so rather than claim one.

**Measures, per set.** Eligible groups and copies. Groups pooled to a work. Boxes `confirmed-by-pooling` per photo
(paired photo bootstrap) and as a share of boxes. Copies blocked, by reason. Supporting models. The share of
supporting votes won by a fused variant against a single copy's. The **no-fusion arm**: the same rule with only the
copies' own variants (cross-copy agreement without fusion), to show what fusion adds. On `pilot-000` only, agreement
with F-0h's `confirmed-by-context`: the overlap, the same work, a different work, and pooled boxes F-0h did not
confirm. Seconds.

### Keep rule

`confirmed-by-pooling` ships, on as a recorded and switchable basis, only if all of these hold:

| part | test |
|---|---|
| **K1** lift (`pilot-000`) | boxes `confirmed-by-pooling` per photo have a 95 % interval excluding 0 |
| **K2** leave one reader out (`pilot-000`) | in non-trivial LORO views, wrong outcomes are at most 5 % of the views pooling confirms (point estimate; Wilson upper bound reported). With no confirming view, the part is unmeasured and not met. |
| **K3** hide the confirmed copy (`pilot-000`) | wrong outcomes are at most 5 % of the views pooling confirms, all views. With no confirming view the part is reported unmeasured and does not block: few groups of three or more have a confirmed copy. |
| **K4** hard negatives (both sets) | **no** gated view does harm |
| **K5** yardstick wrong accepts | the paired per-image change in wrong accepts has a lower bound ≤ 0, and the wrong share of accepted boxes with pooling stays inside the base's 95 % interval (F-0g's rule). If nothing pools there, it passes vacuously and is reported as vacuous. |

If any part fails, pooling stays off. The groups, pooled readings and views are then reported only, and no copy is
labelled `confirmed-by-pooling` in the shipped record.

## Results (run 2026-11-04, after the pre-registration above)

The pre-registration is commit `916d9e1`. Aggregates are in [`metrics.json`](metrics.json). The tables below the
marker are generated by `node src/eval/f0g2-cli.ts analyse`, which takes about 3 minutes on the CPU. The two sets
are reported apart (OC35), and `pilot-000` figures are machine agreement, never accuracy (INV-17).

### Verdict: keep rule not met, so `confirmed-by-pooling` stays off

K1 fails, and K2 to K5 hold:

| part | result |
|---|---|
| **K1** lift | **fails.** `pilot-000` gains **0.00 boxes a photo (0.00 to 0.00)**: 0 boxes. |
| **K2** leave one reader out | 0 wrong of 10 pooled confirmations in non-trivial views (Wilson upper 27.8 %) |
| **K3** hide the confirmed copy | 0 wrong of 27 (Wilson upper 12.5 %) |
| **K4** hard negatives | no gated view does harm |
| **K5** yardstick | passes vacuously: nothing pooled there |

What follows from K1:

- **Only 1 of 113 eligible groups pooled to a work.** That group's 3 copies stay unknown: on each copy, PP-OCR's top
  candidate is another title read with full title evidence, and the series guard blocks it. So nothing is labelled,
  and the shipped record carries no `confirmed-by-pooling` copy. F-0's, F-0g's and F-0h's decisions are unchanged.
- **The obstacle is upstream of fusion.** Of the 113 eligible groups:
  - 24 have no reader text on any copy (`no-text`);
  - 51 have no model's pooled reading past F-0's bar (`no-catalog-match`);
  - 35 have exactly one model past it (`single-reader`: Vision 17, Qwen 12, PP-OCR 6);
  - 2 have models that disagree.

  Fusion itself works: 15 model votes confirmed a work on a fused text that no single copy's text reached. But a
  second model past the bar is missing in nearly every group.
  - In 15 groups only one model read any copy at all. Qwen reads only hard crops, under a cap.
  - Q-3 ranks `catalog-gap` first on this set. Copies shelved together without a confirmed one are probably new
    titles the default catalog does not hold, and that is a *hypothesis*.
- **Where the reads are cleaner, pooling recovers the right work and never the wrong one.**
  - **Leave one reader out (K2).** Of the 74 non-trivial views on the 41 confirmed groups (one model removed from
    every copy, and no copy decidable on its own), pooling confirms 10 (13.5 %, 5.4–27.3), all the right work. 4 of
    them won on a fused text. Over all 96 views: 32 confirmed, 0 wrong.
  - **Hide the confirmed copy (K3).** Hiding each confirmed copy in groups of three or more gives 14 hidden copies
    (64 skipped with fewer than two left) and 50 views. Of them, 27 recover the hidden copy's work and none names
    another; 6 of the 27 come from non-trivial views.

  These views read more cleanly than the eligible groups, so the precision is an optimistic figure.
- **Hard negatives (K4).** On `pilot-000`, 92 neighbour pairs share an author but are different works, both
  confirmed: 311 views. None gets past F-0g's gates once acceptances are hidden, because the series guard's
  `reads-differ` arm blocks every one. Forced to pool without the gates, 104 views still pool to some work. In each
  of them F-0g's per-copy tests leave the copy whose work it is not unknown, so **no copy is labelled another book's work and no
  pair is pooled into one** (0 of 311). On the yardstick: 19 pairs and 62 views, the same result.
- **Yardstick (K5).** 14 of its 15 groups are eligible (35 copies), and none pools: 8 have no model past the bar, 6
  have no text. Wrong accepts stay at 22 (8.3 %). This shows no harm, but it cannot show an error rate.
- **No-fusion arm.** Cross-copy agreement without fused texts pools the same single group and labels 0 boxes. On
  this set's eligible groups, fusion adds no group.

### What would change the verdict

The evidence rule (one vote per model, two models, F-0g's per-copy tests) held on every check that could break it.
The lift is missing because too few models read past the bar.

Re-run `analyse` unchanged, against this keep rule, when any of these lands:

- a second reader on more copies (Qwen beyond its hard-crop cap);
- a catalog that holds the shelved titles (C-5's catalog-v2 as a default);
- F-0j's per-zone fields.

Each lookup is cached, so a re-run on the same readings takes seconds.

### Limits

- **Small samples.** K2 rests on 10 confirmations and K3 on 27, so their Wilson upper bounds (28 % and 12 %) are far
  above the 5 % bar. Zero wrong is a point estimate, not a guarantee.
- **The box set** is F-0g's groups less F-0i's drops: 154 groups on `pilot-000`, one fewer than F-0g's 155. F-0g's
  own groups were formed before F-0i, and they are not re-derived on the partition here (see the deviations).
- **Trivial views.** A view is trivial when a copy still has two models confirming one work on its own text, so F-0
  would decide it alone. Only the non-trivial views test pooling.
- **The hide test** includes groups whose other copies are also confirmed, with their confirmations hidden. Strictly
  hiding every confirmed copy would leave 3 groups (see the deviations).

<!-- results -->
### pilot-000 (real use): machine agreement, never accuracy

31 photos, 5761 book boxes kept (360 dropped by F-0i). Intervals: 95 % photo bootstrap.

| measure | value |
|---|---|
| copy groups (F-0g, F-0i drops removed); eligible (no confirmed copy) | 154; 113 with 248 copies (sizes 2: 94, 3: 16, 4+: 3) |
| eligible groups pooled to a work (two models agree) | 1 of 113; not pooled: no-catalog-match 51, single-reader 35, no-text 24, readers-disagree 2 |
| **boxes confirmed-by-pooling per photo** | **0.00 (0.00 to 0.00)** (0 boxes; +0.00 pts (0.00–0.00) of boxes; base 735 confirmed by F-0 and F-0g) |
| copies in pooled groups left unknown | reads-other-title 3 |
| supporting models | vision 1, qwen 1; 1 of 2 supporting votes won by a fused text |
| model votes with two or more copies fused; of them confirming on a fused text | 152; 15 |
| no-fusion arm (cross-copy agreement only) | 1 groups, 0 boxes; per photo 0.00 (0.00 to 0.00) |
| against F-0h's confirmed-by-context | 0 pooled boxes also context-confirmed (0 same work, 0 different); 0 not context-confirmed |
| leave one reader out: confirmed groups (mixed left out) | 41 (0); 96 views, 22 trivial |
| **LORO non-trivial: wrong of pooled confirmations** | **0 of 10 (0.0 %; Wilson upper 27.8 %)**; recovered 13.5 % (5.4–27.3) of 74 views; 4 won by a fused text |
| LORO all views: wrong of pooled confirmations | 0 of 32 (0.0 %; Wilson upper 10.7 %); recovered 33.3 % (17.5–52.2) |
| hide the confirmed copy: copies hidden (skipped, fewer than two left) | 14 (64); 50 views |
| **hide: wrong of pooled confirmations** | **0 of 27 (0.0 %; Wilson upper 12.5 %)**; recovered 54.0 % (18.7–76.9); non-trivial views 29, confirmed 6, wrong 0 |
| hard negatives (shared author, different work, both confirmed) | 92 pairs, 311 views, 0 past F-0g's gates |
| **hard negatives past the gates: views doing harm (pooled into one)** | **0** (0) of 0 |
| hard negatives forced to pool (no gates): harm (pooled into one) | 0 (0) of 311; 0.0 % (0.0–0.0); pooled to some work 104 |
| runtime | 0 s (0 new catalog lookups, 683 cached) |

### yardstick (PROXY, library shelves)

40 photos, 1040 book boxes kept (76 dropped by F-0i). Intervals: 95 % photo bootstrap.

| measure | value |
|---|---|
| copy groups (F-0g, F-0i drops removed); eligible (no confirmed copy) | 15; 14 with 35 copies (sizes 2: 8, 3: 5, 4+: 1) |
| eligible groups pooled to a work (two models agree) | 0 of 14; not pooled: no-catalog-match 8, no-text 6 |
| **boxes confirmed-by-pooling per photo** | **0.00 (0.00 to 0.00)** (0 boxes; +0.00 pts (0.00–0.00) of boxes; base 266 confirmed by F-0 and F-0g) |
| copies in pooled groups left unknown | none |
| supporting models | none; 0 of 0 supporting votes won by a fused text |
| model votes with two or more copies fused; of them confirming on a fused text | 19; 0 |
| no-fusion arm (cross-copy agreement only) | 0 groups, 0 boxes; per photo 0.00 (0.00 to 0.00) |
| leave one reader out: confirmed groups (mixed left out) | 1 (0); 3 views, 1 trivial |
| **LORO non-trivial: wrong of pooled confirmations** | **– (none confirmed)**; recovered 0.0 % (0.0–0.0) of 2 views; 0 won by a fused text |
| LORO all views: wrong of pooled confirmations | 0 of 1 (0.0 %; Wilson upper 79.3 %); recovered 33.3 % (33.3–33.3) |
| hide the confirmed copy: copies hidden (skipped, fewer than two left) | 0 (2); 0 views |
| **hide: wrong of pooled confirmations** | **– (none confirmed)**; recovered –; non-trivial views 0, confirmed 0, wrong 0 |
| hard negatives (shared author, different work, both confirmed) | 19 pairs, 62 views, 0 past F-0g's gates |
| **hard negatives past the gates: views doing harm (pooled into one)** | **0** (0) of 0 |
| hard negatives forced to pool (no gates): harm (pooled into one) | 0 (0) of 62; 0.0 % (0.0–0.0); pooled to some work 20 |
| **yardstick wrong accepts** (accepted work not annotated in the image) | 22 → 22; per image Δ 0.00 (0.00 to 0.00); share of accepted 8.3 % (3.8–14.0) → 8.3 % (3.8–14.0) |
| boxes labelled a work beyond its annotated copies | 3 → 3 |
| runtime | 0 s (0 new catalog lookups, 85 cached) |

### Keep rule

| part | met |
|---|---|
| K1 pilot-000 boxes confirmed-by-pooling, interval excluding 0 | no |
| K2 leave one reader out, non-trivial: wrong ≤ 5 % of pooled confirmations | yes |
| K3 hide the confirmed copy: wrong ≤ 5 % of pooled confirmations | yes |
| K4 hard negatives: no gated view does harm | yes |
| K5 yardstick wrong accepts do not rise beyond their interval | yes (vacuous: nothing pooled) |
| **ship confirmed-by-pooling** | **no** |

