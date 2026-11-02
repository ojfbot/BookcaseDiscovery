# Curriculum map — BookcaseDiscovery × Newline AI Accelerator

Planning output, 2026-10-31 (Opus 5.5 draft; **checked row by row against the vault pages by the Fable 5.1 pass** the same evening: three unsupported rows removed or downgraded, one mini-project mis-attribution fixed, §1b added). This map traces each segment and card of `DELIVERY-PLAN.md` to Newline Accelerator material (17 units, the Harness Engineering course, and 9 mini-projects), so the build can double as lecture, workshop and mini-project content. It also names the community touchpoint for each segment.

**Owner rulings (OC16, reconfirmed in the Fable grill).** For now the review vector is the Newline community only, with no named reviewers. Every post or contact is the owner's action; agents draft and never post.

## Provenance and limits (read first)

- **Sources.** Mapped from the vault pages only:
  - `wiki/entities/newline-ai-accelerator.md`;
  - `wiki/sources/newline-curriculum-ingestion-2026-08.md`;
  - the two prep synthesis pages.
- **Notes repo not read.** The fuller per-unit notes live in the local-only `newline-ai-course/notes/` repo, which is **not on Yojimbo**. Its vault entity page says the repo deliberately has no remote; it is probably on Yuri. Logged as a deviation.
- **Confidence per row:**
  - **read**: the vault source page describes the content.
  - **title**: the unit is known only by title or a one-line summary. Check it against `notes/` before using it for teaching.
  - **inferred**: reasoned from indirect evidence.
- **Licensed material.** Newline material is licensed. This map cites units by name and paraphrases them; it never reproduces their content. Anything adapted for teaching is the owner's call under their course terms.

## 1. Segment → Newline map

