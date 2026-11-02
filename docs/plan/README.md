# BookcaseDiscovery — MVP delivery plan (draft, 2026-10-31)

Drafted by an Opus 5.5 planning session, then **revised the same evening by the Fable 5.1 planning pass** launched from `~/selfco/prompts/bookcase-discovery-planning-handoff.md`. The changelog at the bottom records every change from the Opus draft and why.

> **Gap cycle reported (2026-10-31, late).** The owner clarified the goal experience: a near-real-time, low-latency annotation stream with recommendation cards, trained from many collected images. The Fable 5.1 gap cycle (`~/selfco/prompts/bookcase-discovery-live-experience-gap-handoff.md`) added a **live track (S9)** and a **flywheel track (S10)** inside the MVP, gates G-SURF, G-LIVE, G-LIC and G-W, OC24–OC29 and INV-20–INV-23. Analysis: `~/selfco/wiki/synthesis/bookcase-discovery-live-experience-gaps.md`. **The batch waves may dispatch on GO.** The live track's Stage B and F-2 wait on three owner decisions: the licence under the AGPL constraint (checklist #0b′, G-LIC), the live targets (#16, O-7) and confirming the spike app at `apps/live-ios/` (OC19 as amended).

**Start here, conductor:** read this README, then `DELIVERY-PLAN.md` §1 (owner checklist) and §5 (your runbook), then `OPERATING-MODEL.md`. There is no `.handoff/` bead because no repo exists yet; this README is the handoff.

These are pre-repo drafts. The owner creates the public repo `ojfbot/BookcaseDiscovery`. Card Z-0 then copies this folder into its `docs/plan/`, which becomes **canonical** (OC3). After that, this folder is frozen.

The selfco vault holds one coordination page, `wiki/synthesis/bookcase-discovery-delivery-plan.md`, which the conductor refreshes.

Start with the owner checklist (`DELIVERY-PLAN.md` §1). Items 0/0b (repo and licence), 1 (Photos) and 2 (labelling time) come first.

- `REQUIREMENTS.md` — OC1–OC23, the public/private boundary table, MVP definition, invariants INV-1–INV-19, non-goals (including v2 iOS and the photo release), risk tiers.
- `DELIVERY-PLAN.md` — owner checklist, segments S0–S10, 11 MVP gates plus 3 post-MVP gates (G-PUB, G-V2, G-W), 62 cards (incl. U-1 overlay UX research), parallelism map, batch and live critical paths, conductor runbook, fallbacks, post-MVP backlog.
- `OPERATING-MODEL.md` — roles, tiers, dispatch/review/merge, deviation roll-up, helpdesk check-ins, vault write-back (§9a), community touchpoints (§9b), budgets.
- `ADR-DRAFT-bookcase-discovery-architecture.md` — what the plan takes from the Claude assessment, where it goes further (stack, privacy, fleet registration, v2 seams, vault coordination), and where it disagrees. Each point is ruled at a named gate.
- `CURRICULUM-MAP.md` — segment and card → Newline unit and mini-project, teachable artefacts, community post drafts.
- `NORTHSTAR-PROPOSAL.md` — proposed `l1-bookcase-discovery` northstar, roadmap and registry entries. Text only, awaiting owner approval.
- `implementation-notes.md` — deviations from the planning brief.

Inputs (read-only):
- `~/selfco/wiki/synthesis/bookcase-discovery-delivery-assessment.md`
- `~/selfco/wiki/sources/bookcase-discovery-evidence-2026-10-31.md`
- `~/selfco/raw/inbox/40a54a8c-53d7-8188-a37f-d9fe7cfb6156.md`
- `~/selfco/diagrams/bookcase-discovery-engine.md`
- the Newline vault pages cited in `CURRICULUM-MAP.md`

Format precedent: `~/ojfbot/selfco-inbox/docs/plan/`.

## Changelog — calm overlay, 2026-11-01

