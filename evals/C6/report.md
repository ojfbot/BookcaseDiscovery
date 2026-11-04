# C6: lookalike guard for open catalogs, then the catalog-v2 switch

Card C-6, 2026-11-03. **Question:** C-5's `catalog-v2.sqlite` (ISFDB plus Open Library) lifts first-sighting
coverage of `pilot-000`'s readable labels from 60 % to 84 %, but on the yardstick (PROXY) F-0's unchanged bar lets
more lookalikes through: wrong accepts per spine 0.5 % → 1.5 % (+1.0 point, 0.2–1.7), about 40 % of accepts. Can a
**lookalike guard** on F-0's accept rule hold wrong accepts at v1's level while keeping v2's extra confirmations, so
the default catalog can switch to v2?

Counts and shares only. Real-use figures (`pilot-000`) are machine agreement, never accuracy (INV-17); the
yardstick is a PROXY (OC35); the two are never pooled. No hand labels (OC36). Nothing below was tuned on the
yardstick or on `pilot-000`.

## Pre-registration

Written and committed before anything was run on `catalog-v2.sqlite`. The only v2 access before this commit was a
schema look (the `title_norm` format and the `title_forms.kind` counts), no retrieval and no decision. The guard
constants are `LOOKALIKE` in `src/catalog/lookalike.ts`, frozen in this commit.

### What the guard is

A test on **one reader's** ranked candidates (`retrieve` on that reader's variants, the same scoring and ranking as
F-0, depth 50). A reader confirms a work only when its top candidate passes F-0's bar (`confirms`, unchanged) **and**
passes the guard's arms in force. Then F-0's vote runs unchanged: two readers must confirm the same work. The guard
can only withdraw a reader's confirmation, so it can never add an accept or switch one to another work (with three
readers, a withdrawn vote leaves either the same majority or no majority). A spine it stops falls to F-0's existing
reasons (`single-reader`, `no-catalog-match`, `readers-disagree`); no new reason is added to the label notes.