| Segment / cards | Newline material | What the card borrows | What the build gives back (lecture / workshop / mini-project angle) | Confidence |
|---|---|---|---|---|
| **S0** Z-0, Z-1, Z-2; OPERATING-MODEL | **Harness Engineering**: harness = CLI tools + Markdown files + context management + checkpointing, with Claude Code as the reference | Its vocabulary for the conductor and card model: cards as Markdown contracts, `CONDUCTOR-LOG.md` as checkpointing, card briefs as context management | A worked multi-session harness: an Opus conductor dispatching Sonnet and Haiku cards, each ending in a PR. Workshop: "run a delivery plan as a harness" | read |
| **S0** Z-1 privacy guard | **U15 production** (title); **U14 M5** (Cursor's client-side embedding and hashing, so the server never holds plaintext) | Privacy as an engineered boundary, not a policy | A public-repo leak guard with planted-leak tests. Mini-project angle: "build in public without leaking private data" | title / read |
| **S1** L-1, L-2 contracts and ledger | **U8 document processing and ETL**: validation is its own stage, with escalating mechanisms (schema → rules → Pydantic → judge) | Validation as a stage: Zod checked against JSON Schema at every ledger write | An append-only event ledger with replay, as the ETL "load" stage done reproducibly | read |
| **S1** K-1 validator; **S4** K-2 originals check | **U8**: the canonical chain (source → OCR+parse → intermediate representation → extraction → validation → load) | Reject bad inputs before anything reads them | The photo-ingest version of U8's chain. U8 has no parser-quality evaluation; K-2 is a provenance check that U8 doesn't cover | read |
| **S1** V-1a/V-1b labelling tool, V-2 scorer; **S4** O-3, V-3 | **U5 synthetic data and evals** (analyse → measure → improve; binary pass/fail before scales); **U1 M6** ("never look at LLM-as-judge results before labelling it yourself") | Human labels first, binary metrics first. No detector prefill on the first fixture (OC8) is the same anchoring guard | A labelled real-world fixture plus a scorer, the "measure" step done before any model choice. Workshop: label 20 spines, then score two detectors | read |
| **S2** C-1 to C-3 catalog | **U9 RAG**: pre-retrieval / retrieval / post-retrieval phases; MRR vs faithfulness fail independently (U9 M3, U14 M3) | Pre-retrieval = fragment normalization and reversed reading; retrieval = FTS5 trigram; post-retrieval = joint assignment and adjudication | A fragment-matching retriever over noisy OCR. The **U14 M3 caution** applies directly: C-3's golden set is generated from the catalog it searches, so its top-5 is inflated, and the real fixture is the honest test | read |
| **S2** R-1 profile | Brief invariant INV-18 only. *(The Opus draft cited U9 "retrieval over user context"; neither vault page says that, so the citation is removed.)* | Provenance per entry | Separating read, liked, inferred and unknown, plus the public/private overlay split. A small, teachable data-model lesson | — |
| **S3** P-1 OCR helper, P-2 (P-3 conditional) detectors | **U8 document-processor tour** (three generations: self-hosted Donut/LayoutLM/Nougat, parsing APIs, DocETL; Markdown as the intermediate representation) for P-1 and E-3; **U6 foundational** (CLIP-style joint spaces); **U14 M6** ("data collection is the hardest step"; its LoRA hyperparameter heuristic is folklore, per U12 M4) | Proxy datasets labelled PROXY; OCR-vs-VLM framed as U8's tool generations | A library-shelf → bookstore transfer study (E2). The fixture is a scraped-to-labelled dataset of exactly the kind U14 M6 describes | read |
| **S5** E-1 to E-3 | **U5** (measure before improving); **U14 M13** (symbolic checks over free generation) | Pre-registered decision rule G-P; invented-text rate as a metric | E1, "pixels vs inference": a clean, falsifiable experiment for a lecture. E3 adds VLM vs classic OCR on rotated text | read |
| **S6** I-1 to I-3 | **U9** post-retrieval; **U14 M13** ("an empty result returns 'no data', never a guess") | An explicit `unknown` for every observation (INV-5); evidence bands rather than invented probabilities | Joint assignment that allows copies. A worked example where the textbook one-to-one assignment is wrong for the domain (ADR §3) | read |
| **S6** I-4 adjudicator, E-4 | **U13 agents**: perceive → plan → act with explicit stop rules; the autonomy ladder; token economics (agents ≈4× chat tokens, multi-agent ≈15×). **U14 M13**: small models hallucinate *more* with tools; Gusto's log-prob-threshold escalation; "a claim must carry a citation or be blanked out" (the INV-5 `unknown` rule). **U14 M5**: a cheap gate before the model call (Copilot's logistic filter) is the shape of "only ambiguous spines are sent". **MP1**: a judge is calibrated to human labels (≥80 % agreement) before any generator change | A bounded adjudicator (one call, a constrained answer) instead of a loop; budget → `paused` as the stop rule; E-4's Haiku-vs-Sonnet arm tests the M13 finding | **E4, "does the agent earn its cost?"**, is the strongest mini-project candidate: a pipeline vs bounded LLM vs loop ablation with tokens and wrong-but-confident rates. MP1's two-phase gate maps onto G-E4: the adjudicator is enabled only after it agrees with the owner's labels | read |
| **S6** E-5 the wall | **U5** (judge calibration); **U14 M13** (verification) | Measure "plausible but wrong" directly | "Does personal context make an identifier more wrong?" A short, provocative workshop on the circular-evidence failure | read |
| **S6** I-5 scheduler; OC10 budget | **U15 production** (title); **U13** token economics | Spend caps, cache keys and `paused` semantics | Cost controls as a ledger state rather than a dashboard | title |
| **S7** R-2, R-3, W-2 | **MP8 Jira Assistant** (acceptance tracking: suggestions scored against explicit numeric bars; its retrieval bars — top-5 >80 %, hybrid +>15 % — also apply to C-3). *(The Opus draft cited U4 for "templated rationales" and MP9 for acceptance bars; U4's content is not in the vault pages and the bars are MP8's, so both are removed.)* | Track recommendation outcomes as `prefer` events | "Recommendations judged useful" as an acceptance metric, in MP8's shape | read |
| **S8** M-1, D-1 | **MP8** (a repeatable engagement skeleton: numeric success bars, six required charts, six-step eval, phased build). **MP9 DevOps Assistant** only for its approval-gated funnel, which is the "agents draft, owner posts" shape of OC16 | An MVP run record with numeric bars | A capstone write-up in the mini-project format | read |
| Post-MVP visual memory | **U12 finetuning** (embedding fine-tuning; multimodal) | — | Embeddings trained on confirmed spine crops | read |
| Post-MVP E6 chat tools | **U15 production** (title). *(The Opus draft also cited "MCP material"; MCP is not mentioned in either vault page, so it is removed.)* | — | Read-only MCP tools behind a tunnel | title |

