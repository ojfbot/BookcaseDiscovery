# KN2: genre prior for identify, shadow mode — pre-registration

Fixed 2026-11-05, after KN-1's `work_features` merged (#68) and before any real-data run of this card. Nothing below
changes after seeing a result. Any change is logged as a deviation in `implementation-notes.md`, and the report
(`evals/KN2/report.md`) says which figures it touches. The constants live in `src/identify/section-prior.ts`
(`PRIOR`) and `src/identify/section-prior-cli.ts` (`EVAL`, `keepRule`) at this commit.

**Question.** The owner ruled on 2026-11-04 that shared book knowledge (genre, subject, form) may support identify,
while the reader's taste stays behind the wall (INV-13). Books on one shelf row tend to share a section. When a
reader's top catalog candidate for an unconfirmed spine sits just above another candidate that fits the row's section
much better, does preferring the better fit turn unknowns into two-reader accepts, without making new wrong accepts
and without costing the books that are out of place in their row?

**This card runs the switch in `shadow` only.** Every decision is logged beside what the prior would change; no
decision, cache, default or catalog changes. Promoting `shadow` to `re-rank` would re-baseline every F-0 decision and
is the owner's ruling; the keep rule below is what that ruling reads.

## Sets, never merged (OC35)

Both on RB-1's box set (F-0i's partition less NB-3's `on-lip` boxes; `loadBoxSet` through F-0g's `loadBooks`).

