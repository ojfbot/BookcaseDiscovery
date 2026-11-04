# C7: rarity-weighted evidence and counter-evidence in F-0's accept rule

Card C-7, 2026-11-03. **Question:** on the open catalog (`catalog-v2.sqlite`, C-5), F-0's bar lets namesakes
through: yardstick wrong accepts per spine 1.50 % against v1's 0.53 %. C-6's lookalike guard came closest with its
short-title arm (c), but refused six golden-correct v1 confirmations: five bare one-word titles and one author read
by given names only. Can rarity-weighted title evidence (record linkage's term-frequency adjustment, from the
catalog's own statistics, no labels) plus counter-evidence keep v2's extra confirmations, hold wrong accepts down,
and let rare one-word titles through, so the default catalog can switch to v2?

Counts and shares only. Real-use figures (`pilot-000`) are machine agreement, never accuracy (INV-17); the
yardstick is a PROXY (OC35); the two are never pooled. No hand labels (OC36). Nothing below was tuned on the
yardstick or on `pilot-000`.

## Answer first

- **No eligible arm passes the pre-registered keep rule, so the default stays `catalog.sqlite` (v1).** F-0h stays
  blocked on the switch, and no downstream re-baseline is triggered.
- **`c7` (the full basis) passes the yardstick but fails `pilot-000` and the golden rule:**
  - yardstick wrong share of accepts falls from 38.6 % to **25.7 %** (paired −12.9 points, −22.7 to −5.0), and wrong
    per spine is **0.80 % (0.22–1.41)**, under v1's 1.05 % bound. 26 of F-0's 27 correct v2 accepts are kept;
  - `pilot-000` confirmations: 11.8 % against v1's 10.4 %, paired **+1.35 points (−0.55 to 3.54)**: the interval
    reaches below 0;
  - golden: it refuses **one** golden-correct v1 confirmation (c075) where C-6's (c) refused six, and on v2 two
    (c075, c079). Four of C-6's five refused bare one-word titles now survive on v1.
- **Why the two golden titles fall:** each is a common word that many books share. c075's book holds 46 % of its
  title's editions over 19 books in v1, and 33 % over 49 books in v2; c079's holds 47 % over 10 books in v2. On the
  title alone no text rule can tell those from the yardstick's generic-title namesakes. That is the namesake test
  working as designed, and the reason rule 5 cannot be met without a second field.
- **Where the pilot loss comes from:** the namesake kind does most of the yardstick's work, and alone it would clear
  K1–K4 (+2.0 points on `pilot-000`, 0.2–4.2). The **author** kind withdraws no yardstick accept on its own but costs
  56 `pilot-000` accepts. By leave-one-reader-out it withdraws 64 corroborated confirmations for 5 contradicted
  ones. The unexplained-word and language kinds barely fire (5 and 1 accepts).
- **Unguarded v2 and C-6's arms are reproduced exactly** (C-5's re-decisions and C-6's per-reading facts: 1.000 on
  both sets and catalogs). The basis costs about 0.1 ms per confirming reading; golden p95 on v2 is 489 ms with it,
  476 ms without.

## Pre-registration

Written and committed before any decision was replayed with the basis, on any set or catalog, golden included.
Before this commit: the statistics sidecars were built for v1 and v2 (counts only, no decision), and the unit tests
ran on an invented catalog. Neither the yardstick's nor `pilot-000`'s per-spine data was opened for this card. The
constants are `RARITY` in `src/catalog/rarity.ts`, frozen in this commit.

### Catalog statistics (sidecar, label-free)

`bookcase catalog stats [--db <catalog>]` writes `<catalog>.stats.sqlite` beside each catalog file
(`catalog.stats.sqlite`, `catalog-v2.stats.sqlite`). The catalog files are read, never written. The sidecar records
the catalog file's size and modification time, and is refused against any other state of the catalog.

