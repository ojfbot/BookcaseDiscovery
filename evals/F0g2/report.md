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

<!-- results -->
