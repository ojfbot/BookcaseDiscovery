# Taste model (card R-0, OC33)

> **Status: research delivered 2026-11-02; awaiting the owner's ruling (last section).** Every number in this file is either from a recorded fetch or computation (dated, with its source) or labelled *hypothesis* (INV-17). No paid API calls were made.
> **Inputs:** the public seeds only: all of William Gibson read, Kim Stanley Robinson liked, cooler on Neal Stephenson (`DELIVERY-PLAN.md` §1 #9, `REQUIREMENTS.md` Recommend row). Nothing from a ChatGPT export or SelfCo (OC9, INV-19).
> **Fits:** OC33; the U-3 taste tree (`docs/plan/docs/recommend/taste-tree-ux.md`), whose provisional node kinds this file confirms or changes (§9); the U-1 lenses and slabs (`docs/plan/docs/live/overlay-ux.md`); the U-3 002 dev-mode rows (`docs/plan/docs/live/chat-002-ux.md` §6).

**Evidence labels.** **verified**: the page or API response was read on 2026-11-02 and the quote or value is copied from it. **snippet**: seen only in a search result, a partial render or a summary. **hypothesis**: reasoned, not observed.

**Words used here.** *Facet*: one axis of taste (theme, topos, idea, …; §2). *Term*: one controlled value on a facet. *Centre of taste*: the reader's weighted terms per facet (§3). *Temperature*: a pick's distance from the centre (§4). *Ring*: a distance class shown on the tree map. *Sector*: a direction of travel away from the centre (Sideways, Farther). I avoid "band" for temperature: in this plan a band is an identity-confidence class (`verified` … `unknown`). These terms are proposed for `CONTEXT.md` (L-1, OC12).

## 0. Summary

1. **A book is described by terms on eight facets**: theme, topos, idea, question, style, pattern, form and author. Each term carries a weight, a source and an evidence kind (DERIVED from a catalog record, SYNTH from a model, ASSERTED by the owner). There are no co-reader, co-purchase, rating, award or best-of-list signals anywhere in it (OC33).
2. **The sources are complementary and thin on their own.** ISFDB tags are free (CC BY 4.0) and rich for some books but sparse for others: 38 tags on *The Ministry for the Future*, two on *Pattern Recognition*. Library of Congress subject headings deliberately leave most novels with little or no topical access. Publisher summaries, which LC records carry, are the best raw text for themes and topoi. A small model can turn them into controlled terms for well under a cent per book (*hypothesis*, §1.3).
3. **The centre of taste** is the weighted terms of the seed authors' works, per facet, with each term's support (which seeds back it). `cooler` adds nothing to the centre: we don't know *why* the owner is cooler on Stephenson, so the reason stays an open question with zero weight until it is answered (as the taste tree already rules).
4. **Temperature** is the pick's distance from the centre: on each facet, the share of the book's terms that do *not* sit on centre terms, averaged with fixed facet weights over the facets we know. Rings: centre ≤ 0.25, middle ≤ 0.55, outer above (the tree's TEMP_RING_EDGES). The default setting, **Middle**, picks from rings 0–1. **Sideways** and **Farther** are directions, not "more random": Sideways keeps the theme and lets style, form and pattern go far; Farther keeps only a topos, idea or question.
5. **A pick is explained by what it shares and where it departs**, naming the seeds that support each shared term and the evidence kind of each claim. Example: *MIDDLE · shares the city as a system (Gibson, Robinson) and climate, economics and institutions (Robinson) · Robinson: liked.*
6. **The tag-only baseline fails on the seeds** (§6.1, a recorded computation). It puts two Stephenson novels nearer the centre than a Robinson novel, because genre tags like *cyberpunk* and *nanotechnology* dominate. That is the main reason to separate facets and down-weight form.

## 1. Feature sources

### 1.1 Sources table

| Source | What it gives the taste model | Observed on the seed authors' books (2026-11-02) | Terms of use | Quote (≤15 words), URL, date | Label | Role |
|---|---|---|---|---|---|---|
| **ISFDB title tags** | Free-form, user-applied tags per title, each with a count; a mix of themes (*climate change*), ideas (*terraforming*), forms (*cyberpunk*), settings (*Lucknow*) and list/award tags | Uneven. *The Ministry for the Future* has 38 tags, *Termination Shock* 29, *Red Mars* 20. *Pattern Recognition* has 2 (*cyberpunk*, *science fiction*); *The Peripheral* has 4 (*science fiction*, *london*, *england*, *into-tv*) | CC BY 4.0 (site footer, verified on every page fetched); C-0 records the attribution text | "Current Tags: artificial intelligence (3), cyberpunk (3), virtual reality (2)" — https://www.isfdb.org/cgi-bin/title.cgi?1475 (Neuromancer), 2026-11-02 | verified | DERIVED evidence through a crosswalk (§2.4). Already staged by C-1 (`tags`, tag mapping) |
| **ISFDB author tags** | The same tags summed over an author's titles | Gibson: *cyberpunk* (22), *steampunk* (6), *artificial intelligence* (5)…; Robinson: *near future* (23), *mars* (22), *climate change* (16)…; Stephenson: *nanotechnology* (7), *near future* (7), *cyberpunk* (6)… | as above | (no second quote; values copied from https://www.isfdb.org/cgi-bin/ea.cgi?Kim_Stanley_Robinson and the Gibson and Stephenson pages, 2026-11-02) | verified | A cheap author-level prior when a title has few tags |
| **LC subject headings (LCSH), topical** | `[topic]--Fiction` headings on LC bibliographic records | *Neuromancer*: *Hackers*, *Business intelligence*, *Information superhighway*, *Conspiracies*, *Japan*. *Red Mars* (2021 record): *Space colonies*, *Mars (Planet)*. *Snow Crash* (2022 record): *Hackers*, *Computer viruses*, *Cyberpunk culture*, *Virtual reality*, *Mythology, Sumerian*. *Pattern Recognition*: *Business intelligence*, *Women private investigators*. **None** on *The Ministry for the Future* (2020) or *Termination Shock* (2021) | LC records: US federal work (licence: see C-R) | "Many works will have no topical heading." — LC *Subject Headings Manual* H 1790 (Literature: Fiction), https://www.loc.gov/aba/publications/FreeSHM/H1790.pdf, 2026-11-02 | verified | DERIVED, mostly the idea and topos facets. Policy-limited: H 1790 also tells catalogers to assign topics only where the author or publisher made them explicit, and normally one or two at most |
| **LC genre/form terms (LCGFT)** | Controlled genre/form terms with scope notes, e.g. *Cyberpunk fiction*, *Climate fiction*, *Dystopian fiction*, *Utopian fiction*, *Political fiction*, *Satirical fiction*, *Humorous fiction* | On records: *Red Mars* (2021) → *Science fiction*, *Novels*; *Snow Crash* (2022) → *Science fiction*, *Humorous fiction*. Older records carry the GSAFD equivalent (*Science fiction.*, *Humorous stories.*, *Mystery fiction.* for *Pattern Recognition*) | id.loc.gov vocabulary: see C-R | "Fiction that features climatic changes." — scope note of *Climate fiction* (gf2021026022), https://id.loc.gov/authorities/genreForms/suggest2?q=climate%20fiction, 2026-11-02 | verified | The form facet's controlled vocabulary. Low weight (§4.2) |
| **BISAC headings inside LC records** | Bookseller subject codes the publisher supplied | *New York 2140*: "FICTION / Science Fiction / Space Opera", "/ High Tech", "/ Adventure". *The Peripheral*: "/ General", "FICTION / Literary" | BISG licence for the code list: not checked here, see C-R | (values copied from the LC SRU record, URL in §1.2) | verified (presence); licence *hypothesis* | Weak form evidence only. *New York 2140* is not a space opera: marketing codes, not description |
| **Publisher descriptions** | One or two paragraphs naming the book's concerns: the best raw text for themes, topoi and questions | Present on the LC records for *The Ministry for the Future*, *Red Mars* (2021), *Snow Crash* (2022), *Termination Shock*, *New York 2140*, *The Peripheral*. Content varies: the *Ministry* summary names "climate change, technology, politics"; the *Termination Shock* summary names only the author's other books | Copyright the publisher's (*hypothesis*: treat as not redistributable). Use locally; store derived terms and a hash, never the text, in anything public | "-- Provided by publisher." — abstract of LC record 2020014375, SRU query in §1.2, 2026-11-02 | verified (presence); terms *hypothesis* | Input to LLM extraction (next row). Other carriers (Open Library, Google Books, bookseller feeds): see C-R |
| **LLM extraction from a description** | Terms on every facet, chosen from the controlled vocabulary, with a one-line justification each and a pointer to the sentence it came from | Not run (no paid calls) | Anthropic API under OC10's key and spend ceiling | "with a 50 percent discount" (Batch API) — https://platform.claude.com/docs/en/about-claude/pricing, 2026-11-02 | prices verified; output quality and cost per book *hypothesis* | SYNTH evidence. Never asserts taste; it describes books, and the tree's rules still apply |
| **LLM from title and author only** (no description) | The same, from the model's own knowledge of the book | Not run | as above | — | *hypothesis* | Last resort, lowest trust: unverifiable, prone to invention, and it may carry "readers also liked" associations. Dev mode shows it as `SYNTH · no source text`. Off by default |
| **Owner statements** | Seeds, taste-tree edits and answers, `prefer` ratings | Three seeds | Public by OC9 once the owner accepts them | — | ASSERTED | The only source that can assert taste |
| **Excluded on purpose** | ISFDB user ratings and votes ("User Rating: 8.19 (54 votes)" on *Neuromancer*), award and best-of-list tags (*1001 Books You Must Read Before You Die*, *SF: The 100 Best Novels 1949-1984*, *2-award-winner*), adaptation tags (*into-movie*) | Present on the pages fetched | — | — | verified | These are popularity and canon signals, which is collaborative filtering by another name. OC33 forbids them; the crosswalk drops them (§2.4) |

### 1.2 How the LC evidence was read

- **Records:** the LC catalog's SRU interface, MODS schema, one query per book, for example `http://lx2.loc.gov:210/lcdb?version=1.1&operation=searchRetrieve&query=bath.isbn%3D9780316300131&maximumRecords=3&recordSchema=mods` (*The Ministry for the Future*), read 2026-11-02. Other queries used `dc.title` and `dc.creator`. Only the first three records were read, so a later or fuller record for the same work may exist (for *Red Mars* and *Snow Crash* the 2021–22 records were much richer than the 1990s ones).
- **Vocabulary:** the id.loc.gov `suggest2` JSON endpoints for genreForms and subjects. The id.loc.gov web search page returned a bot-verification page in the browser, so it was not used (not bypassed).
- **Which backend serves these in production is C-R's call** (see C-R). This card needs only: a work-level subject and genre lookup, cached locally, at identify time or in a batch over the catalog.

### 1.3 LLM extraction: cost and provenance

**Prices** (verified 2026-11-02 on the pricing page above; Batch API rows, per million tokens): `claude-haiku-5-5` $0.05 input / $0.25 output (prompts up to 100,000 tokens); `claude-sonnet-5-5` $1 input / $5 output. Standard (non-batch) rates are double. OC10 already names these two models and leaves the choice to E-4.

**Per-book estimate — hypothesis.** Assumptions: about 1,900 input tokens per book (about 1,500 of instructions plus the controlled vocabulary, which prompt caching could make cheaper, about 250 of description, about 150 of catalog metadata and tags), and about 600 output tokens (about 300 of JSON terms and about 300 of thinking at low effort).

| Model (Batch API) | Per book (*hypothesis*) | Per 1,000 books | Per 10,000 books |
|---|---|---|---|
| `claude-haiku-5-5` | about $0.00025 | about $0.25 | about $2.50 |
| `claude-sonnet-5-5` | about $0.0049 | about $4.90 | about $49 |

The MVP needs terms only for (a) the seed authors' works, which build the centre, and (b) works identified on the fixture's shelves, so a few hundred books, not the whole ISFDB catalog. Spend counts against the OC10 ceiling and appears in the run summary.

**Provenance per extracted term:** `{facet, term_id, weight, evidence: SYNTH, source_kind: publisher-description | title-only, source_ref (LC record id or other, see C-R), source_hash (SHA-256 of the description text), span (character offsets of the supporting sentence), model, prompt_version, extracted_at}`. The text itself stays in the local catalog DB under `$BOOKCASE_DATA`, never in git.

**Guards (proposed for R-2's extraction step):**
- The output schema allows only vocabulary term ids, plus at most two `proposed` new terms per book. Proposed terms are never used for ranking until a vocabulary PR accepts them.
- There is no field for similar books, readers or popularity, and the instructions forbid comparisons with other books or readers.
- Each term must cite a span of the description; a term without a span is dropped. Title-only extraction has no span and is marked so.
- A **spot check before adoption**: 20 works, each extracted term marked right or wrong by a reviewer (an agent may draft, a person rules). The share of right terms is recorded and no target is set in advance (INV-17). This is E-4's question asked of extraction rather than adjudication.

## 2. Feature vocabulary

### 2.1 Facets

| Facet | What it captures | Test: a term belongs here if… | Seed-author examples (*hypothesis*: my reading, to be extracted and reviewed) | Typical sources |
|---|---|---|---|---|
| **theme** | The human concern the book is about | you could write an essay on it without mentioning the plot | *near futures built from real systems*; ↳ *networks, media and attention*; ↳ *climate, economics and institutions* | publisher description (LLM), ISFDB tags like *climate change*, *politics* |
| **topos** | A recurring place, situation or figure the literature returns to: a commonplace in the rhetorical sense | other books in other decades use it too, and it carries meaning of its own | *the city as a system*; *Mars, the frontier as a political project*; *cyberspace as a place*; *the generation ship* | LCSH (*Space colonies*), ISFDB (*underground city*, *generation ship*), LLM |
| **idea** | A specific speculative premise or mechanism | it is a "what if" or a gadget that the plot depends on | *uploaded personalities*, *terraforming*, *longevity treatment*, *geoengineering*, *a carbon-backed currency*, *a language virus* | ISFDB tags, LCSH (*Computer viruses*), LLM |
| **question** | What the book keeps asking, open-ended | it can be phrased as a question the book doesn't fully answer | *can institutions act in time?*; *what do networks do to a self?*; *should we leave Earth at all?* | LLM only (rarely explicit in catalogs) |
| **style** | How the prose works: register, tone, density, voice | it would survive a change of subject | *implication over exposition*; *documentary collage of many voices*; *technology explained in full*; *comic, satirical tone*; *first-person machine narrator* | LCGFT *Humorous fiction*, ISFDB *satire*, *first person point of view*; LLM |
| **pattern** | The shape of the story | it would survive a change of setting | *ensemble and institutions over a lone hero*; *braided multi-strand plot*; *the heist*; *the long-duration chronicle* | LLM, rarely tags |
| **form** | Genre and form labels | a catalog or bookshop would shelve by it | *cyberpunk fiction*, *climate fiction*, *political fiction*, *utopian fiction*, *humorous fiction*, *mystery fiction* | LCGFT (controlled), ISFDB genre tags, BISAC (weak) |
| **author** | Who wrote it | — | Gibson, Robinson, Stephenson | catalog |

**Not facets.** *Setting* (places and dates: *Lucknow*, *Zurich*, *Twenty-second century*) is kept as metadata and shown in dev mode, but carries no weight, because places in tag lists mostly add noise (§6.1). A place becomes a topos only when it carries meaning (*the drowned city*). *Audience* and *length* are post-MVP qualifiers ("More like this, but shorter").

### 2.2 Terms

- **Id and label:** `facet:slug` (`theme:climate-institutions`), a short label in the reader's language, optional aliases. Labels follow the tree's language rules: short and plain, no "you love".
- **Hierarchy:** one optional parent per term, on the same facet (`theme:climate-institutions` → `theme:near-futures-real-systems`). This matches the tree's theme → sub-theme, and TREE_DEPTH 3 caps it.
- **Weight per book:** 0–1. It means salience in this book, not quality.
- **Size:** about 60–120 terms is enough for one SF bookcase (*hypothesis*). Growth goes by PR, from the `proposed` queue.
- **Location (proposal):** `src/recommend/vocabulary.json`, public. It holds our own terms and the crosswalk, so it is configuration, not data.

### 2.3 The reader side

Each taste-tree node is one profile entry on a facet: `{kind (facet), term_id, stance: pull | push, status: hypothesis | asserted | rejected | open, support: [seed ids], evidence: SYNTH | ASSERTED, qualifiers[], provenance}`. Status changes come only from the tree's ASSERTED events (`taste_asserted`, `taste_rejected`, `taste_answered`, …).

**Node weights in the centre** (starting values for O-7, all configuration): asserted pull 1.0; hypothesis pull 0.5; rejected → push −1.0 on that term; open question 0 (tree rule); pruned 0.

### 2.4 Crosswalk (catalog value → term)

`src/recommend/vocabulary.json` maps ISFDB tags, LCSH headings and LCGFT terms to term ids, case-folded. For example: ISFDB *climate change*, *cli-fi*, *climate fiction* and LCGFT *Climate fiction* → `form:climate-fiction` plus `theme:climate-institutions` at 0.5. ISFDB *terraforming* → `idea:terraforming`. LCSH *Space colonies--Fiction* → `topos:frontier-political-project` at 0.5.

- Unmapped values are kept and listed in dev mode as `unmapped`, with no weight.
- A **drop list** removes popularity and canon signals: any tag matching `^(\d+-award|1001 books|abebooks|sf: the 100|into-)`, plus ratings and votes.
- Generic values (*science fiction*, *Fiction*, *Novels*) are dropped too, because they separate nothing on an SF bookcase.
- The ISFDB tag count becomes the weight, `min(1, count / 3)`, so a single tagger counts as a third of a strong signal.

## 3. Centre of taste

**From seeds to works.** Each seed expands to works in the catalog (R-1 already does this for "read all of Gibson"). Seed weights `w_s`, starting values:

| Seed relation | w_s | Why |
|---|---|---|
| `liked` (author) | 1.0 | An owner statement of liking |
| `read`, scope all-works | 0.6 | Reading every book by an author is strong evidence of interest, but INV-18 keeps *read* and *liked* apart. **The owner confirms at O-4** whether "read all of Gibson" also means liked |
| `read`, one work | 0.3 | |
| `cooler` | **0** to the centre | We don't know why. The reason is the tree's open question (zero weight until answered). The author still gets a score penalty (§5) |
| `not-for-me` | 0 to the centre; push on the terms the owner names | |

**Centre terms.** For each facet *f* and term *t*: `c_t = Σ_s w_s · mean over s's works of b_t / Σ_s w_s`, over the seeds with `w_s > 0`, where `b_t` is the term's weight in a work. Averaging within a seed first means an author with 20 books counts no more than one with 5. Tree nodes then add or subtract (§2.3). **Support** of *t* is the set of seeds with a mean `b_t` ≥ 0.2.

**Core and single-seed terms.** A term with support ≥ CENTRE_SUPPORT (2, as in the tree) is a **core** term. With three seeds and one at weight 0, a core term today must be backed by both Gibson and Robinson. A single-seed term is **weak** and can never on its own put a pick in the centre ring (tree §6).

**Leave-one-out.** When the work being scored is one that built the centre (a Robinson novel), its own contribution is removed before measuring distance. Otherwise every seed author's book looks closer than it is.

## 4. Temperature

### 4.1 Definition

For a candidate work with terms `b_t` on facet *f*:

- `sim_f = Σ_t b_t · m_t / Σ_t b_t`, where `m_t = c_t` if *t* is a centre term, `0.5 · c_t′` if *t*'s parent or child *t′* is a centre term, and 0 otherwise. This is the share of the book's weight on this facet that lands on your centre. It doesn't penalise a book for covering only part of a broad centre.
- `d_f = 1 − sim_f`.
- **Author facet:** `d_author` = 0 for a liked author, 0.4 for a read-all author, and 1 for everyone else, cooler authors included. (Cooler is a score penalty, not distance: "unlike your centre" and "you said cooler" are different statements.)
- **Unknown is not far.** A facet with no terms for the book is left out, and the facet weights are renormalised over the known facets. A book with fewer than two known facets, or with neither theme nor topos known, is **unplaced**: it is not recommended by taste and stays visible with "not enough known about this book" (INV-9's spirit).
- **Temperature** `D = Σ_f α_f · d_f / Σ_known α_f`.

**Facet weights α** (starting values for O-7, tunable in dev mode): theme 0.25, topos 0.20, idea 0.15, author 0.15, style 0.10, question 0.05, pattern 0.05, form 0.05. Form is low on purpose (§6.1). Question and pattern are low because only extraction fills them.

### 4.2 Rings and settings

| Ring | Rule | Tree / overlay rendering |
|---|---|---|
| 0 · centre | D ≤ 0.25 **and** at least one shared core term | centre ring; slab "fit" |
| 1 · middle | D ≤ 0.55, or D ≤ 0.25 without a shared core term | middle ring; slab "fit" |
| 2 · outer | D > 0.55, in a sector | outer ring; slab "stretch" (dashed, the word STRETCH) |

**Sectors** say *which way* an outer pick departs. They are orthogonal moves, not a bigger radius:
- **Sideways** keeps the concern and changes the telling: `d_theme ≤ 0.4` and the mean of `d_style`, `d_form` and `d_pattern` ≥ 0.6.
- **Farther** keeps a commonplace and leaves the concern: at least one shared topos, idea or question term with `m_t ≥ 0.3`, and `d_theme > 0.55`. Whether Farther may leave fiction is the tree's open question 8.
- An outer work in neither sector is just far. It is never picked by taste.

**Settings** (the tree's TempControl):
- **Centre**: ring 0 only.
- **Middle** (default): rings 0–1.
- **Sideways** or **Farther** (toggles): rings 0–1, plus at most TEMP_OUTER_SHARE (1 of k) from that sector.

Identity confidence is a separate setting: no pick below `probable` reaches an end user at any temperature, and the identity band is never multiplied into the score.

**In two lines:** temperature is a pick's distance from the centre of your taste: per facet, the share of the book that misses your centre's terms, averaged with fixed facet weights over the facets we know (centre ≤ 0.25, middle ≤ 0.55). Sideways and Farther are directions, not noise: Sideways holds the theme while style and form go far; Farther holds only a topos, idea or question.

## 5. Scoring and explanation

**Score within the allowed rings** (R-2): `score = (1 − D) − P_cooler − P_push + ε_novelty`.
- `P_cooler` = 0.15 for a cooler author (*hypothesis*): lowered, not excluded, as R-2 already says.
- `P_push` = 0.5 × the matched weight of rejected terms.
- `ε_novelty` is a small tie-break for works that are not in the profile.
- `read` works are marked "you've read this" and never recommended.
- Unidentified spines sit in "not yet identified" and never get zero relevance (INV-9).

Ranking compares scores within a setting; ring and sector come from D and the sector rules alone.

**Explanation template** (templated, no LLM at ranking time):

`{RING or SECTOR} · shares {up to 2 shared terms, core terms first, each with its support} · {departure: the facet with the largest d_f, in words, for outer picks} · {author relation if any} · {evidence badges}`

- Every shared term names its support (Gibson, Robinson) and its evidence (DERIVED tag, SYNTH extraction, ASSERTED by you).
- For hypothesis nodes the wording says "may" (tree §6). No passage longer than WHY_MAX_WORDS, and never "readers who liked…".
- A weak single-seed term says so: "(one seed)".
- A move between rings is a card revision with was / now / why (INV-21), batched on glass (INV-24).

## 6. Worked examples (public seeds only)

### 6.1 The tag-only baseline (recorded computation)

Before the model, the plain approach the plan's R-2 sketched ("ISFDB tag overlap with liked works") was checked on the tags fetched on 2026-11-02. **Method:** each work is a vector of its ISFDB tag counts, minus the drop list and *science fiction*. The centre is 0.6 × the normalised Gibson author-tag vector plus 1.0 × the normalised Robinson one, so Stephenson contributes 0. Distance is 1 − cosine similarity.

| Work (author, seed relation) | Non-dropped tags | 1 − cos to the centre | Shared tags |
|---|---|---|---|
| *Red Mars* (Robinson, liked) | 17 | 0.43 | near future, mars, terraforming, hard sf, politics, colonization, space elevator, … |
| *Pattern Recognition* (Gibson, read) | 1 | 0.58 | cyberpunk |
| *The Diamond Age* (Stephenson, cooler) | 13 | 0.58 | near future, cyberpunk, hard sf, steampunk, artificial intelligence, nanotechnology |
| *Snow Crash* (Stephenson, cooler) | 4 | 0.59 | cyberpunk, virtual reality, nanotechnology |
| *Termination Shock* (Stephenson, cooler) | 28 | 0.72 | near future, climate change, politics |
| *Aurora* (Robinson, liked) | 9 | 0.88 | terraforming, colonization, artificial intelligence |
| *Anathem* (Stephenson, cooler) | 11 | 1.00 | — |

**What it shows:**
1. Genre tags (*cyberpunk*, *steampunk*, *nanotechnology*) carry two Stephenson novels nearer the centre than a Robinson novel.
2. *Pattern Recognition* is "near" on one tag that misdescribes it: LC files it as *Mystery fiction*, with *Business intelligence* as its topic.
3. Place tags dilute *Termination Shock*, which shares the centre's main concern (climate, institutions).

Tag overlap measures how a book is shelved, not what animates it. Hence the facets, the low form weight and the drop list.

### 6.2 Gibson: read, all works

**Seed:** `read`, scope all-works, w = 0.6, pending O-4. **Evidence for *Pattern Recognition*:**
- ISFDB tags: *cyberpunk* (1) and *science fiction* (1) only (DERIVED).
- LCSH: *Business intelligence--Fiction*, *Women private investigators--England--London--Fiction* (DERIVED → `idea:corporate-intelligence`, `pattern:investigation`).
- GSAFD form: *Mystery fiction* (→ `form:mystery-fiction`).
- No publisher summary in the record read, so LLM extraction needs another description carrier (see C-R).

**What Gibson contributes to the centre** (*hypothesis*, as the tree proposes):
- `theme:networks-media-attention` (weak, one seed).
- Core with Robinson: `theme:near-futures-real-systems` and `topos:city-as-system`.
- `idea:uploaded-personalities` and `idea:artificial-intelligence`, which ISFDB author tags corroborate.
- `style:implication-over-exposition` (weak).

**On a shelf:** every Gibson novel is `read`, so none is ever a pick. Under the Read lens its slab shows "R · READ (all of Gibson)". Under Recommended it is not highlighted.

**Dev mode** shows its terms with sources, plus a note that this seed counts at 0.6 until O-4 says whether *read all* means *liked*.

### 6.3 Robinson: liked; one book in the middle, one farther out

**Seed:** `liked`, author scope, w = 1.0. Titles are "author liked, title not rated". The numbers below are **illustrative (*hypothesis*)**: hand-assigned terms on the §4 formula, centre weights `c` = 1.0 for core terms, 0.625 for Robinson-only terms, 0.375 for Gibson-only terms, with leave-one-out not applied.

**New York 2140.** Evidence: ISFDB *climate change*, *sea level rise*, *flood*, *New York City*, *economics*, *finance*, *social criticism*; LCSH *Twenty-second century*, *New York (State)* (setting, no weight); BISAC "Space Opera" (ignored by weight).

| Facet | Terms (weight) | d_f |
|---|---|---|
| theme | near-futures-real-systems (1), climate-institutions (1) | 0.19 |
| topos | city-as-system (1), drowned-city (0.6, child of city-as-system) | 0.19 |
| idea | sea-level-rise (1), financial-regulation (0.6) | 0.61 |
| question | can-institutions-act-in-time (1) | 0.38 |
| style | documentary-collage (1) | 0.38 |
| pattern | ensemble-institutions (1) | 0.38 |
| form | climate-fiction (1) | 0.38 |
| author | Robinson, liked | 0 |

D ≈ **0.27** → **ring 1, middle** (two core terms shared, but just above 0.25). Card: *MIDDLE · shares the city as a system (Gibson, Robinson) and climate, economics and institutions (Robinson, one seed) · Robinson: liked · terms: DERIVED tags + SYNTH extraction.*

**Aurora.** Evidence: ISFDB *interstellar travel* (2), *generation ship*, *Tau Ceti*, *artificial intelligence*, *colonization*, *first person point of view*, *terraforming*. Hypothesis terms:
- theme: limits of expansion (d = 1.0);
- topos: generation ship, plus frontier as political project at 0.6 (related to `topos:mars-frontier`) (d ≈ 0.88);
- idea: terraforming, AI at 0.5 (d ≈ 0.46);
- question: should we leave Earth at all? (d = 1);
- style: first-person machine narrator (d = 1);
- pattern: the voyage, ensemble at 0.5 (d ≈ 0.79);
- author: liked (0).

D ≈ **0.72** → **outer, Farther sector** (it keeps `idea:terraforming`; the theme departs). At the default Middle it is not a Recommended pick; with Farther on it can take the one outer slot: *FARTHER · shares terraforming (Robinson) · departs on theme: whether to leave Earth at all · Robinson: liked.*

The same liked author lands in two rings. That is the point of OC33: temperature is about ideas, not who wrote it. Whether a liked author's book should still appear at the default setting is an open question (§10, item 2).

### 6.4 Stephenson: cooler

**Seed:** `cooler`, author scope. It adds nothing to the centre. Score penalty 0.15. The tree's open question "What cools Neal Stephenson for you?" carries no weight.

**Termination Shock.** Evidence: ISFDB *geoengineering* (2), *climate change* (2), *near future* (2), *sea level rise*, *disinformation*, *billionaire*, … (DERIVED). The LC record has no topical headings, and its summary names only other books, so extraction has little to work from (*hypothesis*: title-only extraction would be needed, flagged as such). Illustrative terms:
- theme: near-futures-real-systems, climate-institutions (d ≈ 0.19);
- topos: the billionaire's private project (d = 1);
- idea: geoengineering, sea-level-rise at 0.6 (d ≈ 0.38);
- question: who gets to fix the climate? (related to can-institutions-act-in-time, d ≈ 0.69);
- style: technology explained in full (d = 1);
- pattern: braided multi-strand plot (d = 1);
- form: climate fiction, thriller (d ≈ 0.69);
- author: Stephenson, cooler (1).

D ≈ **0.67** → **outer, Sideways sector** (it keeps the theme; style, pattern and form depart). It is not picked at Middle. With Sideways on it is a candidate, ranked lower by the cooler penalty: *SIDEWAYS · same concern as climate, economics and institutions (Robinson) · told differently: technology explained in full, a thriller · you're cooler on Stephenson, so shown lower.*

When its spine is in view, it is also the natural moment for the tree's scan opening to ask the Stephenson question (tree open question 7).

**Snow Crash, as evidence for a hypothesis.** LCGFT *Humorous fiction* and ISFDB *satire* are DERIVED support for one of the tree's three offered reasons ("comic, satirical tone"). Dev mode shows that support under the open question. It still carries no weight: only the owner's answer turns the question into a push on `style:comic-satirical`.

## 7. Dev mode

Dev mode is the owner's view (OC33; U-1 §10 ruling 6). It is private, never exported (tree §9 never-export list), and off by default. Per pick and per spine:

1. **Identity:** band, candidates and evidence (as in 002's dev-mode row); a reminder that temperature never touches it.
2. **Facet table:** for each facet, the book's terms with weight, source (ISFDB tag / LCSH / LCGFT / BISAC / extraction / title-only), evidence kind, source ref and hash, and for SYNTH the model, prompt version and the cited span. Unmapped and dropped values are listed, greyed, with the reason dropped (popularity, generic, unmapped).
3. **Distance:** `sim_f`, `d_f` and `m_t` per term; which centre term each match hit and its support; known vs unknown facets; D; ring; sector test results (which conditions passed or failed); leave-one-out on or off.
4. **Score:** `1 − D`, each penalty and novelty, final score, rank, the rank at other temperature settings, and why a book was *not* picked (ring, sector, read, cooler, unplaced, identity below `probable`).
5. **Centre inspector:** every centre term with `c_t`, support and core/weak status; seed weights; open questions and the DERIVED evidence attached to each hypothesis option; the leave-one-out effect.
6. **Live-tunable parameters:** α per facet, TEMP_RING_EDGES, the sector thresholds (0.4, 0.6, 0.55, 0.3), w_s per relation, node weights, P_cooler, the push factor, the hierarchy credit (0.5), the tag-count divisor (3), TEMP_OUTER_SHARE. Every change is logged with its value, so a run records the parameters it used.
7. **Extraction ledger:** per book, extracted or not, cost, model, cache hits, running spend against the OC10 ceiling.
8. **Conflicts:** where sources disagree on form (*Pattern Recognition*: ISFDB *cyberpunk* vs LC *Mystery fiction*), both are shown with sources and nothing is resolved silently.

## 8. Changes proposed for R-1 and R-2, and what stays post-MVP

### R-1 (profile and seeds)
- **Add taste nodes** to the profile model (§2.3), with the tree's evidence kinds and statuses. Hypothesis nodes stay out of `profile/seeds.json` until the owner accepts each one (tree §8). Whether accepted hypotheses go public at all is tree open question 4.
- **Add seed scope and weight:** Gibson `read` with `scope: all-works` and a configurable `w_read_all` (0.6). Add a line to the O-4 review sheet: "Does *read all of Gibson* also mean *liked*?"
- **Add `src/recommend/vocabulary.json`** with the facets, terms, hierarchy, crosswalk and drop list (§2.2, §2.4), and its JSON Schema in `contracts/` (OC13).
- **Tests:** an open question has zero weight; a cooler seed adds nothing to the centre; no node's support includes anything but seed ids or the owner's ASSERTED events.

### R-2 (ranking with rationale and location)
- **Work features step:** a `work_features` table in the local catalog DB with the §1.3 provenance fields. Fill it from (1) the ISFDB tags already staged, through the crosswalk; (2) LC subjects and genre for identified works, if C-R adopts an LC lookup (see C-R); (3) extraction from a description, Batch API, for the seed authors' works and the fixture's identified works only, under the OC10 ceiling and after the 20-work spot check.
- **Replace** "ISFDB tag overlap with liked works" and "liked author" with D over facets (author is now a facet). Keep the cooler penalty, the read exclusion and novelty. **Replace** the 1-in-5 serendipity share with the temperature setting (§4.2).
- **Rationale templates** from §5. The report shows ring, sector and evidence badges. W-2 adds a private dev-mode section to the local report (§7).
- **Tests:**
  - the identity band is never in the score;
  - unknown facets don't add distance;
  - leave-one-out applies;
  - at Middle every pick is in rings 0–1;
  - Sideways/Farther add at most TEMP_OUTER_SHARE outer picks, and each says its sector and shared term;
  - a single-seed term alone never yields ring 0;
  - no feature source carries ratings, votes, award or list tags (a structural test on the drop list and the source enum).
- **Size:** this adds the extraction step to an M card at budget 50. I'd split it as **R-2a · Work features** (S: crosswalk, extraction, spot check; entry C-3, R-0 ruled) and **R-2b · Ranking** (the rest of R-2). That is the conductor's call.

### Other cards
- **U-1 / T-4 / T-5 / T-7b:** slab "fit" = rings 0–1 and "stretch" = a Sideways or Farther pick. The Stretch lens (k 3) shows the active sector's picks. Card reasons use the §5 template.
- **U-3 (006):** see §9.
- **E-4** gains a second question: does extraction earn its cost compared with tags + LC alone? Measure it with the spot check and with O-5's "judged useful" count, split by evidence kind.

### Post-MVP
- Extraction over the whole catalog.
- Learning α and the ring edges from O-5 and `prefer` events (still owner-only signals, never co-reader).
- Description embeddings as a second distance. Deferred because they can't explain a pick in facet terms, which OC33 asks for.
- Farther outside fiction (tree open question 8).
- `inferred-interest` nodes from the private ChatGPT overlay (OC22, backlog #5): private, hypothesis only, never in the public tree.
- Qualifiers as filters (shorter, more hopeful).
- Audience and length facets.

## 9. Taste tree (U-3 · 006) alignment

This section is the home the U-3 card names for 006 in this file. The design itself stays in `docs/plan/docs/recommend/taste-tree-ux.md`.

- **Node kinds** (tree open question 1). Adopt *theme*, *subtheme* (a theme with a parent), *topos*, *style*, *pattern* and *idea* as they are. **Change one:** the tree uses kind `question` for questions about the reader ("What cools Neal Stephenson for you?"), while OC33's *questions* are what a book asks. I propose kind `question` for book-side terms and `open-question` for reader-side unknowns, so the export can't confuse them. *Form* and *author* are not tree branches: authors are the trunk (seeds), and form shows up only as a qualifier or in dev mode.
- **Rings:** the tree's rings are §4.2's rings over D, with the same edges (0.25 / 0.55). The tree's ring for a *node* is its support (core → ring 0, single seed → ring 1). §4's ring for a *pick* is its distance. Both rules hold together: a pick reaches ring 0 only through a core node.
- **Sideways and Farther:** §4.2 makes the tree's sector wording testable (which facet is held, which departs).
- **Export:** the export carries terms by `term_id` plus label, so other agents can join them to `vocabulary.json`. It carries no D values or parameters (dev mode only, tree §9).

## 10. Risks and open questions

1. **Thin evidence on recent or popular-press books.** *Termination Shock* has no LC topics and a summary with no content. Mitigation: author-tag prior, title-only extraction flagged as SYNTH with no source, the unplaced state.
2. **A liked author's book can fall outside the default rings** (*Aurora*). Options: leave it (temperature is about ideas), or let liked-author books into Middle up to D ≤ 0.75. I recommend leaving it and letting the All lens show "AUTHOR LIKED". Owner's call at O-5.
3. **Three seeds give a centre with two core terms.** Every branch is a hypothesis until the owner asserts it. The model is only as good as the first tree session and O-4.
4. **Extraction drift:** a model may invent themes. Mitigation: span citation, vocabulary-only output, the spot check, dev mode.
5. **Licences** of LC records, BISAC and description carriers are C-R's and C-0's to confirm. This file assumes local use only and derived terms in public.

## Sources

All read on 2026-11-02.
- ISFDB title pages: *Neuromancer* (`title.cgi?1475`), *Red Mars* (`?1330`), *The Ministry for the Future* (`?2772326`), *Snow Crash* (`?1182`), *Cryptonomicon* (`?19870`), *The Diamond Age* (`?1181`), *Anathem* (`?866747`), *Termination Shock* (`?2933385`), *Pattern Recognition* (`?23596`), *The Peripheral* (`?1765761`), *Idoru* (`?5717`), *New York 2140* (`?2131688`), *Aurora* (`?1862882`).
- ISFDB author pages: `ea.cgi?William_Gibson`, `ea.cgi?Kim_Stanley_Robinson`, `ea.cgi?Neal_Stephenson`.
- ISFDB data are CC BY 4.0, per the site footer.
- Library of Congress SRU (`lx2.loc.gov:210/lcdb`, MODS) records for the works above; LC *Subject Headings Manual* H 1790; id.loc.gov `suggest2` for LCGFT (*Cyberpunk fiction* gf2014026275, *Climate fiction* gf2021026022, *Dystopian fiction* gf2014026302, *Utopian fiction* gf2014026583, *Political fiction* gf2014026482, *Satirical fiction* gf2023026105) and for LCSH.
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing (Batch rows for Haiku 5.5 and Sonnet 5.5).
- Plan: `REQUIREMENTS.md` OC9, OC10, OC13, OC22, OC33, INV-9, INV-13, INV-17–INV-19, INV-21, INV-24; `DELIVERY-PLAN.md` R-0, R-1, R-2, U-3, E-4; the three design docs named at the top.

## Ruling

**Recommendation, as one question for the owner:** *Adopt this facet model for R-1/R-2 (centre from seeds, temperature as facet distance with Sideways/Farther, no popularity signals), including Haiku batch theme extraction from publisher summaries in the MVP (about $0.25 per 1,000 books, hypothesis)?*

Two smaller questions ride along, for O-4 and O-5: does *read all of Gibson* also mean *liked*? Should a liked author's far-out book appear at the default setting?