| table | key | value |
|---|---|---|
| `title_totals` | normalised whole or main title form (own or variant: `title_norm` kinds T, M, V, W) | works, books, editions holding it |
| `title_books` | (title form, primary author surname) | works, editions: one **book**, so Open Library duplicates and crosswalks of one book collapse |
| `words` | token | works carrying it in a title, author or series form; works with an edition whose publisher carries it |
| `author_works` | normalised author form | works |

Built: v1 340,829 works (338,623 books) in 5 s, 34 MB; v2 4,245,204 works (3,941,075 books) in 87 s, 404 MB.

### The basis (`src/catalog/rarity.ts`)

A test on **one reader's** top candidate, after F-0's bar (`confirms`, unchanged), on that reader's ranked
candidates (`retrieve`, same scoring and ranking, depth 50). Like C-6's guard it can only **withdraw** a reader's
confirmation; F-0's vote is unchanged, so it can never add an accept or switch one to another work. A withdrawn
spine keeps F-0's reasons. `decide(…, { guard, ranked, rarity })` records the kind per reader
(`SpineDecision.counter`); nothing applies it unless a caller passes it.

**New evidence fields** beside `retrieve`'s scores (`RarityEvidence`; `retrieve.ts` is unchanged): the matched
form's works, books and editions; the candidate's own book's editions under it; the **namesake share**; the
**rarity-weighted title evidence** in bits (title evidence × log2(catalog works / works holding the form)); author
and series evidence; works under the matched author form; the unexplained read words that count and the rarest of
them; whether a rival author was read; the reading's and the work's language.

**Counter-evidence** (each withdraws the confirmation; the order only names the first that holds):

| kind | holds when | constants and why |
|---|---|---|
| **namesake** | the title alone does not pick this book: neither a surname (author evidence ≥ 0.5) nor the series (≥ 0.8) was read, and the book's share of the matched form's editions is **≤ 0.5**, or the form is only its subtitle | `shareMin` 0.5. Among the books a title fits, a shelf copy is one of them in proportion to how often each was published (editions as the label-free count of copies); above 0.5 the candidate is more likely than all its namesakes together. `secondAuthor` 0.5 and `secondSeries` 0.8 are C-6's (c): a surname read with small error, and F-0's title bar. A read surname collapses the namesakes by construction: same title and same surname are one book. |
| **unexplained** | the reading holds a word the candidate's evidence does not use, that occurs in **fewer catalog works than the matched title form does** | Rarity comparison, no threshold: a spine word more specific than the title it matched points elsewhere. A word counts only if it has ≥ 4 letters and no digit (`retrieve` trusts no shorter token alone), is not a stopword or function word, occurs in ≥ 2 works (a word seen once may be an OCR accident; OCR garble has no works), and is not an **imprint word** (publisher strings carry it on at least as many works as titles, authors and series do). Never fires for a title one work holds. |
| **author** | the candidate's own author was not read (< 0.5), and a different book in the reader's top 50 has a surname read (≥ 0.5) from words the candidate leaves unexplained, not only imprint words | The spine names another author. Same-book test is C-6's `sameBook` (duplicates collapsed before any comparison). |
| **language** | the reading's function words mark one language other than English (exclusive words only; none from another list), the candidate is an English work, and it matched its own title (not a variant title) | Open Library's breadth layer holds English editions only, and ISFDB records translations as variant titles, so an own-title English match to a reading in another language is another language's edition. The reverse direction is not used: ISFDB's language is the original's, so an English edition of a translated work with the same title would trip it. Word lists: `LANGUAGE_WORDS`, words that are also common names or English words left out. |

**Candidate coverage** (C-R2 §1.3) is already F-0's title bar: title evidence is the share of the matched form's
own tokens the reading explains, and it must be ≥ 0.8. The one gap, a match on a subtitle-only form, is in the
namesake kind above.

**Margin after collapsing duplicates.** C-6's margin arm (a) already measures the runner-up as the best *different
book* (`sameBook`), so duplicates collapse before it. It is combined with the basis as arm `c7+a`.

### How C-3's golden set informed the design (flagged)