**Mini-projects not mapped.** MP2–MP7 are not mapped by title: the vault pages name only MP1, MP8 and MP9, and the notes repo (`newline-ai-course/notes/`) is not on this Mac. One corrected hint: `wiki/synthesis/appliance-research-workloads.md` says **MP3** required OpenAI embeddings plus FAISS and **MP4** allowed local retrieval components, so MP3/MP4 (not MP2) are the retrieval-shaped candidates for C-3. Map them from `notes/` when that repo is reachable. Every row above carries only what the two vault pages state; nothing is quoted from Newline material.

### 1b. Card → Newline unit (the line the conductor pastes into each card brief; OPERATING-MODEL §4)

| Card | Newline unit line |
|---|---|
| Z-0, Z-2, conductor | Harness Engineering — harness = CLI tools + Markdown + context management + checkpointing |
| Z-1 | U14 M5 — privacy as an engineered boundary (client-side hashing); U15 (title only) |
| L-1, L-2 | U8 — validation as its own ETL stage; the load stage done reproducibly |
| K-0, K-1, K-2, K-3 | U8 — the canonical chain source → parse → IR → extraction → validation → load; K-2 is a provenance check U8 lacks |
| V-1a / V-1b, V-2, V-3, V-4 | U5 — analyse → measure → improve; binary pass/fail before scales. U1 M6 — label yourself before reading any judge |
| C-0 | — (licence reading; no unit) |
| C-1, C-3 | U9 — pre-retrieval / retrieval / post-retrieval; U14 M3 — corpus-generated eval inflation; MP8 — retrieval bars (top-5 >80 %) |
| R-1 | INV-18 only (no supported unit) |
| P-1 | U8 — document-processor tool generations (OCR vs parsing APIs vs VLM) |
| P-2, P-3 | U14 M6 — data collection is the hardest step; U6 — joint embedding spaces |
| P-4 | U8 — the chain, end to end on one image |
| E-1 | U5 — measure before improving; U14 M13 — symbolic checks over free generation |
| E-2, E-3 | U5; U14 M13 — invented-text rate as a verification metric |
| I-1, I-2, I-3 | U9 — post-retrieval; U14 M13 — "an empty result returns 'no data', never a guess" |
| I-4 | U13 — bounded agent with stop rules; U14 M5 — a cheap gate before the model call; U14 M13 — log-prob escalation, citation-or-blank |
| I-5 | U13 — token economics; U15 (title only) |
| E-4 | U13 — agents ≈4× tokens, multi-agent ≈15×; MP1 — calibrate the judge to human labels before changing the generator |
| E-5 | U5 — judge calibration; U14 M13 — verification |
| R-2, R-3 | MP8 — acceptance bars and acceptance tracking |
| W-1, W-2 | — (presentation; no unit) |
| M-1, D-1 | MP8 — engagement skeleton: numeric bars, charts, phased build |
| D-2 | — (ADR; fleet convention, not Newline) |
| T-0, T-2, T-3 (gap cycle) | U8 — validation as a stage, applied per track rather than per document; U14 M13 — symbolic checks (the INV-20 one-observation-per-condition rule is a verification rule, not a model) |
| T-1, T-6, T-8, T-7a, T-7b | U14 M5 — client-side processing as a privacy design (frames never leave the device); U15 (title only) — latency and cost in production. *Confidence: inferred; the vault pages describe no on-device or real-time unit* |
| T-4, T-5 | U13 — bounded agent with stop rules, now with a debounce and a per-session cap; U9 — post-retrieval over a stream; MP8 — acceptance tracking of revised recommendations |
| V-5, E-6 | U5 — measure before improving, with a video fixture; MP8 — numeric bars set before the result (O-7 precedes E-6) |
| F-1, F-2, F-3, F-4 | U14 M6 — "data collection is the hardest step"; U12 — fine-tuning and dataset hygiene; U5 — held-out evaluation; U14 M3 — the corpus-generated-eval caution applies to prefill-and-correct labels |