- **`pilot-000`** (31 real-use photos, F-0e's `bands+strips` boxes and readings): every figure is **machine
  agreement, never accuracy** (INV-17).
- **Yardstick, PROXY (library shelves)**: the 40-image Library Dataset sample with F-0's B2 boxes and readings.
  Evaluation only; nothing is tuned on it. A new accept is **wrong** when C-5's judge (`isAnnotated`: an annotated
  ISBN among the work's editions, or an annotated title and author surname) finds it in none of the image's annotated
  books, as C-6 and C-7 count wrong accepts on the v1 catalog. Reported apart from `pilot-000`, always labelled PROXY.
  **Too small to read, expected:** KN-1 counts 12 confirmed works on it under today's catalog, and a mix needs two
  confirmed neighbours with known features in one row.

**Catalog.** Both sets are retrieved and decided on `catalog-kn1.sqlite`: today's default catalog (ISFDB, v1) plus
KN-1's `work_features`. KN-1's gate found every box's accept identical on the two files (1.000 on both sets).

No hand labels (OC36). Nothing is trained. No GPU.

## Inputs

- **Rows:** F-0h's (`buildRows` on the set's book boxes, keys `<photo>|<k>`), the rows SC-1's records were read for.
- **Decisions in force** (TS-0's order): F-0's `readers-agree` accepts, then F-0g's `confirmed-by-copy`
  (`private/f0g/pilot-000/copies.jsonl`), then F-0h's `confirmed-by-context` (`private/f0h/pilot-000/decisions.jsonl`).
  F-0's accepts are **re-decided** from the cached readings on `catalog-kn1.sqlite`, never read from a stored
  decisions file (the yardstick's stored file predates later retrieval changes: 269 stored accepts against 13 today,
  KN-1). On the yardstick only `readers-agree` is in force: its copy and context caches were decided on its inventory
  catalog, whose work ids are not the v1 catalog's. A book box with no basis in force is a **target**.
- **Readers' candidates:** each book box's Vision, PP-OCR and Qwen readings (the base's cache), each retrieved on its
  own (`retrieve`, C-3's default generation, `PRIOR.depth` = 20 deep) on the set's catalog, cached privately under
  `private/kn2/<set>/ranked.jsonl`. The prior sees each candidate's work id, retrieval score and whether it passes
  F-0's bar on that reader's text (`confirms`): no title, author, edition count or year.
- **Work features:** KN-1's `work_features` (`workFeatures` in `src/catalog/work-features.ts`), both sources
  (ISFDB tags, Open Library subjects) together. Per work (`termsOf` in the runner): **genre** = the genre rows'
  *families* (`sf`, `fantasy`, `horror`, `crime`, `thriller`, `romance`, `literary`, …; canons such as `space-opera`
  are too fine for a row of a dozen books); **subject** = the subject rows' terms; **form** = one form canon, the
  first in KN-1's lexicon order other than `fiction`, else `fiction`, else none. A work with no row is **unknown**
  (KN-1: 20 % of `pilot-000`'s confirmed works have no genre or form). The rows' `count` is never read.
- **SC-1's sign:** `private/sc1/<set>/rows.jsonl`, the row's section `family` and the record's `confidence`. SC-1's
  K2 failed (section agreement 58.4 % against a shuffle mean of 54.6 %, p95 66.7 %), so the sign is weak by
  construction here: half a neighbour, genre facet only, and never on its own. SC-1's family maps to KN-1 genre families
  (`SIGN_FAMILIES`): `sf-fantasy` → sf, fantasy; `sf` → sf; `fantasy` → fantasy; `horror` → horror; `mystery` →
  crime, thriller; `romance` → romance; `literature` and `classics` → literary. `young-adult`, `children`, `graphic`,
  `poetry-drama` and `nonfiction` name an audience or a form and map to none.

## The section mix (`buildMix`)

A row's **section mix** is built from its confirmed members (any basis in force) whose features are known:

- per facet (genre, subject, form), each term's **share**: the weight of contributors carrying it over the facet's
  total contributor weight. Each neighbour weighs 1 and contributes to every term it carries;
- SC-1's sign, when its record's confidence is at least 0.3 and its family maps to at least one genre term, adds a
  genre contributor of weight **0.5**;
- **no mix** with fewer than **2** neighbours of known features. A sign alone never makes a mix.

## Affinity and the re-rank (`affinity`, `rerank`)

- **Affinity** of a work to a mix, 0..1: for each facet known on both sides, the best share among the work's terms;
  the mean weighted genre 1, subject 0.5, form 1. **Null** when no facet is known on both sides.
- Per target and reader, the reader's top **stays** unless all of the following hold for some **challenger** in its
  first 20 candidates:
  1. it is another work, at most **0.05** below the top on retrieval's own score;
  2. it **passes F-0's bar on this reader's own text** (score ≥ 0.72, title ≥ 0.8, coverage ≥ 0.5);
  3. both its affinity and the top's are known, and its affinity is at least **0.25** higher;
  4. score + **0.05** × affinity beats the top's.
  The best such challenger becomes the reader's prior top; ties keep retrieval's order.
- A top whose features are unknown is **never displaced**. Popularity never enters: no edition count, year, rating,
  vote or award (a structural test).

## The would-be decision (`priorVote`)

F-0's vote, unchanged, on each reader's prior top for a reader the prior moved and its base confirmation otherwise.
The prior is **never a confirmer**: a moved reader names a work that passes F-0's bar on its own text, and an accept
still needs two reader models on one work, uniquely; each model still casts one vote (INV-6). The prior applies only
to targets: a box with a basis in force is never re-ranked in `re-rank` mode. `vote` mode is refused in code.

Outcomes per target: `new-accept` (the prior's vote accepts where nothing is in force), `none`. The shadow log
(private, `private/kn2/<set>/shadow.jsonl`) holds one record per book box: its row, its mix size and sign, each
reader's top, prior top and reason, the base and the would-be decision.

## Gate

- **G1 (reproduction):** F-0's vote on the cached ranked tops (20 deep), with no prior, reproduces F-0's own `decide`
  (its top-3 retrieval) on the same readings and catalog on at least **99.9 %** of book boxes, per set. If it fails,
  no figure of that set is read and the card reports the gate. Agreement with the stored base F-0h and SC-1 read
  (`f0c/<set>/base-decisions.jsonl`) is recorded beside it, for the record only.

## Keep rule (shadow → re-rank; the owner's ruling)

The rule is met only if all three hold.

- **K1a (`pilot-000`, machine agreement):** new accepts per photo, 95 % photo-cluster bootstrap (2,000 resamples,
  seed 20261105, photos drawn with replacement): the interval's **lower bound is above 0**.
- **K1b (yardstick, PROXY):** **no rise in wrong accepts**: zero new accepts judged wrong. If the prior changes no
  yardstick decision, K1b is recorded as **too small to read (uninformative)**: neither a pass that counts as
  evidence nor a failure, and the verdict says the keep rule could only be read on `pilot-000`. This is the expected
  outcome (12 confirmed works).
- **K2 (out-of-place stress test, `pilot-000`):** each `readers-agree` box in a row is left out of its own row's mix
  and put through the prior as if it were a target. A box is **out of place** when its work's form differs from its
  row's majority form (a form held by more than half of the other known neighbours, at least 2). Out-of-place boxes
  must lose **no** accepts: zero `lost-accept` and zero `changed-accept`. If no box is out of place, K2 holds but is
  reported as uninformative.

## Reported, not in the rule

- **Shuffle control:** each target's mix replaced by a random other row's mix in the same set (200 shuffles, seed
  20261105): new accepts real against the shuffle's mean and 95th percentile. A prior whose gains do not beat the
  shuffle is a genre-of-the-store effect, not a row effect.
- **Third-reader dissent** on new accepts: the reader outside the agreement confirms a different work (TS-1's
  label-free proxy).
- **Stress, wider:** the same leave-one-out over every `readers-agree` box in a row, and over boxes out of place by
  genre (none of their genre terms in the row's mix).
- **How much the single-genre catalog limits this** (said plainly in the report): rows with a mix; mixes with a sign;
  confirmed works and target tops with known features; the mixes' mean top genre share and the share of mixes whose
  top genre term holds 80 % or more; mean genre terms per mix; distinct genre terms across mixes; per (target,
  reader), the re-rank's reasons; and the **separation rate**: of the (target, reader) pairs with at least one
  passing challenger of known affinity in the band, the share where the mix separates a challenger from the top by
  at least 0.25. ISFDB is a speculative-fiction catalog (F-0h, SC-1): if nearly every mix says "sf, novel", the
  prior has nothing to choose with, and the report says so.

## Looked at before fixing this text (disclosed)

The code of F-0, F-0g, F-0h, SC-1, RB-1, TS-0 and KN-1; the names of the cached files under the data root; KN-1's
published report and notes (aggregate coverage: 80.0 % of `pilot-000`'s 471 confirmed works with a genre or form,
form 0.4 % from ISFDB and 49.5 % from Open Library; the yardstick's 12 confirmed works). No cached record, reading,
decision, image or feature value was opened, and no part of this card's runner had run on real data.

## Not done

No GPU, no new reading, no training, no change to F-0's rule, catalog, defaults or any earlier card's cache. The
switch's default stays `off`.
