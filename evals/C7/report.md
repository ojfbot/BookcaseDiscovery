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

To follow, after the pre-registration commit.
