# Identification research (C-R2)

Research card C-R2, 2026-11-03. **Question:** how do we identify a book from a few pixels of misread text against a
4.25M-work open catalog without letting namesakes through, and which layers (the accept rule, retrieval, shelf
context, imprint, a reference image store) should be built first?

Research only: no pipeline code, no GPU, no dataset or model downloads, no accounts, no paid calls. No book title,
photo, crop, path or image id from the owner's data went into any search or external service; the examples are public
books. Four threads ran in parallel (retrieval, shelf context, imprint, images). Each read primary sources, and the
claims the recommendations rest on were re-opened for this doc (**re-checked** below).

Labels, as in [`backend-options.md`](backend-options.md):
- **verified**: read on the primary page (paper, model card, terms page) or in this repo's own reports.
- **snippet**: seen only in a search summary or a secondary page.
- **hypothesis**: inferred, including all arithmetic and every reading of the law (not legal advice).

Quotes are under 15 words. Our own figures come from the eval reports named beside them. Real-use figures
(`pilot-000`) are machine agreement, never accuracy (INV-17). The yardstick is a PROXY (OC35).

## Answer first

- **Top recommendation: fix the accept rule before anything else.** Most namesake wrong accepts come from how F-0
  accepts, not from what retrieval finds. Today a title match on "Africa" counts as much as one on "Neuromancer".
  Nothing in the rule counts *against* a candidate. Record linkage solved this long ago with **term-frequency
  (rarity) weighting**, estimated from the catalog itself with no labels (Fellegi–Sunter; Splink). Add **counter-evidence**
  too: an author that disagrees, rare read words the candidate leaves unexplained, coverage of the candidate's own
  title, and a language mismatch. Card **C-7** replays F-0's cached readings offline, so it needs no GPU and no new
  reads. It generalises C-6's lookalike guard (running now) and is measured against it.
- **Then fix candidate generation** (card **C-8**). Generate candidates from the rarest read words first, look up exact
  titles in a hash index, and never send a token under 3 letters to the trigram index. This targets the 250-form cap
  that lost C-5's golden queries, and v2's p95 of 549 ms.
- **Shelf context (F-0h) is new territory, worth one narrow, falsifiable card.**
  - Shelf-reading robots and planogram systems use order to *audit* known items, never to *identify* unreadable
    ones.
  - Design: an adjacent spine confirmed by two readers proposes its author's and its series' other works (at most
    60). The spine's own reader text must pick one of them by an edit-distance margin.
  - Context stands in for the second reader only, never for the title evidence. The result is recorded as
    `confirmed-by-context`, a basis that can be counted and switched off.
  - Validity is tested by a neighbour shuffle: accepts must collapse when anchors come from other rows.
  - **Run it after C-7**: on the open catalog about 40 % of the yardstick's accepts are wrong, and a wrong anchor would
    propose the wrong author.
- **Imprint is a contrast, not a veto.**
  - From F-0d's numbers: a match is a likelihood ratio of about 5. A mismatch is only about 0.66, because six in ten
    correct works fail to match. So a single-candidate veto would drop most true works.
  - The safe use is to withhold an accept when a close runner-up carries the read house and the accepted work does
    not.
  - Fix the catalog's imprint data first: Open Library's import keeps only the first publisher, and ISFDB's
    publisher series are staged but unused.
  - No logo detector.
- **Image-store verdict: not worth it for spines, and not worth it now at 4M covers.**
  - No public spine imagery exists at catalog scale, and a front cover cannot match a spine.
  - Every bulk cover source is display-only, forbids databases, or carries no licence. Fetching on demand would tell
    Open Library which books are on the owner's shelves.
  - The one slice the evidence supports, if the owner reopens images, is an **on-demand cover re-ranker for face-out
    covers**. It compares only the top-k text candidates, keeps embeddings privately, and is never the sole
    confirmer. That needs an owner ruling (§4.6).
- **Not now:** dense vectors, cross-encoder rerankers, learned sparse retrieval, phonetic matching. On the PROXY
  yardstick's own paper, every method lost ground when the target list grew from 15k to 2.3M titles, and plain
  string matching lost least (§1.6).

## 0. Where we start (measured in this repo)

| Fact | Figure | Source |
|---|---|---|
| Open catalog breadth | 4,245,204 works, 13.0M editions, 6.18 GB | `evals/C5/report.md` |
| First-sighting coverage of readable labels | 84.2 % (74.5–93.4) on v2, against 59.5 % on ISFDB alone | C-5, C-4 |
| Yardstick wrong accepts per spine | 0.5 % on v1 → 1.5 % on v2 (+1.0 point, 0.2–1.7) | C-5 |
| Wrong share of accepts | about 40 % on either open catalog, against 8.9 % on the closed set F-0's bar was set for | C-5 |
| Confirming readings with a runner-up within 0.02 | 29.9 % yardstick, 24.9 % `pilot-000` (v2) | C-5 |
| What the wrong accepts are | short generic titles matching one spine word; a person's name that is also a title; same title by another author; another book by the same author; another language's edition | C-5 |
| Retrieval latency | p95 94 ms on v1 → 549 ms on v2; golden noisy top-5 100 % → 95.6 % (candidate cap, same-word titles) | C-5 |
| Score does not separate "right" from "nothing here" | no-match queries' top candidate up to 0.721; lowest correct top-1 0.71 | C-3 (`docs/catalog.md`) |
| `pilot-000` outcomes (v1) | confirmed 10.4 %; unknown: single-reader 923, no-text 1,738, no-catalog-match 3,435, readers-disagree 80 of 6,894 | `evals/F0/report.md` |
| Reader agreement where both pass the bar | Vision–PP-OCR 89.7 %, Vision–Qwen 80.8 %, PP-OCR–Qwen 59.7 % | F-0 |
| Imprint | read on 18.3 % of boxes; 39.5 % match a confirmed work's houses against 7.8 % chance; 27 % logos; tie-break moved nothing (32 reorderable boxes) | `evals/F0d/report.md` |
| Copy groups | +0.29 confirmed boxes a photo; the visual test alone passes 9.8 % of different-work pairs; the series guard blocks 420/420 | `evals/F0g/report.md` |
| Face-out covers | Qwen passes the bar on 35 of 142 covers, Vision 9, PP-OCR 6; arm off | `evals/F0c/report.md` |

Three things follow. The open catalog's problem is **precision**, not recall. Retrieval's score was never designed
to separate a book from its namesakes. And `single-reader` (923) is the largest pool that context could convert.

## 1. Retrieval and the accept rule

### 1.1 Diagnosis