**Same book.** Two candidates are one book when they are one work id; or have the same normalised title by a shared
author surname (F-0g's `sameWork`, moved to `src/catalog/lookalike.ts` and re-exported by F-0g); or, by a shared
surname, share a main title or any whole or main title form, own or variant (`title_norm` kinds T, M, V, W;
subtitle-only forms are left out, since "a novel" is not a title). Open Library duplicate works of one book and
ISFDB omnibuses recorded under one of their books' titles are therefore one book and never each other's lookalike.
A crosswalked record is already one work id.

### Arms (each alone, then combinations)

| arm | rule | constant | why this value |
|---|---|---|---|
| **(a) margin** | the work's score beats the best *different* book among the reader's top 50 by at least the margin | `margin` **0.01** | `retrieve` ranks by score in hundredths, then by edition count. Under 0.01 the work won on popularity, not on the text. One fully matched surname on a fully matched title adds 0.058 to the noisy-or, at least 0.032 after the coverage factor; a 0.03 margin would refuse a golden query that names its author and beats a same-author graphic adaptation by 0.017 (below). |
| **(b) author evidence** | when the matched title form has one content word (stopwords dropped), or is held by `sharedBooks` or more distinct books in the catalog, author evidence must be above 0 | `sharedBooks` **2** (Open Library duplicates counted once; scan cap 200 works) | A title held by two books cannot say which one on its own. "Many" is set at its least value because the margin already handles a namesake that is in the reader's candidates; this arm asks for some author evidence whenever the catalog shows the title is ambiguous. |
| **(c) short title** | a one-content-word title match needs a second field confirmed: author evidence ≥ 0.5 or series evidence ≥ 0.8 | `secondAuthor` **0.5**, `secondSeries` **0.8** | 0.5 is a surname read with small error (surname share 0.7 × a prefix or fuzzy match of at least 0.72); series uses F-0's title bar. |
| **a+b+c** | all three | | the combination briefed |
| **a+b** | (a) and (b) | | added before any v2 run, because the golden check below shows (c) refuses a golden confirmation that carries author evidence |

### Golden calibration on v1 (the only data looked at to set constants)

C-3's 161 golden fragments on `catalog.sqlite` (v1), one query read as one reader. 147 queries have a top-1 that
passes F-0's bar and is the expected work ("golden-correct confirmations"); 2 have a top-1 that passes the bar and
is not (one clean, one `none`). With the constants above, the arms refuse these golden-correct confirmations:

| arm | refused | which (golden ids) | author evidence in the query |
|---|---:|---|---|
| (a) margin | 2 | c074, c075 (bare one-word titles; the expected book ties another book of the same title and wins on edition count) | none |
| (b) author | 8 | c074, c075, c077–c081 (bare titles), n037 (series and title, no author) | none |
| (c) short | 6 | c074, c075, c077–c080, and **n025** (a truncated author: given names only, author evidence 0.3) | n025 only |

(a) also refuses the one clean golden query v1 confirms *wrongly* (c076: a namesake of another author wins by 0.004).

So **every arm refuses at least one golden-correct v1 confirmation**, and all such refusals except n025 rest on the
title alone. A guard against namesakes refuses a bare title that another book shares; that is its purpose. The
golden set deliberately holds bare one-word titles and titles shared with other books (`docs/catalog.md`), so the
card's fourth keep condition read literally can be met by no arm. That is recorded here, before any v2 result, and
logged as a deviation (`implementation-notes.md`).

### Keep rule

Comparisons are against **v1 as shipped** (no guard). For each arm, on v2 with the arm:

1. **Yardstick (PROXY):** wrong accepts per spine are not above v1's upper bound, and the paired difference
   (v2+arm − v1) has a lower bound ≤ 0.
2. **`pilot-000`:** the paired difference in confirmed share (v2+arm − v1) has a lower bound above 0.
3. **Golden:** clean top-5 on v2 is at least 90 % (the guard does not touch retrieval; any change here is a bug).
4. **Golden-correct v1 confirmations:** the arm, applied on v1, refuses none of them.
   - **4 (strict, deciding):** none of the 147.
   - **4′ (pre-registered alternative, for the owner to rule on; not deciding here):** none of those with author
     evidence above 0 in the query, i.e. the guard may refuse confirmations that rest on the title alone.

An arm passes when 1–4 hold. If several pass, the one with the most `pilot-000` confirmations is chosen (ties: fewer
yardstick wrong accepts). **The default switches to v2 only if an arm passes under 4 (strict).** By the calibration
above none can, so this card is expected to keep v1 as the default; the report gives every arm's verdict under 4′
as well, so the owner can rule on 4′ without a post-hoc change. If no arm passes under 4′ either, the report says
what would be needed (a fresh labelled sample, or F-0h's neighbour evidence).

### Measurement

- **Data:** F-0's cached reader output per spine, the reading set C-5 used (`all-crops`), re-decided offline. No
  re-detection, no re-reading, no GPU. `pilot-000`: 31 photos, 6,894 spines. Yardstick `yardstick-library-b2`: 40
  photos, 1,132 spines.
- **Reproduction gate:** unguarded re-decisions on v1 and v2 must match C-5's cached re-decisions (accepted work and
  reason) on at least 99.9 % of spines, or the run stops.
- **Yardstick judge:** C-5's `isAnnotated` as published (ISBN on any edition, else main title plus an author
  surname, Spanish and Catalan articles dropped). Any change is logged and applied to every arm.
- **Yardstick figures:** confirmations, wrong accepts, wrong share of accepts, wrong per spine; paired differences
  against v1.
- **`pilot-000` figures:** confirmations, distinct accepted works per photo (mean over photos), unknowns by reason,
  Open Library works among accepts; how many of C-5's 34 switched confirmations (v1 accepted one work, v2 another)
  each arm withdraws.
- **Golden:** top-1, top-5 and top-10, clean and noisy, on v1 and v2; per arm, golden-correct and golden-wrong
  confirmations refused, on v1 and on v2.
- **Intervals:** paired photo bootstrap (`clusterBootstrap`), 95 %, 2,000 resamples, seed 1. C-5 used another seed,
  so v1's interval here differs slightly from C-5's; the keep rule uses this card's.
- **Latency:** p50 and p95 per `retrieve` on the 161 golden queries (warm), on v1, v2 and v2 + guard (retrieve plus
  the guard's own lookups). Reported, not gating.
- **v1 with the guard:** every arm is also run on v1 and reported.
