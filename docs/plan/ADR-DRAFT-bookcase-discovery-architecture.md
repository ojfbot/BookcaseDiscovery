# ADR (draft): BookcaseDiscovery MVP architecture — positions taken by the delivery plan

slug: bookcase-discovery-architecture
serial: (unassigned — draft)
domain: personal tools / recognition
type: architecture
Date: 2026-10-31 (Opus 5.5 draft; §12 added by the Fable 5.1 planning pass the same evening)
Status: **Proposed.** Each section is ruled at the gate named in it. Nothing here is ratified by being written down.
Repos affected: new **public** `ojfbot/BookcaseDiscovery` (owner-created, fleet-registered); `ojfbot/core` (this ADR, via card D-2)
traces:
  relates-to: [bookcase-discovery-engine-brief-2026-10-31, synthesis/bookcase-discovery-delivery-assessment, selfco-capture-pipeline-and-state-relay (format precedent)]

---

## Context

The brief was a ChatGPT voice session on 2026-10-31. It asks for an open-world bookcase discovery and recommendation system, with science fiction first. It also orders three reviews:
- a GPT technical assessment (**pending**);
- a Claude delivery assessment (**written**, as a vault synthesis page);
- an owner-led reconciliation (**pending**).

The owner chooses the architecture.

The owner asked for a delivery plan now (OC1). That forces a choice: either plan against the one assessment that exists, or plan nothing. This ADR records what the plan takes from that assessment, where it goes further, and where it disagrees. That way the reconciliation can rule on each point instead of finding them already built.

## What the plan takes from the Claude assessment, and where each is ruled