F-0 accepts when two readers' top candidates name one work with score ≥ 0.72, title evidence ≥ 0.8 and query
coverage ≥ 0.5 (`ACCEPT` in `src/eval/f0.ts`). Each of C-5's wrong-accept classes passes that rule for a reason the
rule cannot see (**hypothesis**, from C-5's list):

- **A generic one-word title** ("Africa") gets title evidence 1.0 from one spine word. The rule does not know that
  thousands of works share that title.
- **A person's name that is also a title** matches the title field with words that belong to the author field.
- **The same title by another author** passes on title alone when the author is unread or truncated.
- **Another book by the same author** passes on author plus one shared word, because coverage is measured only over
  the query's tokens, not the candidate title's.
- **Another language's edition** matches the shared proper noun.

Two readers agreeing does not help here: both read the same correct word, and the namesake is a correct reading of
an ambiguous word.

### 1.2 Rarity-weighted title evidence (Fellegi–Sunter with term-frequency adjustment)

- **What it is.** In probabilistic record linkage, each field comparison has *m* = P(agreement | same record) and
  *u* = P(agreement | different record), and contributes log2(m/u) bits. With a **term-frequency adjustment**, *u*
  for agreement on a value depends on how common that value is. "A common name like Jack has a reduced match
  weight", and a rare one is increased (**verified, re-checked**: [Splink TF guide](https://moj-analytical-services.github.io/splink/topic_guides/comparisons/term-frequency.html)).
  - The guide sets a `tf_adjustment_weight` per comparison level, where 0.5 halves the weights.
  - For fuzzy matches it uses "the greater of the two term frequencies".
  - `tf_minimum_u_value` floors rare values (example 0.001).
  - The closed form, a Bayes factor of (u_avg / TF(x))^w, is in Splink's issue tracker (**verified** by thread 1:
    [issue #2006](https://github.com/moj-analytical-services/splink/issues/2006)). The guide shows it only as an
    image.
- **No labels needed.** *u* comes from random record pairs and *m* from expectation maximisation (**verified,
  re-checked**: [training rationale](https://moj-analytical-services.github.io/splink/topic_guides/training/training_rationale.html)).
  The guide's prior step uses deterministic rules plus a recall guess, also label-free. This fits OC36: the
  catalog's own statistics set the weights.
- **Size of the effect (public example).** The live Open Library title search returns 21,114 works for "dune" and 16
  for "neuromancer" (**verified** by thread 1, keyless GET). That is about 10 bits of difference that today's
  `title evidence ≥ 0.8` ignores (**hypothesis**, arithmetic; token containment, not exact-title counts).
- **Per-token form.** Cohen, Ravikumar & Fienberg (2003) found a hybrid of TF-IDF weighting and Jaro-Winkler token
  similarity ("SoftTFIDF") the best name matcher in their comparison (**verified** by thread 1:
  [PDF](https://www.cs.cmu.edu/~wcohen/postscript/ijcai-ws-2003.pdf)). For us this is a weighting change inside the
  existing per-token scorer, not a rewrite (**hypothesis**).
- **What it costs.** One offline pass builds `title_norm → works`, `title_token → df` and `author_norm → works` from
  `catalog-v2.sqlite`. Each candidate then needs one indexed lookup (**hypothesis**; minutes of SQL, a few hundred MB
  at most). FTS5's `fts5vocab` gives only trigram document frequency, so word-level and whole-title tables are new
  (**verified**: [SQLite FTS5](https://www.sqlite.org/fts5.html)).
- **What it cuts.** Generic titles and name-as-title matches need author agreement to pass. It does **not** separate
  "same title, other author" when no author was read; those should fall to `unknown` (INV-5) unless the title is
  rare.

### 1.3 Counter-evidence and an explicit "none of these"

Entity linkers tuned without "no match" cases rarely say none. On AIDA with NIL mentions, BLINK-cross scores 83.08 on
linkable mentions and 45.16 on NIL ones. The authors conclude "both types of NIL training data are necessary"
(**verified** by thread 1: [Zhu et al. 2023](https://arxiv.org/abs/2305.15725)). Our 9 % closed-set against 40 %
open-catalog wrong-accept share is the same effect from the catalog side (**hypothesis**).

Evidence that should count *against* a candidate (**hypothesis**; each targets one class in §1.1):

| Counter-evidence | Targets |
|---|---|
| A name-like run in the reading that fails the candidate's author list | same title, another author |
| A rare read token (low catalog df) that neither the candidate's title nor its author explains | one spine word matched, the rest ignored |
| **Candidate coverage:** the share of the candidate title's own tokens seen in the reading (today only query coverage is measured) | another book by the same author; a long title matched by one word |
| The reading's script or language differs from every edition's | another language's edition |

### 1.4 The margin test, after collapsing duplicates

- **A margin alone is a weak "no match" test.** At TAC-KBP, a NIL rule on the top score reached F1 68.3 / 76.5 /
  70.6 (2009 / 10 / 11). A rule on the top-1/top-2 gap reached 59.4 / 60.1 / 39.7 (**verified** by thread 1, PDF
  text: [USFD, arXiv 1203.5073](https://arxiv.org/abs/1203.5073)). So a margin should be an *extra* veto, which is
  how C-5 proposed it, not the main gate.
- **Collapse duplicates first.** Open Library keeps duplicate work records of one book (C-5 caveats). Group candidates
  by normalised title plus primary author before measuring the runner-up. Otherwise a duplicate looks like a rival
  and vetoes a true match (**hypothesis**).
- **Popularity (edition count) is not the fix.** It is standard in entity linking, but it pushes toward the famous
  namesake. Keep it as `retrieve`'s tie-break between near-equal, duplicate-collapsed candidates only. It is a
  catalog fact, not taste (INV-13).

### 1.5 Candidate generation

- **Rarest read words first.** Order the reading's tokens by catalog df and issue small per-token trigram queries,
  rarest first, until the pool fills. Common words then never use up the 250 forms. This is the cap that dropped
  C-5's `n025`, where "philip" forms crowd out the title word (**hypothesis**; the MaxScore/WAND analogy is thread 1's
  recollection, unread).
- **An exact normalised-title hash index**, queried first, so a clean read is O(1) (**hypothesis**).
- **No token under 3 characters goes to the trigram index.** FTS5 says shorter trigram queries "do not match any
  rows". A `LIKE`/`GLOB` without a 3-character literal falls back to a linear scan (**verified**:
  [SQLite FTS5](https://www.sqlite.org/fts5.html)). A hidden scan is one candidate cause of v2's p95 (**hypothesis**;
  check the query plans).
- **Use every reader's words to generate, keep each reader's own vote to accept.** Aligning several OCR engines lowers
  error a lot. Lund & Ringger report the aligned lattice's oracle error 55 % below a single engine's (**snippet**:
  [CIKM 2013](https://pike.psu.edu/publications/cikm13.pdf)). So the union of reader tokens holds the right words more
  often than any one reader. Use it for recall, never for agreement.
  - Tokens read by two different readers ("consensus tokens") may weigh more. Two Qwen reads of one crop count once
    (INV-6) (**hypothesis**).
- **OCR confusion costs** (`rn`↔`m`, `l`↔`1`, `0`↔`O`) can be counted without labels. Align each reader's string to
  the catalog title on spines that *two other* readers confirmed, real-use set only (**hypothesis**). Expect a modest
  recall gain and little effect on namesakes, which are mostly correct reads of an ambiguous word.

### 1.6 What not to do now

- **Dense embeddings do not fix an open catalog.** The PROXY yardstick's own paper (Llabrés et al. 2024; Barcelona
  library shelves; SAM plus Amazon Rekognition OCR) matched OCR text to a 15,229-book library list and to a 2.3M-book
  Goodreads list. Matching-only accuracy, Table 2 (**verified, re-checked**: [arXiv 2407.19812](https://arxiv.org/html/2407.19812v1)):

  | Method | 15k library list | 2.3M list |
  |---|---:|---:|
  | String matching (Levenshtein) | 0.742 | 0.505 |
  | CLIP | 0.915 | 0.449 |
  | CLIP + BERT re-ranker | 0.824 | 0.310 |
  | CLIP + Hungarian (one-to-one) | 0.918 | not run |

  - String matching lost least at catalog scale (**hypothesis** from the table).
  - Our FTS5 trigram index is already a character n-gram matcher.
  - The paper uses the spines' library tags nowhere ("we do not use them"), and no shelf order. Hungarian assignment
    added 0.003, and "its performance suffers" as distractors grow (**verified, re-checked**).
  - This paper is the PROXY's source: its published numbers can be cited, and nothing may be tuned on its data
    (OC35).
- **Typos hurt word-level retrieval badly. A trigram index already holds most of the robustness.** On MS MARCO with one
  synthetic typo per query, MRR@10 fell from 0.187 to 0.095 for BM25 and from 0.325 to 0.136 for a BERT dense
  retriever. CharacterBERT-DR with self-teaching fell only to 0.263 (**verified** by thread 1:
  [Zhuang & Zuccon 2022](https://ar5iv.labs.arxiv.org/html/2204.00716)). One OCR substitution breaks at most three
  trigrams of a word, not the word (**hypothesis**).
- **Rerankers score relevance, not identity.** The small open rerankers are all Apache-2.0: ms-marco-MiniLM-L6
  (22.7M), bge-reranker-v2-m3 and Qwen3-Reranker-0.6B (about 0.6B) (**verified** by thread 1, model cards). None is
  tested on OCR-noisy short titles. Llabrés's BERT re-ranker *lost* to plain CLIP on both lists (above).
  - The closer analogue is entity matching. Zero-shot Llama 3.1 70B reaches 83.67 F1 on WDC Products against
    fine-tuned Ditto's 84.90 (**verified** by thread 1: [Peeters et al.](https://arxiv.org/html/2310.11244v4)). That
    is far too heavy to run per spine.
  - A label-free option for later: a small pair classifier trained on catalog titles passed through an OCR-like
    corruptor, with namesakes as hard negatives and a "none" output (**hypothesis**).
- **Learned sparse retrieval: no.** `naver/splade-v3` is CC BY-NC-SA 4.0 (**verified** by thread 1, model card). The
  non-commercial term conflicts with an AGPL-3.0 repo, as C-0 found for `open-shelves`.
- **Phonetic matching: no.** "Pattern matching methods clearly outperform phonetic encoding methods" on names
  (**verified** by thread 1: [Christen 2006 slides](http://users.cecs.anu.edu.au/~Peter.Christen/publications/mcd2006-slides.pdf)).
  OCR errors are visual, and phonetic codes merge names, which adds namesakes (**hypothesis**).
- **Vectors at 4M, if ever:**
  - sqlite-vec is brute force. Its author's benchmark on an M1 mini took 192 ms for 1M × 192-d floats and says
    "the limits of `sqlite-vec` really show at 1 million vectors" (**verified** by thread 1:
    [release post](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)).
  - For 4.25M strings at 384 dimensions: 6.5 GB as float32, 1.6 GB as int8, 204 MB as binary. Float brute force
    would take about 1.6 s per query (**hypothesis**, arithmetic).
  - Fusion with FTS would be reciprocal-rank fusion, k = 60 (**verified** by thread 1:
    [Cormack et al. 2009](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)).
  - Recall add-on at best, for readings whose trigrams all fail. No effect on namesake precision.

### 1.7 INV-6 for scorers

- **A text-only scorer or reranker** that sees (reader string, candidate record) is part of the *scorer*. It may
  change which candidate a reader nominates and whether that candidate passes. It never adds a reader vote.
- **A shared scorer correlates the readers.** It scores all three readers' strings, so its errors are shared. Log
  agreement that appears only after a new scorer separately, as weaker evidence.
- **Prefer a scorer from a different model family** than the Qwen reader, so a famous-namesake bias is not doubled.
- **A model that re-reads the crop is a reader.** If it is Qwen-family, it counts with Qwen's read under INV-6.

(All **hypothesis**.)

## 2. Shelf context (F-0h)

### 2.1 Prior art

| Work | Use of order or neighbours | Numbers as reported | Label |
|---|---|---|---|
| Llabrés et al. 2024 (the PROXY's paper) | None; library tags unused | Hungarian +0.003 on the 15k list | **verified, re-checked**: [arXiv 2407.19812](https://arxiv.org/html/2407.19812v1) |
| Yang et al. 2016, "Smart Library" | OCR text → Solr; shelf location is an output, not an input | 454 spine images vs 9,000+ books; recall@5 96.4 % | **verified** by thread 2: [arXiv 1611.07385](https://arxiv.org/abs/1611.07385) |
| Shelf-reading robots and systems (Pars, AuRoSS, BookBot, LibScoutR, UJI) | Read call numbers, barcodes or RFID and compare with the expected order to flag misplaced books | none comparable | **verified** abstract for [Pars](https://www.emerald.com/ir/article/48/5/649/176284/An-autonomous-vision-based-shelf-reader-robot); others **snippet** |
| Tonioni & Di Stefano 2017, planogram compliance | Reject detections that disagree with their neighbours; then propose the expected product for each empty slot from assigned neighbours and verify it with local image matching; an unverified slot is reported missing | 70 Grocery Products images, 872 instances of 181 products (**verified, re-checked**). Precision about 78 → 98 % after filtering, recall about 75 → 74 %, about 90 % after verification (read from figures; **snippet**) | [arXiv 1707.08378](https://ar5iv.arxiv.org/html/1707.08378) |
| Yücel & Ünsalan 2022, planogram compliance | Align the row to the planogram (modified Needleman–Wunsch), then re-search unmatched regions with relaxed thresholds | F1 0.853–0.939 → 0.970–0.992 (Migros subset 1) | **verified** by thread 2: [arXiv 2212.01004](https://ar5iv.labs.arxiv.org/html/2212.01004) |
| Baz, Yörük, Çetin 2016–2019 | Context-free classifiers plus an HMM/CRF along the shelf; per-position confidence sets | abstracts only, no numbers read | **verified** abstracts ([2016](https://research.sabanciuniv.edu/id/eprint/30357), [2017](https://research.sabanciuniv.edu/33854)) |

Takeaways (**hypothesis**):

- **Order has been used to audit, never to identify.** Shelf readers check an order of items they have already
  identified. Retail systems relax their bar inside a context-proposed region only because the planogram is known.
- **A bookstore has no planogram.** It has a weak convention (section, then author surname, then title), so the gains
  will be smaller and the risk of lowering the bar larger.
- **The retail pattern is the one to copy.** Context proposes and local evidence verifies. Anything left unverified is
  reported as missing, which is our `unknown` (INV-5).

### 2.2 Shelves are not reliably ordered

- **Libraries.** One library's misshelved rate fell from 11.6 % to 3.1 % over five annual inventories (**verified**
  abstract: [Purdue](https://docs.lib.purdue.edu/lib_fsdocs/1)). In another library, 82 % of misshelved books were
  within 1–25 places of their spot (**snippet**: [EBLIP summary](https://doi.org/10.18438/b8x32x)).
- **Home shelves** follow many schemes or none (**verified**: [Readings](https://www.readings.com.au/news/how-do-booksellers-organise-their-bookshelves)).
- **Bookstores.** No published rate was found. Face-outs, staff picks, new-release runs and series-order shelving all
  break alphabetical order (**snippet**).
- **Measure it ourselves**, from spines two readers confirmed, never from labels:
  - the share of adjacent confirmed pairs that share an author;
  - the share in non-decreasing surname order;
  - the same with face-outs removed.

### 2.3 F-0h design (pre-registration draft)

The motivating case, described generically: a vision-language reader misreads one word of a title by a letter or
two, and the spine beside it is another book by the same author. Retrieval over 4M works scatters the misread title
among namesakes. Proposing that author's works first puts the right one in a set of a few dozen, where the misread is
easy to test.

**Principle:** context proposes, the spine's own text confirms. Context narrows the hypothesis space. It may stand in
for **the second reader only**. It never supplies title evidence, never counts as a reading, and never uses the
profile (INV-13: shelf context is what is on this shelf in this photo, not taste).

1. **Hypothesis.** For a spine that is not confirmed but has a reader's title-like text, proposing the works and
   series siblings of an adjacent anchor, then testing them against the spine's own text, converts some
   `single-reader` spines. It does so without raising the yardstick's wrong-accept share beyond its interval.
2. **Population.** The real-use set at the snapshot named in the card, split 50/50 by a hash of the photo id.
   - Half A gives the descriptive order statistics (§2.2).
   - Half B is for evaluation.
   - Face-out boxes, lying books and not-a-book boxes are excluded as targets and as anchors.
3. **Anchors.**
   - Only spines two different readers confirmed (`readers-agree`), **after the C-7 rule**. Not copy-lent, not
     context-confirmed, so confirmations cannot chain.
   - On the same row (F-0f's row), at most 2 spines away, with at most one unknown spine between.
4. **Proposals (bounded).** P1, the anchor's author's works, plus P2, the anchor work's series siblings (title
   series; ISFDB publisher series once loaded, §3.4). Deduplicate by work.
   - At most K = 60. Above that, keep the top 60 by the reader's text score inside the author or series filter.
   - Log K.
   - No alphabetical-bracket proposer in v1: the set is too large unless both anchors share a surname prefix.
5. **Test (constants frozen before the run).** Accept proposal *c* only if all of these hold. Otherwise `unknown`.
   - **Own text explains *c*.** One reader's text matches each distinctive token of *c*'s title exactly, by
     skeleton, or within edit distance 1 (tokens up to 6 letters) or 2 (7 and more).
     - Matched characters cover ≥ 0.8 of *c*'s title.
     - *c* accounts for ≥ 0.5 of the reading's tokens.
     - *c* has two distinctive tokens, or one of 6+ letters at edit distance 0–1. This blocks one-word generic
       matches.
     - "Distinctive" means catalog df below a percentile fixed from catalog statistics only.
   - **Margin inside the set.** The runner-up proposal fails the test above, or its total edit distance is at least 2
     larger. This is the guard against another book by the same author, a known wrong-accept class.
   - **No conflicting reader.** No other reader confirms a different work under the normal bar. A repeat LLM read
     counts once (INV-6). If a second, different reader also supports *c*, it is an ordinary two-reader accept, not
     a context accept.
   - **No open-catalog winner.** No candidate outside the set, from the same reading, passes the single-reader title
     bar and beats *c* by more than 0.05.
   - **Bar.** Title evidence may drop from 0.8 to 0.6, only through the edit bound above. Coverage stays ≥ 0.5.
6. **Output.** Decision basis `confirmed-by-context`, recorded with the anchor ids, source (P1 or P2), K, reader,
   edit distance and margin. It can be switched off, is never an anchor, and never lends to copy groups.
7. **Controls, on half B** (all machine agreement):
   - **Neighbour shuffle:** each anchor is replaced by a two-reader spine from another row whose author has a
     similar number of works, over 20 fixed seeds. If accepts do not collapse, the reader text and the lowered bar
     did the work, not context.
   - **Leave one reader out:** on two-reader spines with an anchor, hide one reader and run F-0h. Report agreement,
     disagreement and abstention against the two-reader work. These spines read more cleanly than true single-reader
     ones, so state that.
   - **Same-author stress:** the subset of the previous control whose work shares the anchor's author.
8. **Keep rule (all must hold):**
   - mean shuffled accepts ≤ 10 % of real accepts, and the 95th-percentile seed ≤ 15 %;
   - leave-one-reader-out disagreement ≤ 5 % of F-0h's accepts (Wilson upper bound reported);
   - same-author wrong-work rate ≤ 5 %;
   - the yardstick's overall wrong-accept share stays within the baseline's 95 % interval;
   - at least 1 point of half B's `single-reader` spines converted.
9. **Forbidden:** changing a constant after seeing half B or the yardstick; any profile input; any cover-image
   matching.
10. **Reported whatever the outcome:** accepts by source and by K bucket, the shuffled rate, and half A's order
    statistics (for I-2's misplacement rate).

**What transfers from the yardstick (hypothesis).**
- Same-author adjacency transfers in fiction: libraries shelve fiction by author, stores alphabetise by author within
  a section.
- An alphabetical bracket does not transfer to non-fiction, which the library shelves by subject number.
- Call-number order is library-only and yardstick-only, so it cannot inform the design (OC35).
- The yardstick's spines carry library tags (Llabrés et al.); F-0d found shelf-mark stickers read as imprints. Neither
  exists in a store.

### 2.4 Relation to I-2

I-2 (joint shelf assignment, copies allowed) is a chain problem: Viterbi or dynamic programming over each spine's
candidates plus `unknown`. Ship F-0h first as its own thin slice. It has one basis and one switch, and the shuffle
can falsify it. A joint decoder blends evidence, which makes it hard to show that context did the work.

Define the context score once (same-author term, series term, soft order with a measured misplacement rate, row
gate). F-0h uses it to propose; I-2 later uses it as the pairwise term. Carry F-0h's rule into I-2: every spine needs
its own evidence above a floor, and pairwise terms may only re-rank candidates that clear it. The alphabetical
bracket belongs in I-2 as a soft term, and only in rows that pass a measured sortedness gate (**hypothesis**).

## 3. Imprint, publisher and trade dress

### 3.1 How much an imprint read is worth

Arithmetic on F-0d's verified numbers (**hypothesis**). p1 = 0.395 is the share of confirmed works whose editions
carry the read house (interval 0.207–0.544, n = 38). p0 = 0.078 is the shuffle chance level.

| Outcome | Likelihood ratio | Bits |
|---|---:|---:|
| Read house matches the candidate | 0.395 / 0.078 = **5.1** | +2.3 (1.4–2.8 over p1's interval) |
| Read house does not match | 0.605 / 0.922 = **0.66** | −0.6 |
| No imprint read (82 % of boxes) | 1 | 0 |
| Contrast: candidate lacks the house, a rival has it (independence assumed) | (0.395 × 0.922) / (0.078 × 0.605) = **7.7** | 2.9 |

A single-candidate veto would drop the six in ten true works that do not match. A contrast between two candidates
the text already supports is the strong form. How strong depends on the rival:

- **Another-language edition or foreign namesake:** strong. An English house almost never publishes it.
- **Same title by another author, or a generic title:** useful. p0 is near the house's market share.
- **Another book by the same author:** weak. Authors tend to stay with one house.

So imprint helps against exactly the namesake classes C-5 found, and barely against same-author confusion
(**hypothesis**).

### 3.2 Rule IMP-1: imprint contrasts, never confirms (proposal)

1. **Scope.** Only candidates that each pass the text bar on their own. Imprint never enters candidate generation or
   `retrieve`'s score. A house like "penguin" matches tens of thousands of works. It never adds a reader: it is
   Qwen's read of the same crop (INV-6). It never promotes a candidate that fails the bar.
2. **Withhold.** If the accepted work's editions lack the read house **and** a runner-up within the lookalike margin
   carries it, the spine becomes `unknown` with both candidates shown. It does not switch to the runner-up.
3. **Reorder** between two passing candidates: F-0d's tie-break, kept.
4. **Hygiene.**
   - Drop reads that look like shelf marks: F-0d found 44 of 109 yardstick imprint reads were library stickers.
   - Keys need 3+ letters; club segments never count.
   - A match through an undated parent house counts for the reorder (3), not for the withhold (2).

### 3.3 Logos and trade dress

- **No logo detector.**
  - Open-set logo retrieval is strong on clean crops: recall@1 0.987 on a 2,714-class benchmark, and image-text
    pre-training helps most on text-heavy logos (**verified** by thread 3:
    [Hubenthal & Kumar, WACV 2023](https://arxiv.org/html/2309.10206v1)).
  - But F-0d's logo reads were already more precise than its text reads (46 % against 36 %). Where the tie-break
    could act, the read house was in none of the candidates' editions. The binding limit is catalog data, not the
    eye.
  - If one is ever wanted: a private gallery self-harvested from the owner's confirmed crops, matched one-shot with
    OWLv2's image-guided detection (**verified** by thread 3:
    [Transformers docs](https://huggingface.co/docs/transformers/en/model_doc/owlv2)). Never logo images in the repo.
- **Trade dress proposes, never confirms.**
  - No paper was found that predicts publisher or series from cover or spine appearance (**snippet**).
  - Genre from covers peaks at 30.5 % on 30 classes (**verified** by thread 3:
    [uchidalab results](https://github.com/uchidalab/book-dataset/blob/master/docs/results.md)).
  - F-0g already showed that one author's series in matching jackets looks like copies. A look-alike neighbour may
    route F-0h to a series' members, and the spine's text still decides.

### 3.4 Catalog data first

- **Open Library publishers.** C-5's import keeps only "publisher (the first listed)" per edition (**verified**:
  `docs/catalog.md`). Open Library's edition `publishers` and `series` are free-text string arrays, and works have no
  series (**verified** by thread 3: [edition schema](https://github.com/internetarchive/openlibrary-client/blob/master/olclient/schemata/edition.schema.json)).
  Keep every string.
- **ISFDB publisher series.** `pub_series` (11,225 rows) and `pubs.pub_series_id` are staged but unused by the catalog
  build (**verified**: `src/catalog/isfdb-staging.ts`; no other reference under `src/`). They are the catalog's record
  of a publisher line's shared design, and they feed F-0h's P2.
- **Aliases.** The alias table has three hand entries (**verified**: `src/catalog/imprint.ts`).
- **Wikidata as a dated parent map** (CC0; **verified** by thread 3 on the public query service, 2026-11-03):
  - 604 items carry an ISFDB publisher ID (P1239); 264 of them have a parent organisation or owner (P749/P127).
  - Only 74 of those 350 statements are dated.
  - Modelling is uneven: one large SF imprint has only "owned by", one points to its current owner, two have no
    parent.
  - Use it to extend the ISFDB-derived parent table through P1239, not as an edition source (4,109 items carry an
    ISFDB publication ID, against 967k ISFDB publications).

## 4. A reference image store

The owner's text-only ruling stands. Images were reopened for research only, and any build goes back to the owner.

### 4.1 Sources and terms

| Source | Terms, as read | Private matching index? | Label |
|---|---|---|---|
| **Open Library Covers API** | The API "is intended for displaying covers on public facing websites and not for bulk download"; "do not crawl our cover API". Lookups by ids other than CoverID and OLID are limited to 100 per IP per 5 minutes (CoverID and OLID are left out, not declared unlimited). No licence for the images; a courtesy link "is appreciated" | Bulk: no. A few on-demand fetches by CoverID/OLID are closer to the stated use but are still not display | **verified, re-checked**: [covers API](https://openlibrary.org/dev/docs/api/covers) |
| **Open Library cover dumps** (archive.org) | The covers page points bulk users to archive.org tar sets named by CoverID. Their item metadata has empty licence and rights fields; a medium item is 10–26 GB | The host-sanctioned bulk route, but no licence over the art | **verified** (re-checked: covers page; item metadata by thread 4) |
| **Internet Archive terms** | The live terms page did not render. A 2014 amendment limits use of the collections to noninfringing or fair use | Only as far as the use is itself lawful; do not use lending scans | **snippet**: [IA blog 2014](https://blog.archive.org/2014/12/30/update-to-terms-of-use/) |
| **Wikimedia Commons** | `Category:Book covers` holds about 12,000 files: public domain by age, below the threshold of originality, or uploaders' own | Licence-clean but tiny and old; good for public test fixtures only | **verified** by thread 4 |
| **Google Books API** | Google APIs Terms §5(e): you may not "build databases, or otherwise create permanent copies" | No (also needs a key) | **verified** by thread 4; C-R's earlier read agrees |
| **Amazon** (Associates, Creators API) | No storing or caching of images; use must be mainly to advertise Amazon; no machine-learning or data-mining use | No | **verified** by thread 4 |
| **ONIX trade feeds** | Cover links under trade agreements; aggregators take licences for their own products | No, without a trade relationship | **snippet** |
| **Cover datasets on GitHub and Hugging Face** | Iwana et al.'s set: "copyright Amazon.com"; `iscc/iscc-book-covers`: research use only, Amazon-derived; FORB: CC BY-NC-SA; others: no or unclear licence | No (all Amazon-derived, non-commercial, or unclear) | **verified** by thread 4 (FORB licence re-checked) |
| **Spine datasets** | Llabrés (MIT): shelf photos only, no per-book reference images. Zhou et al. 2022: self-photographed, licence unstated. `open-shelves`: CC BY-NC-SA. `quist99/book-spine-ocr`: 2.7k images, no licence | No public spine gallery at catalog scale | **verified** by thread 4 |

### 4.2 What copyright and the terms allow (hypothesis, not legal advice)

- **Two layers.** Host terms bind us to the host; copyright in the art belongs to publishers and artists. A
  permissive host does not license the art, and a restrictive host can forbid what copyright allows.
- **Ingest is a copy.** An embedding needs the image decoded first, so "embeddings only" still needs an exception.
  - US fair use: search-index cases (*Perfect 10 v. Amazon*, thumbnails "highly transformative"; *Authors Guild v.
    Google*). **Verified** by thread 4 on the opinion text and the Copyright Office summary.
  - EU: DSM Directive Art. 4 allows reproductions of lawfully accessible works for text and data mining unless the
    rights holder reserved that, for example by machine-readable means (**verified** by thread 4:
    [Art. 4](https://www.legislation.gov.uk/eudr/2019/790/article/4)). Whether Open Library's prose "do not crawl"
    counts as a reservation is unsettled.
- **Is an embedding a derivative work?** No authority was found. A vector that cannot be shown as the cover is closer
  to a fingerprint than a copy. Fingerprints of covers are already published (ISCC codes for 3M covers).
- **Display is not matching.** Showing a candidate's cover live from the covers API, with a link back, fits Open
  Library's stated purpose. Matching against it does not.
- **The AGPL repo** may hold fetch, embed and cache code, model names, and licence-clean fixtures (the owner's own
  released photos, or public-domain covers from Commons). It must never hold cover images, thumbnails or embeddings
  of third-party covers, bulk-crawl scripts, or Amazon, Google or ONIX data. The data root is private (OC9).
- **Model licences** (**verified** by thread 4):
  - Apache-2.0 or BSD and AGPL-compatible: DINOv2, SigLIP 2, LightGlue, DISK (Apache-2.0); ALIKED (BSD-3); PDQ
    (BSD).
  - SuperPoint is "noncommercial research use only": exclude it.
  - DINOv3 has its own licence.
  - LAION's CLIP cards say deployed use is "out of scope".

### 4.3 Matching methods and what prior work reports

| Work | Task | Result | Label |
|---|---|---|---|
| Tsai et al. 2011 | **Spines**, 2,300-spine gallery the authors photographed, 454 queries | At 95 % precision: image 72 %, text under 40 %, hybrid 91 % recall; only about 58 % found by both | **verified** by thread 4; not re-opened here (the host failed TLS; thread 2 and 3 also could not open it) |
| Shih et al. 2014 | **Covers**, 404 phone queries for 101 titles against 104,132 Open Library distractor covers | Top-1: image (VLAD) 0.18, OCR 0.31, fused 0.60, fused plus geometric re-rank of the top 15 0.67 | **verified, re-checked**: [arXiv 1411.5307](https://ar5iv.labs.arxiv.org/html/1411.5307), Table 1. VLAD's drop from 0.68 without distractors is partly a codebook change |
| FORB 2023 | **Covers**, 1,461 queries, 470 index images plus 10,739 distractors | mAP@5: CLIP ViT-L/14@336 99.17 (flagged as a possible upper bound from training overlap), RootSIFT bag of words 87.92, DINOv2 68.56 | **verified, re-checked**: [arXiv 2309.16249](https://arxiv.org/html/2309.16249), Table 5 |
| Zhou et al. 2022 | **Spines**, closed set of 3.6k ids, self-photographed | top-1 99.18 % | **verified** by thread 4 (repo abstract) |

What this says (**hypothesis**):

- **Image and text evidence are complementary** on covers and on spines, so fusion helps.
- **Open search against a large gallery is weak** (0.18 top-1 from image features at 104k). **Re-ranking a short
  text-generated list is where images pay** (0.31 → 0.60–0.67).
- **CLIP-family models partly read text.** They do well on covers, but their evidence is less independent of our
  readers.
- **Perceptual hashes are for near-duplicates.** Their own docs say they are sensitive to heavy cropping, so they do
  not suit fragments.
- **Spine-image systems all photographed their own spines.** A front cover shares a palette with its spine, and
  sometimes a font, but never the layout. No paper was found that matches spines against a cover gallery.

### 4.4 Size and cost at 4M works (hypothesis, arithmetic)

- **Embeddings:** 4M × 768-d fp16 = 6.1 GB; as binary codes 384 MB; as PQ-64 256 MB. Per edition, which is how
  covers exist, it could reach about 20 GB.
- **Fetching:** 4M covers at 100 requests per 5 minutes is 139 days from one IP, and crawling is forbidden anyway.
  The archive.org dumps are hundreds of GB, a bulk download this card may not make.
- **Embedding time:** about 3–10 hours for 4M on Apple Silicon. No published M-series throughput was found; it needs
  a local benchmark.
- **Staged, on demand:** about 5 face-out covers a shelf × top-5 candidates = 25 fetches, inside any rate limit. Fetches
  for ambiguous *spines* would also fit and are pointless, because covers do not match spines.
- **Privacy, a cost no other layer has:** every on-demand fetch tells Open Library which books were near the owner's
  photo. The brief's rule forbids putting private data into an external service. Only a store pre-built offline
  avoids that, and it needs the bulk ingest.

### 4.5 Verdict

- **Spines: not worth it.** No public spine imagery exists at catalog scale, and covers cannot match spines. An
  external store does nothing for the 25 % of boxes with no text, nor for namesake spines.
- **A 4M cover store: not worth it now.**
  - The licence posture is the binding constraint: no source licenses the art, and the bulk route rests on fair use
    or TDM.
  - Open search at that size is weak, and face-outs are about 4.6 a photo (F-0c).
  - Most face-out covers stall on OCR, so a text candidate list may not exist to re-rank.
- **Worth one pre-registered experiment, if the owner reopens images: an on-demand cover re-ranker for face-out
  covers.**
  - It fetches the top-k text candidates' covers by CoverID or OLID and embeds them privately under the data root,
    never shown and never committed.
  - It counts as one piece of image evidence that can re-rank or withhold among text candidates. It never confirms
    alone, and `unknown` stays (INV-5).
  - The PROXY has no face-out covers, so it is judged on the real-use set by machine agreement only. That is weak.
- **A different image layer needs no external images: a self-gallery.**
  - It fingerprints the owner's own text-confirmed spine crops, to re-identify the same physical copies in a later
    shoot.
  - It is licence-free and closed-set, the regime where Zhou et al. report 99 % top-1. F-0g's appearance model is
    already a small version of it.
  - It only re-finds books once read, never a book no reader could read.
  - It still uses images for identification, so it needs the same ruling.

### 4.6 Questions for the owner

1. Reopen images at all? For face-out covers only, for the own-photo self-gallery, or both?
2. May candidate ids be sent to covers.openlibrary.org, given it reveals shelf contents? If not, any cover store must
   be pre-built offline, which means a bulk ingest.
3. Bulk download of the archive.org cover dumps (hundreds of GB, no licence metadata): acceptable, or on-demand only?
4. May cached cover images stay under the data root, or embeddings only?
5. Which jurisdiction's law applies, and is legal advice wanted before any ingest?
6. Model licences: Apache/BSD only (SigLIP 2, DINOv2, LightGlue, ALIKED), or also DINOv3's own licence?
7. Can an image match ever confirm alone, or only re-rank and withhold among text candidates?

## 5. Synthesis: a layered architecture

Ranked by expected gain per effort on our pipeline. Each layer keeps the rules:
- keep rules are pre-registered;
- no hand labels (OC36);
- `pilot-000` reports machine agreement, never accuracy (INV-17);
- the yardstick is evaluated, never tuned on (OC35);
- repeated LLM reads count once (INV-6);
- the profile never reaches identification (INV-13).

| # | Layer | Gain it targets | Effort | Needs | How it is measured |
|---|---|---|---|---|---|
| 0 | **Lookalike guard** (C-6, running) | wrong accepts from close runners-up | S | — | C-6's own pre-registration |
| 1 | **Rarity-weighted evidence and counter-evidence** (C-7) | the namesake classes in §1.1; wrong accepts per spine back toward v1 | S–M, offline, no GPU | C-6 merged; catalog statistics tables | Replay F-0's cached readings on v2. Yardstick wrong-accept share and wrong per spine against C-6; `pilot-000` confirmations, switches and losses |
| 2 | **Candidate generation** (C-8) | recall lost to the cap; p95 | M | C-7's df tables | C-3's golden fragments (clean bar ≥ 90 % top-5; noisy back to 100 %); p95; yardstick candidate recall |
| 3 | **Imprint data and IMP-1** (C-9) | namesakes with a different house | S data, S rule | C-7; F-0d's cached imprint reads | p1 before and after the data fix; yardstick wrong accepts on eligible boxes; `pilot-000` withhold rate |
| 4 | **Neighbour context** (F-0h) | `single-reader` spines (923 on `pilot-000`) | M | C-7 merged (clean anchors); ISFDB publisher series from C-9 for P2 | §2.3: shuffle, leave-one-reader-out, same-author stress, yardstick interval |
| 5 | **Joint row assignment** (I-2) | near-ties along a row; copies | M–L | F-0h's context score; measured order statistics | I-2's synthetic tests plus the shuffle control |
| 6 | **Cover re-ranker for face-outs** | face-out namesakes | M | **owner ruling (§4.6)** and a text candidate list | real-use machine agreement only (no PROXY covers) |
| — | Dense vectors, rerankers, SPLADE, phonetic, logo detector, a 4M or spine image store | — | — | — | not proposed (§1.6, §3.3, §4.5) |

Why this order (**hypothesis**):

- **Layers 1–3 are offline re-decisions of cached reads.** They are cheap, need no GPU, and directly attack the
  measured problem: about 40 % of open-catalog accepts are wrong.
- **Context depends on clean anchors.** On today's open-catalog accepts (about 40 % wrong on the yardstick), F-0h would
  often propose from the wrong author, so it comes after the accept rule.
- **Images come last,** because the owner must rule first, the licence posture is weak, and the gain is limited to
  face-outs.

**One label-free measurement worth reusing everywhere: leave one reader out.** On spines two readers confirmed, hide
one reader and ask whether a new layer recovers the same work from the other reader plus its new evidence. This
gives an agreement rate with a known target on real-use data, without labels (INV-17 wording). It is biased toward
clean reads, so report that. The F-0h shuffle control generalises the same way: any layer that uses context should
lose its gain when the context is permuted.

## 6. Proposed cards

For the conductor to queue. Card ids are proposals; C-6 is the running lookalike guard.

#### C-7 · Rarity-weighted evidence and counter-evidence
- **entry:** C-6 merged (it changes the same accept rule); v2 catalog built (C-5).
- **do:**
  - Build catalog statistics tables from `catalog-v2.sqlite`: whole normalised title → works, title token → df,
    author → works.
  - Add rarity-weighted title evidence and the counter-evidence in §1.3 to the scorer's evidence, as new fields
    beside the current scores.
  - Collapse duplicate works (same normalised title and primary author) before any margin.
  - Write the new accept rule as a decision basis that can be switched off.
  - Every constant is fixed from catalog statistics before the replay: the title-frequency cut above which author
    agreement is required, the rare-token df, the TF weight for fuzzy matches. None is tuned on either set.
- **files:** `src/catalog/rarity.ts` (new), `src/catalog/build.ts` (tables), `src/catalog/retrieve.ts` (evidence
  fields only), `src/eval/f0.ts` (accept rule, after C-6), `evals/C7/`, `docs/catalog.md`.
- **exit:**
  - Offline replay of F-0's cached readings on both sets, against C-6's rule and against F-0's original rule.
  - Keep rule fixed in the card before the run. Suggested: yardstick wrong-accept share falls with its paired
    interval excluding 0, and yardstick confirmed accepts fall by no more than 15 % relative.
  - On `pilot-000`, report machine-agreement changes, never accuracy.
  - C-3's golden bar holds.

#### C-8 · Candidate generation: rare words first
- **entry:** C-7's df tables.
- **do:**
  - An exact normalised-title index queried first.
  - Per-token trigram queries ordered rarest-first, each with a small cap, filling a pool of 250.
  - No token under 3 characters goes to the trigram index; check v2's query plans for scans.
  - All readers' tokens may generate candidates; acceptance stays per reader.
- **files:** `src/catalog/retrieve.ts`, `src/catalog/golden.ts`, `evals/C8/`, `docs/catalog.md`.
- **exit:**
  - Golden clean top-5 ≥ 90 % (C-3's bar); noisy top-5 back to 100 %, or each loss explained.
  - p95 ≤ 300 ms on v2 (suggested).
  - Yardstick candidate recall (the right book anywhere in the list) no more than 1 point below today.

#### C-9 · Imprint data and the contrast rule (IMP-1)
- **entry:** C-7 merged; F-0d's cached imprint reads.
- **do:**
  - Keep every Open Library publisher string per edition.
  - Load ISFDB publisher series onto editions.
  - Extend the parent table from Wikidata P749/P127 with dates, joined by P1239. CC0; one small query export,
    committed as data only if the owner agrees it is public-safe.
  - Add a shelf-mark filter on imprint reads.
  - Implement IMP-1 (§3.2) as a switchable withhold.
- **files:** `src/catalog/ol-import.ts`, `src/catalog/ol-merge.ts`, `src/catalog/build.ts`,
  `src/catalog/imprint.ts`, `src/eval/f0d.ts`, `evals/C9/`, `docs/catalog.md`.
- **exit:**
  - p1 recomputed on confirmed boxes before and after the data fix. Keep the data fix if p1 rises ≥ 10 points with
    the chance level up ≤ 2 points.
  - IMP-1 kept if yardstick wrong accepts on eligible boxes fall with the interval excluding 0, and `pilot-000`
    withholds ≤ 5 % of eligible accepts.
  - Stated in advance: the yardstick has no publisher data and its stickers pollute imprint reads, so its arm may be
    uninformative; report that as such, not as a pass.

#### F-0h · Neighbour-context hypotheses
- **entry:** C-7 merged. C-9's publisher series for P2 are optional: P1 alone is a valid v1.
- **do:** the pre-registration in §2.3, committed before the first context decision.
- **files:** `src/eval/f0h.ts`, `src/eval/f0h-cli.ts` (new), `evals/F0h/`, `docs/machine-labelling.md`
  (`confirmed-by-context` basis), `CONTEXT.md`.
- **exit:** §2.3's keep rule. Half A's order statistics are reported for I-2 either way.

#### I-2 amendment (plan update, no new card)
I-2's per-shelf assignment takes F-0h's context score as its pairwise term. It keeps the rule that each spine's own
evidence must clear a floor, and runs the same shuffle control.

#### G-IMG · Owner ruling on images (gate, not a card)
The conductor puts §4.6 to the owner. Only on a yes does a card follow: on-demand face-out cover re-ranker, real-use
machine agreement, pre-registered, nothing image-derived in the repo.

## 7. Not verified, and caveats

- **Thread reads not re-opened here.** A thread's verified claim that this doc did not re-check says "verified by
  thread n". The re-checked set: Llabrés et al., the Splink guides, Tonioni & Di Stefano's setup, Shih et al., FORB,
  and the Open Library covers page.
- **Tsai et al. 2011** could not be re-opened: the PDF host fails TLS, and the fetch was not forced. Its numbers rest
  on one thread's read.
- **Tonioni & Di Stefano's precision and recall** sit in figures. The values above come from a reading of those
  figures, not from text.
- **Not read:** ISFDB's wiki schema pages (login), the live Internet Archive terms (JavaScript-only), LanceDB, any
  Apple Silicon benchmark for HNSW at 4M vectors or for SigLIP/DINOv2 throughput.
- **Our own unknowns.** The bookstore misplacement rate and same-author adjacency are unmeasured; F-0h's half A
  measures them. The size of C-7's effect is a hypothesis until the replay.
- **Suggested keep thresholds** in §6 are drafts. Each card fixes its own before its run.

## Sources

Our reports: `evals/C3-catalog-retrieval/report.md`, `evals/C4/report.md`, `evals/C5/report.md`,
`evals/F0/report.md`, `evals/F0c/report.md`, `evals/F0d/report.md`, `evals/F0g/report.md`, `docs/catalog.md`,
`docs/licences.md`, [`backend-options.md`](backend-options.md).

Retrieval and record linkage
- verified, re-checked: Splink term-frequency guide, https://moj-analytical-services.github.io/splink/topic_guides/comparisons/term-frequency.html
- verified, re-checked: Splink training rationale, https://moj-analytical-services.github.io/splink/topic_guides/training/training_rationale.html
- verified: Splink issue #2006 (TF formula), https://github.com/moj-analytical-services/splink/issues/2006
- verified: Cohen, Ravikumar, Fienberg 2003, https://www.cs.cmu.edu/~wcohen/postscript/ijcai-ws-2003.pdf
- verified: Zhu et al. 2023, Learn to Not Link, https://arxiv.org/abs/2305.15725
- verified: USFD at TAC-KBP 2011, https://arxiv.org/abs/1203.5073
- verified, re-checked: Llabrés, Dey, Karatzas, Valveny 2024, https://arxiv.org/html/2407.19812v1
- verified: Zhuang & Zuccon 2022, CharacterBERT-DR, https://ar5iv.labs.arxiv.org/html/2204.00716
- verified: Peeters, Steiner, Bizer, Entity matching using LLMs, https://arxiv.org/html/2310.11244v4
- verified: model cards, https://huggingface.co/BAAI/bge-reranker-v2-m3 , https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2 , https://huggingface.co/Qwen/Qwen3-Reranker-0.6B , https://huggingface.co/naver/splade-v3
- verified: sqlite-vec release post, https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html
- verified: Cormack, Clarke, Büttcher 2009, RRF, https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- verified: SQLite FTS5, https://www.sqlite.org/fts5.html
- verified: Christen 2006, name matching, http://users.cecs.anu.edu.au/~Peter.Christen/publications/mcd2006-slides.pdf
- snippet: Lund & Ringger, multi-engine OCR alignment, https://pike.psu.edu/publications/cikm13.pdf
- verified: Open Library search counts (public examples), https://openlibrary.org/search.json?title=dune , https://openlibrary.org/search.json?title=neuromancer

Shelf context
- verified: Yang et al. 2016, Smart Library, https://arxiv.org/abs/1611.07385
- verified (setup, re-checked) / snippet (figure values): Tonioni & Di Stefano 2017, https://ar5iv.arxiv.org/html/1707.08378
- verified: Yücel & Ünsalan 2022, https://ar5iv.labs.arxiv.org/html/2212.01004
- verified (abstracts): Baz, Yörük, Çetin, https://research.sabanciuniv.edu/id/eprint/30357 , https://research.sabanciuniv.edu/33854
- verified (abstract): Pars shelf-reader robot, https://www.emerald.com/ir/article/48/5/649/176284/An-autonomous-vision-based-shelf-reader-robot
- verified (abstract): Nixon 2009, Purdue inventory, https://docs.lib.purdue.edu/lib_fsdocs/1
- snippet: Sung, Whisler & Sung 2009, https://doi.org/10.18438/b8x32x
- verified: Readings, how booksellers organise their shelves, https://www.readings.com.au/news/how-do-booksellers-organise-their-bookshelves
- verified: Library Dataset README, https://github.com/llabres/library-dataset

Imprint and trade dress
- verified: Hubenthal & Kumar 2023, logo recognition, https://arxiv.org/html/2309.10206v1
- verified: OWLv2 docs, https://huggingface.co/docs/transformers/en/model_doc/owlv2
- verified: Iwana et al., Judging a book by its cover, https://arxiv.org/abs/1610.09204 ; results, https://github.com/uchidalab/book-dataset/blob/master/docs/results.md
- verified: Open Library edition schema, https://github.com/internetarchive/openlibrary-client/blob/master/olclient/schemata/edition.schema.json
- verified: Wikidata P123, https://www.wikidata.org/wiki/Property:P123 ; counts from https://query.wikidata.org/ (2026-11-03)

Images
- verified, re-checked: Open Library Covers API, https://openlibrary.org/dev/docs/api/covers
- verified: Open Library dumps, https://openlibrary.org/developers/dumps ; archive.org item metadata, https://archive.org/metadata/m_covers_0008
- snippet: Internet Archive terms amendment, https://blog.archive.org/2014/12/30/update-to-terms-of-use/
- verified: Google APIs Terms, https://developers.google.com/terms ; Google Books API terms, https://developers.google.com/books/terms
- verified: Amazon Associates policies, https://affiliate-program.amazon.com/help/operating/policies
- verified: Wikimedia Commons, https://commons.wikimedia.org/wiki/Category:Book_covers , https://commons.wikimedia.org/wiki/Commons:Threshold_of_originality
- verified: cover datasets, https://github.com/uchidalab/book-dataset , https://huggingface.co/datasets/iscc/iscc-book-covers
- verified: Tsai et al. 2011 (thread read only), https://web.stanford.edu/~bgirod/pdfs/Tsai_ACM_Multimedia_11.pdf
- verified, re-checked: Shih et al. 2014, https://ar5iv.labs.arxiv.org/html/1411.5307
- verified, re-checked: FORB, https://arxiv.org/html/2309.16249
- verified: Zhou et al. 2022 (repo), https://github.com/Boatsure/DL-On-shelf-Books-Recognition
- verified: Perfect 10 v. Amazon, https://www.bitlaw.com/source/cases/copyright/Perfect-10.html ; Authors Guild v. Google (USCO summary), https://www.copyright.gov/fair-use/summaries/authorsguild-google-2dcir2015.pdf
- verified: DSM Directive Art. 4, https://www.legislation.gov.uk/eudr/2019/790/article/4
- verified: licences, https://github.com/cvg/LightGlue , https://huggingface.co/facebook/dinov2-base , https://huggingface.co/google/siglip2-base-patch16-224 , https://github.com/magicleap/SuperPointPretrainedNetwork/blob/master/LICENSE , https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md , https://github.com/facebook/ThreatExchange/blob/main/LICENSE