Owner direction: the live overlay must not be noisy or jittery; show top-k minimal options with a filter toggle; the UX is researched in forked design sessions. Added OC30 (one label per spine, top-k highlight under a lens toggle), INV-24 (on-glass changes are hysteretic; the ledger keeps everything), card **U-1** (overlay UX research, owner-launched in Claude Design / GPT Canvas from `~/selfco/prompts/bookcase-discovery-live-overlay-ux-handoff.md`), and wired U-1 into T-5, T-7a, O-7 (#16) and the G-LIVE definition of done. Cards 61/58 → 62/59. **2026-11-02:** U-1 delivered from Claude Design. The spec is in `docs/live/overlay-ux.md`; the owner rules §9.

## Changelog: guided sweep and full recognition, 2026-11-02

Owner direction:
- **OC31 guided sweep mode.** Hold, pan with pace cues, release, then a thinking overlay, then results and a scrub-back replay. The video is discarded after processing; only sparse keyframes are kept. Cards U-2 (design) and T-9 (build).
- **OC32 every spine recognised.** The aim is 100 % recognition, not 100 % recommendation; each `unknown` is a defect with a reason. Card C-R researches a broader catalog backend: the Library of Congress and bookseller and bibliographic APIs. OC20 stands until C-R reports.
- INV-22 and the G-LIVE definition of done amended. Cards 62/59 → 65/62.
- **OC33 taste model.** Taste means ideas, themes, topoi, styles and questions, never collaborative filtering. Identity confidence and discovery temperature are separate settings, and there is a dev mode. Card R-0.
- **OC34 machine-first labelling (2026-11-02).** OC8 is superseded. A blind audit slice (about 2 shelves, under an hour, never trained on) is the honest scorecard. F-0 machine-labels the rest (detector + OCR + VLM + catalog); the owner reviews only flagged spines and gaps (O-3a, O-3b); E-2 and E-3 headline numbers come from the audit slice only. Own fine-tuned reader: backlog 6c. Wave 1 gains C-R and R-0. Cards → 69/66.
- **OC35 real use first (2026-11-02).** The primary distribution is handheld, angled, mostly ultra-wide shots of whole cases. Clean per-shelf shots are a controlled reference. Metrics report real-use and controlled separately, and gates judge on real use. `pilot-000` (31 photos) is the first real-use set, with a blind audit of 3–4 photos, and becomes training data. Every shoot adds a shoot-like-a-shopper pass.
- **U-2 and U-3 delivered (2026-11-02).** The specs are in `docs/live/guided-sweep-ux.md`, `docs/live/chat-002-ux.md` and `docs/recommend/taste-tree-ux.md`; 27 open questions await the owner.
- **U-1 §9 all ruled.** U-3 (chat layer: 002 and 006) added; mockups may be shared publicly by the owner. Cards → 67/64.

## Changelog — Fable 5.1 gap cycle, 2026-10-31 (late)

Owner decisions this cycle: parallel spike, not a replan-first; the spike **may become an on-phone loop** if the Mac proxy is unfaithful. Research: nine subagents; the three plan-changing claims were re-read on the primary pages (evidence: `~/selfco/wiki/sources/bookcase-discovery-live-experience-evidence-2026-10-31.md`).

| Change | Where | Why |
|---|---|---|
| **Live track S9** (T-0–T-5 Mac stage, T-6/T-8/T-7a/T-7b phone stage, V-5 live scorer, E-6 live-vs-still, O-6 clips, O-7 targets) and **flywheel track S10** (F-1–F-4) added inside the MVP | DELIVERY-PLAN §2 rows S9/S10, §3 new sections, §4 live chain and wave row, §6 risks, §7, §8; REQUIREMENTS OC24, OC27, live MVP definition | The goal experience is live; the batch plan proved recognition only. Thin slices: the Mac stage needs no photos; the phone stage needs a fixture-trained detector |
| **Two-stage spike surface** (OC25): Continuity Camera = pipeline proxy only; gate **G-SURF** before the phone stage | REQUIREMENTS OC25; DELIVERY-PLAN gates, T-1 | Apple documents Continuity Camera video "from 640 by 480 to 1080p" and 12 MP stills (WWDC22 10018, read in the browser). No pixel or Neural Engine question is answerable on the Mac |
| **Gate G-LIC and OC26**: detector licence decided before weights leave the data dir; OC14 amended; checklist #0b′ | REQUIREMENTS OC14, OC26; DELIVERY-PLAN gates, checklist, F-2 entry | Ultralytics: "All Ultralytics YOLO trained models fall under the AGPL-3.0 License by default" (ultralytics.com/license, read in the browser). No permissive OBB detector with a Core ML path was found |
| **Gate G-LIVE** with the owner's targets (OC29, O-7, checklist #16); **gate G-W** (post-MVP) for weights release (OC28) | DELIVERY-PLAN gates; REQUIREMENTS OC28–OC29 | Live claims need a bar the owner set before the result exists; weights trained on private photos are a new public class |
| **INV-20–INV-23** added: per-track OCR is one observation per condition; card revisions explicit; no frame retention; live latency measured | REQUIREMENTS invariants | Temporal analog of INV-6; the brief's "explicitly show revisions"; the privacy boundary at stream scale; INV-17 for the stream |
| **OC19 amended**: "no v2 cards" → "no v2 *product* cards"; spike app proposed at `apps/live-ios/`; non-goal "no continuous camera" withdrawn for S9 | REQUIREMENTS OC19, non-goals | The live loop is iOS code inside the MVP. **Owner to confirm** |
| Boundary table gains live frames, sweep clips, weights rows; Z-1 guard gains video and weight file types | REQUIREMENTS OC9 table; Z-1 (by reference) | New private classes |
| Backlog #6 (fixture-trained detector) moved into the MVP as **F-2**; backlog #6b lists live follow-ons; G-V2's packet lists what S9 measures | DELIVERY-PLAN §8, gates G-V2 row | The live loop needs a detector that knows bookstore spines; v2 gets measurements instead of hypotheses |
| Shoot protocol #8 gains **sweep clips**; checklist gains #0c (phone provisioning), #0b′, #16, #17 (store permission log) | DELIVERY-PLAN §1 | Video fixtures must be recorded at the same visit; filming is a visible pattern in a store |
| Card count 43/40 → **61/58**; gates 8+2 → **11+3**; critical path: batch 14 steps unchanged, **live chain 17 steps is the long pole** | DELIVERY-PLAN §3 count table, §4 | — |
| Curriculum map §1b gains S9/S10 rows; §4 v2 note updated. ADR gains §13. Northstar gains a **proposed P4 (pending owner)**. OPERATING-MODEL: heavy-compute list, phone-at-keyboard marker | CURRICULUM-MAP, ADR, NORTHSTAR-PROPOSAL §5, OPERATING-MODEL §1, §4 | — |

**Disagreements recorded** (details in the gap analysis §7): with the brief's proposed surface (Continuity Camera cannot be the whole spike); with the assessment's E1 framing for video ("pixels on demand" via a tracked spine's 48 MP still); with OC19 as written.

## Changelog — Fable 5.1 planning pass, 2026-10-31 (evening)

Owner decisions reconfirmed in the Fable grill: MVP end to end on one bookcase (OC2); plan now behind G-R (OC1); community-only reviewers (OC16); iOS fork shape decided at G-V2 (OC19).

| Change | Where | Why |
|---|---|---|
| **Open Library import (C-2) moved to post-MVP** (new OC20) | REQUIREMENTS OC20, catalog row, non-goals; DELIVERY-PLAN S2, C-3, checklist #5, waves, risks, backlog #4; OPERATING-MODEL heavy-compute list; ADR §12 | ISFDB is the SF specialist with ISBNs; edition breadth is already a non-goal; drops a ~12 GB download, a heavy-compute slot and a card. Reopens when the fixture's `not-in-catalog` share says so |
| **Labelling tool: adopt before build** (new OC21) — V-1 split into V-1a (Label Studio spike, S) and V-1b (custom tool, M, fallback) | REQUIREMENTS OC21; DELIVERY-PLAN V-1a/V-1b, S1, waves, risks | An M build card sat on the owner's critical path for a tool class that exists. Hypothesis (Label Studio handles 48 MP + rotated boxes + title/author flow) is checked in the spike with a pre-registered rule |
| **ChatGPT-export importer moved to post-MVP** (new OC22) | REQUIREMENTS OC22, recommend row, non-goals; DELIVERY-PLAN R-1, backlog #5 | The one MVP card reading never-public data inside a public repo. The overlay merge and refusal rule still ship |
| **SAM arm (P-3) conditional** (new OC23) | REQUIREMENTS OC23; DELIVERY-PLAN G-P rule, P-3, E-2, S3, checklist #5–#6; ADR §12 | DAS 2024 evidence already documents SAM's spine failure modes; it is the challenger. Pre-registered bar: YOLO-OBB recall ≥0.85 and merges+splits ≤10 % |
| **Capture protocol moved into the owner checklist** (#8) so the shoot needs no repo and no card | DELIVERY-PLAN §1 #8, critical-path note, runbook step 1 | O-1 → K-2 → O-2 can all happen before GO; the earliest agent-blocked owner step becomes O-3 (needs V-1a) |
| Card count 44 → 43 on the plan, 40 in the expected path | DELIVERY-PLAN §3 count table | C-2 removed; V-1b and P-3 conditional |
| **Z-2 fleet registration corrected** against core's registry schema | DELIVERY-PLAN Z-2; NORTHSTAR-PROPOSAL §1 body, §2 body + typed `depends_on` + `check:` rule, §4 ladder-stress verdicts | The Opus draft missed the ladder-stress verdicts (a land requirement), the roadmap body, the typed same-roadmap ref form, and the `check:` demotion rule. P2's ladder is flagged `strain` |
| **Curriculum map checked row by row** | CURRICULUM-MAP header, rows S2 R-1, S3, S6 I-4, S7, S8, E6; new §1b card → unit table | Three citations had no support in the vault pages (U9 for R-1, U4 for R-2, "MCP material"); MP9's bars are MP8's; MP3/MP4 (not MP2) are the retrieval-shaped mini-projects. §1b gives the conductor the line to paste into each card brief (OPERATING-MODEL §4) |
| Authorship labels corrected throughout | All file headers; OPERATING-MODEL T3 row | The Opus session had labelled itself "Fable" |

**Preserved for backlog #4 — the Opus draft's C-2 card text:** *Open Library import, science-fiction subset. Entry: downloads approved; a heavy-compute slot (download may overlap another heavy card; processing may not). Do: stream the works, editions and authors dumps, never loading a whole file; keep a work if its subjects match an SF vocabulary list, or an author maps to an ISFDB author by normalized name, or any edition's ISBN appears in ISFDB pubs; keep the editions of kept works; stage to `catalog/ol-staging.sqlite`; report filter recall (share of ISFDB novels with an ISBN found in the OL subset). Exit: staging DB present; counts, filter recall, runtime and dump dates in `docs/catalog.md`. Tier T2 Sonnet, M, budget 50. C-3 then adds an ISFDB↔OL crosswalk.*