## 2. Teachable artefacts the build produces (candidate content)

| Artefact | From card | Candidate format |
|---|---|---|
| Labelling tool and the fixture-labelling protocol | V-1a (or V-1b), O-3 | Workshop (hands-on, 45 min) |
| E1: pixels vs inference | E-1 | Lecture segment plus a dataset of aggregates (photos stay private until G-PUB) |
| E2/E3: detector and OCR bake-off | E-2, E-3 | Workshop |
| E4: pipeline vs bounded LLM vs loop | E-4 | **Mini-project** (strongest candidate; MP1's two-phase gate is its template) |
| Catalog retrieval over noisy OCR fragments | C-3 | Workshop in MP8's retrieval-bar format; MP3/MP4 adaptation once their briefs are readable |
| E5: the wall | E-5 | Discussion lecture |
| The privacy guard for build-in-public | Z-1 | Short workshop |
| Conductor and card harness | OPERATING-MODEL, DELIVERY-PLAN | Harness Engineering case study |

**Public dataset limit.** Until G-PUB rules, every teachable dataset is aggregates only, plus the PROXY public spine sets. Any workshop that needs photos uses the proxy sets.

## 3. Community touchpoints (drafts; the owner posts)

| When | Touchpoint | Draft (the conductor refreshes the numbers; no private data) |
|---|---|---|
| After S0 | "Building in public" kickoff | *"Starting BookcaseDiscovery: photograph a bookstore shelf, identify spines from partial text, rank against my reading taste. Plan, cards and gates are public at `<repo URL>`. First question I'm testing: do pixels or inference dominate spine reading? (E1)"* |
| M1 (G-M1) | M1 results | *"M1: traceable spine observations on one real bookstore case. Spine recall `<x>`, OCR CER `<y>` at per-shelf 48 MP vs whole-case 12 MP (E1). Library-trained detectors on bookstore shelves: `<E2 result>`. Run records: `<links>`. What would you test next?"* |
| After G-E4 | The agent question | *"Does an LLM adjudicator earn its cost on ambiguous spines? Arms: index-only / +Haiku / +Sonnet `<numbers, tokens>`. `<Loop arm run or not, and why>`."* |
| MVP (G-MVP) | MVP demo | *"MVP: one bookcase → located, explained recommendations. Dev-set numbers `<…>`. `<n>` of 15 recommendations judged useful. What broke: `<top deviations>`."* |

## 4. v2 (iOS-native), noted only

*Gap cycle (2026-10-31, late): the live spike (S9) now runs on the phone inside the MVP and is mapped in §1b. The rows below are for the v2 product app only.*

These units plausibly fit v2 and are not mapped in detail now:
- **U14 M5:** Cursor's client-side embedding and privacy design (on-device vs server).
- **U6 / U12:** multimodal and CLIP, and embedding fine-tuning, relevant to on-device visual memory.
- **U15 production**, title-level: shipping, cost and monitoring.

Revisit at G-V2.