- Before choosing the namesake measure, the v1 holders of the golden set's bare one-word titles (public titles in
  `evals/golden/fragments.jsonl`; queries c074, c075, c077–c081) were listed: works, authors and edition counts. Two
  of them are shared by several books in v1 (c074 by four, c075 by more than twelve). A uniform prior over a title's
  books (the plain term-frequency weight, 1 / books) would refuse both, and C-6's rule 4 forbids that. That is why the
  namesake test weighs books by their editions. The shares were not computed, and the 0.5 cut comes from "more
  likely than not", not from these lists.
- C-6's report names n025 (author by given names only) and c076 (a golden-wrong namesake win). Neither shaped a
  constant here.
- Nothing else of the golden set was looked at, and no basis was run on it before this commit.

### Arms

| arm | parts | eligible to pass |
|---|---|:-:|
| `none` | F-0's rule alone | baseline |
| `c6:c` | C-6's short-title arm (c) | reference (C-6's best) |
| **`c7`** | namesake + unexplained + author + language | ✓ |
| **`c7+a`** | `c7` plus C-6's margin (a) | ✓ |
| `only:<kind>` | one counter-evidence kind alone | attribution only |

### Keep rule

Every condition is on v2 with the arm, against the stated baseline. An arm passes when K1–K5 all hold.

1. **K1, yardstick (PROXY) wrong accepts**, either:
   - (a) the wrong share of accepts falls against F-0's rule on v2: paired difference (v2 + arm − v2) with its
     interval's upper bound below 0; or
   - (b) wrong accepts per spine are not above v1's upper bound (C-6's K1 bound, this card's bootstrap).
2. **K2, yardstick correct accepts:** accepts the judge calls right fall by no more than 15 % relative to F-0's rule on
   v2 (point counts). Read as *correct* accepts, because the card's "confirmed accepts" would otherwise conflict with
   K1: on v2, 39 % of accepts are wrong.
3. **K3, `pilot-000`:** the paired difference in confirmed share (v2 + arm − v1) has a lower bound above 0 (C-6's K2).
4. **K4, golden:** clean top-5 on v2 is at least 90 % (the basis does not touch retrieval; a change is a bug).
5. **K5, golden-correct v1 confirmations:** with each golden query as one reader,
   - (i) on v1, the arm refuses none of v1's golden-correct confirmations (C-6's rule 4, strict);
   - (ii) on v2, the arm refuses none of the queries that are golden-correct confirmations on both v1 and v2 (the
     switch must keep them; C-5's retrieval losses such as n025 are not the basis's).

   (ii) is stricter than the brief's rule 5, because the default would switch to v2.

If both eligible arms pass, the one with more `pilot-000` confirmations is chosen (ties: fewer yardstick wrong
accepts). **The default switches to v2 with the chosen arm only if one passes.** Otherwise the default stays v1 and
the report says what would close the gap.

### Measurement

- **Data:** F-0's cached reader output per spine, the reading set C-5 and C-6 used (`all-crops`), re-decided offline.
  No re-detection, no re-reading, no GPU. `pilot-000`: 31 photos, 6,894 spines. Yardstick `yardstick-library-b2`:
  40 photos, 1,132 spines.
- **Reproduction gates** (the run stops under 0.999):
  1. unguarded re-decisions match C-5's cached re-decisions, accepted work and reason (C-6's gate);
  2. every reading's top work, F-0's bar and C-6's three arm verdicts match C-6's cached facts, so `c6:c` is C-6's
     arm (c).