| # | Assessment position | Plan's use | Ruled at |
|---|---|---|---|
| A1 | A conventional pipeline (segment, OCR, local index, joint assignment) plus **one bounded LLM adjudicator**; no agentic loop before measurement | Cards I-1 to I-4. E-4 measures whether a multi-step arm is needed | **G-R**, then **G-E4** |
| A2 | One package, five deep modules | Z-0 scaffold (OC5) | **G-R** |
| A3 | SQLite event log, materialized views and FTS5; Zod for ledger records only | L-1, L-2, C-3 | **G-R** (cheap to change before S6; see §1) |
| A4 | Evidence bands, not probabilities | I-3 | **G-R** |
| A5 | The wall: context ranks, never identifies | INV-13, I-4 structural test, E-5 | **G-E5** |
| A6 | Per-shelf 48 MP capture protocol | The fixture shoot captures all three settings so that E1 can decide (OC6) | **G-E1** |
| A7 | Fixed-share expensive pass (30/70), with budget exhaustion giving `paused` | I-5 | **G-R** |
| A8 | Local HTML report first; chat later and read-only | MVP non-goals; E6 post-MVP | **G-R** (scope) |
| A9 | Manual "Export Unmodified Original"; no osxphotos or PhotoKit | O-1 (a), K-1, K-2 | Agreed (it matches the brief's "never require unrestricted Photos access") |
| A10 | Local catalog built from the ISFDB and Open Library dumps; live APIs only for verification | C-1 to C-3 | **G-L** for licences; otherwise agreed |
| A11 | Experiments E1–E6, each with the decision it drives | E-1 to E-5 in the MVP, E6 post-MVP | Agreed, with the design changes in §4 |

## Decision (positions beyond the assessment)

### 1. Gate placement: what the GPT review can still change

Cards in S1–S5 follow the **brief's** domain model and phases, which both reviews inherit:
- capture with validation;
- observation / hypothesis / work separation;
- fixtures and labels first;
- a scorer;
- a report that locates books.

So those cards run before G-R. What G-R can still change is concentrated in S6: the adjudicator, the scheduler, and any loop.

The ledger's storage choice (A3) is architecture-flavoured but low-cost to replace before S6. Every module writes through the L-1 `Ledger` interface, and the event schemas come from the brief's entity list.

*Risk accepted:* if the GPT review argues for a fundamentally different domain model, S1 contract work is partly redone.

### 2. Stack: a TypeScript core plus two process-isolated helpers (owner-confirmed, OC4)

The core is pnpm and TypeScript, on Node ≥22. It owns the ledger, catalog, identify, recommend, report and eval.

The two helpers speak JSON Lines over stdin/stdout. **Their schemas are JSON Schema files in `contracts/`, the single source of truth (OC13).** The TypeScript Zod validators are generated from them or checked against them, and Swift (Codable) and Python read the same files.
- **`helpers/ocr-vision`**: Swift, for Apple Vision.
- **`helpers/detect`**: Python via `uv`, for YOLO-OBB or SAM.

Why:
- The brief asks for TypeScript.
- Apple Vision is reachable only from Swift or Objective-C.
- The detector ecosystem is Python-native.
- Process isolation makes each helper replaceable behind its contract. It also contains the licence exposure in §6.

*Rejected:* a Python core (it departs from the brief); pure TS with ONNX (it needs an exported model before E2 has picked one).

### 3. Joint assignment is not one-to-one — disagreement with the assessment's analog

The assessment cites the DAS 2024 pipeline, which uses Hungarian assignment. That is a one-to-one matching against a **library** catalog, where each title sits on the shelf once.

A bookstore shelf routinely holds several copies of one title side by side. The brief says not to collapse physical copies (INV-4). One-to-one assignment would force the second copy onto a wrong candidate or onto `unknown`.

**Position:** per-shelf joint scoring with:
- a duplicate penalty only for **non-adjacent** repeats;
- the penalty waived for adjacent, near-identical spines;
- a fixed-threshold `unknown`.

This is designed and documented by Opus in card I-2.

*Settled by:* the I-2 synthetic tests, then fixture top-1 against I-1 alone.

### 4. Experiment design changes

- **E3** uses the **owner's label boxes** as crops, so it measures OCR alone rather than detection plus OCR. The cloud-OCR arm becomes optional (it needs an account and key the owner may not want). The VLM arm uses the same provider as the adjudicator.
- **E4**'s multi-step arm runs only if a pre-stated residue condition holds: residue ≥15 % of readable spines, **and** at least half of 20 inspected residue cases are recoverable by reasoning rather than pixels. Building a loop just to measure it is exactly the speculative work the assessment warns against.
- **G-P** applies a detector/OCR rule **written before any fixture data is seen**. It is a conductor decision, not an owner ruling: these are component defaults, not architecture.
- **Dev set only.** Fixture-001 is used to choose defaults and thresholds, so its numbers are optimistic and are labelled as such (OC11). A held-out fixture is the first post-MVP card.

### 5. Labelling: no detector prefill on the first fixture

Prefilling boxes from the P-2 detector would save the owner hours. But it would bias E2 towards YOLO and hide the misses that spine recall is meant to count.

**Position:** no prefill on `sf-store-001` (OC8). Instead, cut time with an adopted or keyboard-first labelling tool (V-1a, or V-1b as fallback) and catalog autocomplete (V-4, when it lands in time). Prefill is allowed on later fixtures, where detection is no longer under test.

*Tradeoff accepted:* about 1–2 more owner hours on the critical path.

### 6. Privacy and licence boundaries

*(Revised 2026-10-31 after the owner made the repo public and set the boundary; see REQUIREMENTS OC9.)*

- **Three data classes, three rules.**
  - **Public:** the owner-stated reading profile, with its read / liked / inferred / unknown provenance kept. The owner chose to share it.
  - **Never public:** ChatGPT exports and anything derived from them (a private overlay file), and SelfCo context. That covers git history, logs, fixtures and eval artifacts.
  - **Private until G-PUB:** photos, crops, labels and per-spine artifacts. Only aggregates are public.
- **Enforced by a machine.** A rule only an agent's memory holds will leak in a public repo, so card Z-1 puts the boundary in a pre-commit hook and a CI job, each rule with a planted-leak test.
- **Why the ChatGPT line is drawn by provenance, not by file.** An inferred interest in a public file would leak a private chat as surely as the export itself.
- **Why photos wait for a gate.** A curated release needs:
  - redaction of people, signage and GPS;
  - the store's consent;
  - a position on cover-art copyright;
  - a model card.

  None of those can be decided well before the MVP shows what the photos are for. Hence G-PUB, post-MVP.
- **Ultralytics is AGPL-3.0, and in a public repo the question is live, not deferred.**
  - If YOLO-OBB wins E-2, `helpers/detect/` carries AGPL inside a permissively licensed repo. It is a separate process with its own licence file.
  - Otherwise G-P may prefer the permissive SAM backend.
  - The owner picks the repo licence before Z-0 (OC14).
- **Distribution needs G-L.** Before any distribution, G-L needs `docs/licences.md` (card C-0) to clear Open Library, ISFDB attribution, the cover images and the proxy datasets.

### 6b. Building in public changes the review surface

Every PR body, issue and CI log is public. That is why the conductor's review checklist adds two things: write for a public reader, and keep no private context in PR text. It is also why the build-in-public posts to the Newline community are drafted by the conductor and **posted only by the owner** (OC16). Feedback re-enters as quoted issues or gate-packet inputs, never as an agent reading the community.

### 7. Relevance may order spending, never identity

I-5 puts 70 % of the expensive budget in relevance order, which is the assessment's own rule. **Position:** this is consistent with the wall (INV-13), and the plan states it explicitly.
- Relevance decides *which* ambiguous spine is adjudicated first.
- It never enters the adjudicator's prompt or the identity scores.
- The orchestrator (`src/run/`) is the only module that imports both `identify` and `recommend`.

*Risk:* relevance-ordered spending still biases *which* identities get resolved. The 30 % shelf-order share is the guard against that, and the report lists unresolved spines regardless (INV-9).

### 8. Recommendation ranking is feature-based and templated

Rationales come from features: liked author, tag overlap, novelty. They are not LLM-written, so every rationale traces to profile entries and catalog fields. A fixed 1-in-5 serendipity share stands in for the brief's surprise lens. LLM-written explanations are post-MVP, and only over already-ranked results.

### 9. Fleet registration

The plan proposes `l1-bookcase-discovery` laddering to `l2-ojfbot` (`NORTHSTAR-PROPOSAL.md`). The roadmap's slices map 1:1 to dispatched cards, so standup and roadmap-lint see the same units the conductor dispatches. Slices are `gate-0`: the conductor merges, which matches this plan's governance. Registry files are written only after the owner approves the text (card Z-2).

### 10. Portability for a later iOS v2 (proposed seams, not v2 work)

The owner plans a later major version: a native iOS app (Swift) with Python backend helpers, behind G-V2, after the MVP is validated. The MVP builds nothing for it, but keeps these seams cheap now:

| Seam | MVP choice | Why it matters for v2 |
|---|---|---|
| Contracts | JSON Schema is the source of truth (OC13) | Swift Codable and Python share the same files |
| Ledger | Plain SQLite, standard SQL, FTS5 only in the catalog; no Node-only extensions; events as JSON text | The same schema can open with SQLite on iOS (GRDB, or the system library). *Hypothesis: FTS5 trigram availability in iOS's system SQLite is unverified; v2 may need a bundled SQLite* |
| Image store | Content-addressed by sha256 | Path-independent; it works in an app container |
| OCR | Apple Vision behind the `ocr-vision` contract | Moves on-device unchanged in substance; the Swift code is reusable |
| Detector | YOLO-OBB or SAM behind the `detect` contract | *Hypothesis:* YOLO-OBB has a CoreML export path, so it could run on-device. SAM (ViT-H scale) likely stays a backend helper, unless a mobile variant passes E-2-style tests |
| Embeddings / visual memory (post-MVP) | Not built | Likely CoreML-convertible for inference; training stays backend |
| Adjudicator | API call behind a budget wrapper | Stays a backend call from the app; the cost and privacy story changes (v2 open question) |

Each "hypothesis" is checked in the G-V2 packet, not assumed.

### 11. Vault coordination and GPT agents

- **Canonical copy.** The repo's `docs/plan/` is canonical. The vault holds one coordination page, which the conductor updates at merges, gates and segment boundaries (OPERATING-MODEL §9a).
- **Reading the vault today** (the owner, 2026-10-31): the vault is their Obsidian vault across their devices. Cloud agents cannot read it. Agent access is mostly write-only unless explicitly enabled. A sturdier integration of SelfCo with agent sessions across devices is a goal the owner is building toward in parallel.
- **What this plan does about it.** It does **not** design that read path. It writes a page any local agent can read in plain markdown, and gives GPT surfaces a write-back route into `raw/inbox/`. It treats the owner as the relay to cloud agents until their SelfCo tooling lands.
- **Where the reviews land** (OC18). The GPT assessment and the owner's reconciliation go beside the Claude assessment in the vault, so every agent sees one record of the disagreements.

### 12. Thin over wide: what the Fable pass cut from the Opus draft (OC20–OC23)

The Opus draft was a complete horizontal layer cake: every foundation, every catalog source and both detector arms before a real photo crossed the pipeline. The owner's working rule is vertical slices that ship observable value. Four cuts, each reversible from the backlog:

| Cut | Why | Reopens when |
|---|---|---|
| Open Library import (C-2) → post-MVP | ISFDB is the science-fiction specialist with ISBNs; edition breadth is already a non-goal; the import was a 12 GB download and a heavy-compute slot | The fixture's `not-in-catalog` share says ISFDB is not enough (DELIVERY-PLAN §6) |
| SAM arm (P-3) → conditional | The DAS 2024 evidence already documents SAM's spine failure modes; it is a challenger, not a default cost. The G-P bar (recall ≥0.85, merges+splits ≤10 %) is pre-registered so the skip is not a judgement call | YOLO-OBB misses the bar on the real shelf-48 photos |
| Labelling tool (V-1) → adopt-first spike, build as fallback | An M build card sat on the owner's critical path for a tool class that exists. Unverified hypothesis, checked in V-1a: Label Studio handles 48 MP, rotated boxes and the title/author flow | V-1a's pre-registered rule or the owner's 10-minute trial fails |
| ChatGPT-export importer → post-MVP | The one MVP card that read never-public data inside a public repo. The overlay mechanism and the refusal rule ship; the reader does not | The owner wants inferred interests in the ranking |

Also: the capture protocol moved into the owner checklist so the shoot no longer waits on the repo (DELIVERY-PLAN §1 #8). *Disagreement with the assessment's E2 as written:* it names SAM vs YOLO-OBB as a two-arm experiment; this ADR runs the second arm only on failure of the first. The assessment's author may contest this at G-R.

### 13. The live experience: a temporal layer, an on-device layer and a data layer (gap cycle, OC24–OC29)

The owner's goal experience is live: labels that stick to spines as the camera moves, cards that revise visibly, models that learn from every shoot. The batch architecture stands as the recognition proof; the live track adds three layers, each behind the existing contracts:

| Layer | Position | Why, and what it changes |
|---|---|---|
| **Temporal** | A spine is a *track*, not a crop. `Track`, `TrackWindow` and track-scoped `OcrReading`s with a `condition` key join the contracts (T-0). Readings from one track that differ only in time are one observation (INV-20, the temporal analog of INV-6). Enrichment is debounced on `stable` tracks and cancelled on `lost`. Cards carry explicit revisions (INV-21). The ledger logs lifecycle edges and windows, never frames | Correlated evidence must not inflate bands; the stream must not drown the ledger; the brief requires visible revisions |
| **On-device** | Detection, tracking and OCR run on the phone; the catalog runs on the phone if the FTS5 probe passes, else over a local link; the adjudicator stays a Mac-side call behind the budget wrapper; the phone holds no API key. Core ML export of YOLO-OBB leaves rotated NMS to the app (verified), so `OBBDecode` is a Swift package behind the `detect` contract | Latency and privacy: on-device-only processing keeps frames out of Apple's "collected" definition; the one published figure (YOLO26n-obb, iPhone 17 Pro, 3.9 ms on the Neural Engine, single image) says the budget is plausible and must be measured sustained |
| **Data** | A content-addressed dataset store with grouped splits by store/bookcase/session; a registry record per trained model; video fixtures labelled in CVAT; a held-out harness over stills and clips | "Many images collected" is a data-management problem before it is a modelling one; leakage across near-duplicate frames would make every live number a lie |

**Spike surface.** Continuity Camera is a pipeline proxy only: Apple documents its video formats at 640×480 to 1080p and stills at 12 MP (WWDC22). Stage A builds the temporal layer on the Mac; Stage B measures pixels and the Neural Engine on the phone (OC25, gate G-SURF). The owner allowed the on-phone loop on 2026-10-31.

**Licence.** Ultralytics states its AGPL-3.0 covers trained weights. The repo's licence (OC14) and any weights release (G-W) are therefore one decision, taken early at G-LIC (OC26). No permissive oriented-box detector with a Core ML path was found; the permissive route is a retrain with an axis-aligned Apache detector plus a rotation step, or a custom head.

**"Pixels on demand".** For live video the assessment's "pixels dominate" becomes a work item: a tracked spine whose fused reading is too weak requests a 48 MP still, which runs the batch pipeline on that spine. E-6 measures how often that fires and whether it resolves the spine. This partly moots E-1's protocol question for the live path; E-1 still rules the batch protocol.

**Not reopened.** The agentic question (§1 of the assessment): the live loop is a stage graph with one bounded, debounced adjudicator. The context wall (INV-13). Bands over probabilities. ISFDB-only.

## Agreements, disagreements, open

- **Agree** with the assessment on A1–A11, each subject to its gate.
- **The gap cycle disagrees** with the brief's proposed spike surface (Continuity Camera alone), with the assessment's E1 framing for video (§13 "pixels on demand"), and with OC19's "no v2 cards" clause (amended to "no v2 *product* cards"; owner to confirm).
- **Disagree** on:
  - one-to-one assignment (§3);
  - the E3 and E4 designs as written (§4);
  - E2 as an unconditional two-arm experiment (§12).
- **The Fable pass disagrees with the Opus draft** on breadth (§12): Open Library, the SAM default, the built labelling tool and the ChatGPT importer are out of the MVP.
- **Go further** on:
  - gate placement (§1);
  - the stack (§2);
  - labelling bias (§5);
  - privacy and licences (§6);
  - relevance ordering (§7);
  - ranking (§8);
  - fleet registration (§9);
  - v2 seams (§10);
  - vault coordination (§11).
- **Open, for the GPT review to weigh:**
  - whether an agentic loop is ever warranted (E4);
  - calibrated confidence vs bands;
  - queue semantics beyond fixed-share;
  - whether the brief's whole-bookcase, multi-photo input is a requirement or an assumption (E1).

## Consequences

- **Owner-paced schedule.** The MVP's calendar length is set by the owner's shoot and labelling, not by agent work. The plan front-loads the labelling tool and the Photos unblock.
- **Bounded rework.** If the GPT review overturns A1/A2/A7, rework is confined to S6 cards. S1–S5 output (fixture, labels, scorer, catalog, perceive) survives any architecture that keeps the brief's domain model.
- **Optimistic numbers.** MVP numbers are dev-set numbers. Any claim about accuracy waits for `sf-store-002`.