- **Yardstick judge:** C-5's `isAnnotated` as published.
- **Figures:** as C-6 (confirmations, wrong and correct accepts, wrong share of accepts, wrong per spine, paired
  differences against v1 and against F-0 on the same catalog; `pilot-000` confirmations, distinct works per photo,
  unknowns by reason, Open Library works, C-5's 34 switched confirmations withdrawn), per arm, on both catalogs.
- **Golden:** top-1, top-5 and top-10 on v1 and v2; per arm, golden-correct and golden-wrong confirmations refused,
  on v1 and v2.
- **Leave one reader out** (C-R2 §5; label-free, secondary, not gating). On every spine, a reader whose top work
  passes F-0's bar is *corroborated* when another reader confirms the same work, and *contradicted* when both other
  readers confirm one other work. Per arm: the share of corroborated confirmations kept, and the share of
  contradicted ones withdrawn. Readers are Vision, PP-OCR and Qwen, one vote each (INV-6). Biased toward clean reads;
  machine agreement only.
- **Intervals:** paired photo bootstrap (`clusterBootstrap`), 95 %, 2,000 resamples, seed 1 (C-6's).
- **Latency:** p50 and p95 per `retrieve` plus the basis's evidence, on the 161 golden queries (warm), v1 and v2.
  Reported, not gating.

## Results

Run 2026-11-03 on `ec03222` (the pre-registration commit), on the build Mac (node v24.22.1). The readings ran as 7
processes beside other sessions, so reading latencies are not reported; golden latency had the host mostly to
itself. Numbers: `metrics.json`. Intervals: paired photo bootstrap, 95 %, 2,000 resamples, seed 1.

**Reproduction gates.** Unguarded re-decisions match C-5's cached re-decisions on **1.000** of spines, and every
reading's top work, F-0's bar and C-6's three arm verdicts match C-6's cached facts on **1.000** of readings, on both
sets and both catalogs. So `c6:c` below is C-6's arm (c), and its figures equal C-6's.

### Yardstick `yardstick-library-b2` (PROXY: 40 photos, 1,132 spines)

K1 needs (a) the paired Δ in wrong share of accepts against F-0 on v2 to have an upper bound below 0, or (b) wrong per
spine ≤ 1.05 % (v1's upper bound). K2 needs ≥ 23 correct accepts (85 % of F-0's 27 on v2).

| arm | catalog | confirmed | wrong | correct | **wrong per spine** | wrong share of accepts | **Δ wrong share vs F-0, same catalog** | accepts withdrawn (wrong) | K1 | K2 |
|---|---|---:|---:|---:|---:|---:|---:|---:|:-:|:-:|
| none | v1 | 13 | 6 | 7 | 0.53 % (0.10–1.05) | 46.2 % (23.1–83.4) | — | — | | |
| none | v2 | 44 | 17 | 27 | 1.50 % (0.66–2.46) | 38.6 % (20.4–62.2) | — | — | | |
| `c6:c` | v2 | 35 | 8 | 27 | 0.71 % (0.18–1.32) | 22.9 % (8.0–44.4) | −15.8 (−33.3 to −6.2) | 9 (9) | ✓ | ✓ |
| **`c7`** | v2 | 35 | 9 | 26 | **0.80 % (0.22–1.41)** | 25.7 % (10.0–50.0) | **−12.9 (−22.7 to −5.0)** | 9 (8) | ✓ | ✓ |
| **`c7+a`** | v2 | 34 | 8 | 26 | 0.71 % (0.17–1.31) | 23.5 % (7.1–47.4) | −15.1 (−26.7 to −7.0) | 10 (9) | ✓ | ✓ |
| only namesake | v2 | 36 | 9 | 27 | 0.80 % (0.22–1.41) | 25.0 % (9.5–47.6) | −13.6 (−23.3 to −6.3) | 8 (8) | ✓ | ✓ |
| only unexplained | v2 | 44 | 17 | 27 | 1.50 % | 38.6 % | 0 | 0 | ✗ | ✓ |
| only author | v2 | 44 | 17 | 27 | 1.50 % | 38.6 % | 0 | 0 | ✗ | ✓ |
| only language | v2 | 43 | 17 | 26 | 1.50 % | 39.5 % | +0.9 (0.0–3.9) | 1 (0) | ✗ | ✓ |

On v1, `c7` confirms 10 (3 wrong, withdrawing 3 of v1's 6 wrong accepts and no correct one); `c7+a` and `c6:c`
confirm 8 (1 wrong). The one correct v2 accept `c7` withdraws is the language kind's: a reading in another language
whose English-titled match the judge counts right.

### `pilot-000` (real use, machine agreement only: 31 photos, 6,894 spines)

K3 needs the paired Δ in confirmed share against v1 to have a lower bound **above 0**.

| arm | catalog | confirmed | confirmed share | **paired Δ vs v1** | distinct works per photo (Δ vs v1) | Open Library works | accepts withdrawn | K3 |
|---|---|---:|---:|---:|---:|---:|---:|:-:|
| none | v1 | 718 | 10.4 % (6.7–14.0) | — | 20.1 | — | — | |
| none | v2 | 992 | 14.4 % (11.3–17.1) | +3.97 (2.06–6.19) | 28.3 (+8.2, 4.4–12.8) | 342 | — | ✓ |
| `c6:c` | v2 | 870 | 12.6 % (9.7–15.2) | +2.20 (0.20–4.54) | 24.6 (+4.5, 0.5–9.3) | 274 | 122 | ✓ |
| **`c7`** | v2 | 811 | 11.8 % (8.9–14.2) | **+1.35 (−0.55 to 3.54)** | 23.2 (+3.1, −0.6 to 7.4) | 250 | 181 | ✗ |
| **`c7+a`** | v2 | 778 | 11.3 % (8.5–13.8) | +0.87 (−0.98 to 3.02) | 22.2 (+2.1, −1.5 to 6.2) | 230 | 214 | ✗ |
| only namesake | v2 | 857 | 12.4 % (9.6–15.0) | +2.02 (0.16–4.20) | 24.3 (+4.2, 0.5–8.4) | 265 | 135 | ✓ |
| only unexplained | v2 | 987 | 14.3 % | +3.90 (1.96–6.15) | | 341 | 5 | ✓ |
| only author | v2 | 936 | 13.6 % | +3.16 (1.24–5.38) | 26.9 (+6.8) | 320 | 56 | ✓ |
| only language | v2 | 991 | 14.4 % | +3.96 (2.04–6.19) | | 342 | 1 | ✓ |

With the basis on v1, `c7` confirms 632 (−1.25 points against unguarded v1, −1.68 to −0.87). Of C-5's 34
switched confirmations (v1 one work, v2 another), `c7` withdraws 14 and `c7+a` 17 (C-6's (c): 16). Withdrawn
`pilot-000` confirmations cannot be called right or wrong (INV-17).

**Counter-evidence on confirming readings** (v2, each kind on its own; one reading can carry several): namesake 803 of
3,723, author 208, unexplained 12, language 4. On the yardstick: namesake 26 of 161, author 5, unexplained 1,
language 3.

### Leave one reader out (label-free, secondary)

A reader's confirmation is *corroborated* when another reader confirms the same work, *contradicted* when both other
readers confirm one other work. A basis should keep the first and withdraw the second.

| arm | `pilot-000` v2: corroborated kept | contradicted withdrawn | yardstick v2: corroborated kept |
|---|---:|---:|---:|
| `c6:c` | 88.6 % of 2,046 | 63.2 % of 38 | 79.6 % of 93 |
| `c7` | 84.5 % | 76.3 % | 79.6 % |
| `c7+a` | 81.5 % | 76.3 % | 76.3 % |
| only namesake | 87.1 % | 73.7 % | 81.7 % |
| only author | 96.9 % | 13.2 % | 100 % |
| only unexplained | 99.7 % | 0 % | 100 % |
| only language | 99.95 % | 0 % | 97.8 % |

`c7` withdraws more contradicted confirmations than C-6's (c) (29 against 24 of 38) at the cost of more corroborated
ones (317 against 233 of 2,046). The author kind does tell the two apart (it withdraws 13 % of contradicted and
3 % of corroborated confirmations), but 64 of its 69 withdrawals fall on confirmations another reader corroborates. The figures favour clean reads (two readers had to pass the bar)
and are machine agreement only.

### Golden fragments (C-3's 161 queries)

Retrieval is unchanged: clean top-5 is 100 % on v1 and v2 (K4 ✓), top-1 98.9 % on both; noisy as in C-5.

**Golden-correct confirmations refused**, out of 147 on v1 and 146 on v2 (each query as one reader):

| arm | on v1 (K5 i) | on v2, of both-catalog confirmations (K5 ii) | golden-wrong refused (v1 / v2) |
|---|---|---|---|
| `c6:c` | 6: c074, c075, c077, c079, c080, n025 | 5: c074, c075, c077, c079, c080 | 0 of 2 / 0 of 7 |
| **`c7`** | **1: c075** | **2: c075, c079** | 0 of 2 / 1 of 7 |
| `c7+a` | 2: c074, c075 | 4: c074, c075, c077, c079 | 1 of 2 / 4 of 7 |
| only namesake | 1: c075 | 2: c075, c079 | 0 of 2 / 1 of 7 |
| only unexplained, author, language | none | none | 0 / 0, 1, 0 |

The two refused queries are bare common-word titles. Their books' namesake shares are 0.455 (c075, 19 books) on v1;
0.328 (c075, 49 books) and 0.469 (c079, 10 books) on v2. The bare titles that survive hold 0.77 to 1.0 of their
editions on v1. n025 (author read by given names only) is no longer refused: its title is not shared. On v2 n025's
top-1 still fails F-0's bar (C-5's candidate-cap loss), so it is not a confirmation there.

### Keep rule

| arm | K1 yardstick | K2 correct kept | K3 `pilot-000` | K4 golden top-5 | K5 (i) v1 | K5 (ii) v2 | **passes** |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **`c7`** | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | **✗** |
| **`c7+a`** | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | **✗** |
| `c6:c` (reference) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| only namesake (attribution) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |

**Verdict: no switch. The default stays v1.** The basis ships as an option of `decide` (`guard.rarity`), off unless a
caller passes it. Nothing in F-0's runners turns it on, and no v1 decision changes. Because nothing switches, F-0g
propagation, H-2's crop figures and F-0h need no re-baseline from this card.

## What would close the gap

None of these is a retune of these numbers. Each needs its own pre-registration, on fresh data where it is a
measurement.

1. **Drop or rebuild the author kind.** On these sets it withdraws no yardstick accept and 56 `pilot-000` accepts,
   and 64 of its 69 leave-one-reader-out withdrawals fall on confirmations another reader corroborates. A
   likely cause, not checked spine by spine: a "surname" read from an ordinary spine word that is also some catalog
   author's surname. A rebuilt kind would need the rival surname itself to be rare in the catalog. Without it, the
   namesake kind alone already clears K1–K4 on this data.
2. **A second field for bare common-word titles.** c075 and c079 hold under half their title's editions, so on the
   title alone they look exactly like the yardstick's generic-title namesakes. Only another field can separate them:
   F-0h's neighbour context (an adjacent confirmed spine by the same author), or C-9's imprint contrast.
3. **An owner ruling on rule 5 for title-only confirmations.** C-6 pre-registered 4′: refusals allowed among
   golden confirmations with no author evidence. Both refused queries here are bare titles, so `c7` and the namesake
   kind meet 4′. The namesake kind alone would then meet every condition on this data. That is a post-hoc reading,
   so it is not a pass; it would be a new pre-registration.
4. **A fresh labelled sample.** The yardstick has 44 v2 accepts, so every interval is wide (`c7`'s wrong per spine runs
   0.22–1.41 %), and `pilot-000`'s K3 margin is a point either way.

## Caveats

- **The yardstick is small and a PROXY**, judged by C-5's title-plus-surname or ISBN rule. One correct accept the
  language kind withdraws may be the judge's call, not the book's.
- **`pilot-000` is machine agreement.** Withdrawn confirmations there are not known to be wrong.
- **Edition counts are a crude count of copies.** Open Library's counts include reprints and e-book records, and
  ISFDB's v1 counts are publications. The namesake share inherits both.
- **The golden set informed the namesake measure** (pre-registration, flagged): it is why the share is
  edition-weighted. The cut (0.5) and every other constant were fixed before any run.
- **The language kind is one-directional** and rests on function-word lists that are short by design.
