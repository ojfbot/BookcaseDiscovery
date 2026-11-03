---
type: roadmap
slug: rm-l1-bookcase-discovery
northstar: l1-bookcase-discovery
status: active
# Registered 2026-11-02 by card Z-2. One slice per dispatchable card of docs/plan/DELIVERY-PLAN.md §3,
# ids in card order. Not slices: Z-0 (bootstrap), Z-2 (this registration), owner cards O-* and
# gates (they appear in entrance), and cards withdrawn before registration (V-1b, V-4, C-2; OC36,
# OC20). depends_on holds ONE direct edge (the registry parser takes a scalar); further
# prerequisites are named in entrance. moves_* are PROPOSALS for the owner to calibrate.
phases:
  - id: PH1
    name: "Foundations, catalog and perception spikes (S0–S3)"
    goal: "Synthetic end-to-end passes; catalog golden set ≥90% top-5; perceive writes traceable observations on proxy images; privacy guard live."
  - id: PH2
    name: "Fixture and M1 (S4–S5)"
    goal: "Fixture ingested and machine-labelled (OC36); E1–E3 recorded; G-M1 accepted."
  - id: PH3
    name: "Identify (S6)"
    goal: "Bands, assignment, adjudicator per G-R; E4/E5 ruled."
  - id: PH4
    name: "Recommend and MVP (S7–S8)"
    goal: "G-MVP accepted; runbook and handoff written."
  - id: PH5
    name: "Live track (S9)"
    goal: "Stage A sticky labels and revising cards on the Mac; Stage B on the phone; G-LIVE ruled."
  - id: PH6
    name: "Flywheel (S10)"
    goal: "One owner-trained detector in models/registry/ with held-out metrics; F-4 scores it on stills and clips."
slices:
  - id: S1
    phase: PH1
    title: "Z-1 privacy guard: pre-commit + CI with planted-leak tests"
    advances: "ns:l1-bookcase-discovery#P3"
    moves_from: 0
    moves_to: 30
    deliverable: "PR adding scripts/privacy-guard.mjs, hook, CI job, docs/privacy.md"
    entrance: "Z-0 bootstrap merged"
    success: "Every planted leak caught; clean tree passes; CI job visible on the PR"
    check: "pnpm test && pnpm guard --history"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
  - id: S2
    phase: PH1
    title: "L-1 contracts (JSON Schema source) and CONTEXT.md glossary"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 4
    deliverable: "PR adding contracts/, src/ledger/contracts.ts, CONTEXT.md, docs/contracts.md"
    entrance: "Z-0 bootstrap merged"
    success: "Examples validate; no `exhausted` status; Zod agrees with JSON Schema"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: merged
  - id: S3
    phase: PH1
    title: "L-2 SQLite ledger, status machine, replay, image store"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 4
    moves_to: 8
    deliverable: "PR adding src/ledger/sqlite.ts, the transition table, bookcase replay, docs/ledger.md"
    entrance: "L-1 merged; docs/probe.md records the SQLite choice"
    success: "Replay of a synthetic run gives an identical view dump; illegal transitions and UPDATEs on events are rejected"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S2"
  - id: S4
    phase: PH1
    title: "K-0 capture protocol sheet"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 8
    moves_to: 9
    deliverable: "docs/capture-protocol.md"
    entrance: "Z-0 bootstrap merged"
    success: "The sheet reads on a phone-width preview"
    check: "test -f docs/capture-protocol.md && pnpm guard"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
  - id: S5
    phase: PH1
    title: "K-1 capture module and ingest validator"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 9
    moves_to: 12
    deliverable: "PR adding src/capture/ and bookcase ingest"
    entrance: "L-1 merged"
    success: "Only verified originals enter the ledger; working copies carry no GPS (INV-11, INV-12)"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S2"
  - id: S6
    phase: PH1
    title: "V-1a label format and labelling-tool spike"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 0
    moves_to: 2
    deliverable: "Label schema, Label Studio converter, docs/labelling.md"
    entrance: "Z-0 bootstrap merged; checklist #6 installs approved"
    success: "Converter round-trips a Label Studio export; docs/labelling.md records the timings"
    check: "pnpm test && test -f docs/labelling.md"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
  - id: S7
    phase: PH1
    title: "V-2 scorer: one command for every experiment metric"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 14
    moves_to: 22
    deliverable: "PR adding the scorer under src/eval/ with synthetic known-answer tests"
    entrance: "L-1 and V-1a (schema) merged"
    success: "Perfect, merged, split, rotated and partial synthetic cases score as expected"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S6"
  - id: S8
    phase: PH1
    title: "W-1 report scaffold: where is it in the photo"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 12
    moves_to: 16
    deliverable: "PR adding src/report/ and bookcase report"
    entrance: "L-1 merged"
    success: "A synthetic report renders every spine boxed by status and band with a panel per spine"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S2"
  - id: S9
    phase: PH1
    title: "C-R catalog backend research (OC32)"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 16
    moves_to: 17
    deliverable: "docs/catalog/backend-options.md"
    entrance: "None (research)"
    success: "A sourced table, a recommended backend and an owner ruling"
    check: "test -f docs/catalog/backend-options.md && pnpm guard"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
  - id: S10
    phase: PH1
    title: "C-0 licence check for catalog and detector sources"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 17
    moves_to: 18
    deliverable: "docs/licences.md"
    entrance: "Z-0 bootstrap merged"
    success: "No blocker to local use, or G-L raised"
    check: "test -f docs/licences.md && pnpm guard"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
  - id: S11
    phase: PH1
    title: "C-1 ISFDB import into a staging SQLite"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 18
    moves_to: 22
    deliverable: "PR adding the streaming mysqldump parser and bookcase catalog import"
    entrance: "Checklist #5 downloads approved; C-0 shows no local-use blocker"
    success: "The ISFDB dump stages locally with counts checked"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S10"
  - id: S12
    phase: PH1
    title: "C-3 catalog index and fragment retrieval"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 22
    moves_to: 27
    deliverable: "PR adding bookcase catalog build/query/eval and evals/C3-catalog-retrieval/"
    entrance: "C-1 merged"
    success: "Golden set ≥90% top-5 on clean fragments; noisy-fragment rate recorded"
    check: "pnpm test && test -f evals/C3-catalog-retrieval/metrics.json"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S11"
  - id: S13
    phase: PH1
    title: "R-0 taste model research (OC33)"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 27
    moves_to: 29
    deliverable: "docs/recommend/taste-model.md"
    entrance: "None (research; public seeds only)"
    success: "Facets, vocabulary, temperature and three worked examples; an owner ruling"
    check: "test -f docs/recommend/taste-model.md && pnpm guard"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
  - id: S14
    phase: PH1
    title: "R-1 reading profile and public seeds"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 29
    moves_to: 33
    deliverable: "PR adding profile/seeds.json, bookcase profile check/build/review"
    entrance: "C-3 merged (needed for expansion); Z-1 merged"
    success: "Seeds validate; profile build expands read-all against the catalog; tastes stay apart from identity (INV-18)"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S12"
  - id: S15
    phase: PH1
    title: "P-1 ocr-vision Swift helper and TS wrapper"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 33
    moves_to: 37
    deliverable: "PR adding helpers/ocr-vision and src/perceive/ocr.ts"
    entrance: "L-1 (helper contract) merged"
    success: "Multi-rotation OCR behind the JSON Lines helper contract"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S2"
  - id: S16
    phase: PH1
    title: "P-2 detect helper, YOLO-OBB spike on PROXY images"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 37
    moves_to: 41
    deliverable: "PR adding helpers/detect and evals/proxy-P2/"
    entrance: "Checklist #5–#6; proxy datasets present; a heavy-compute slot"
    success: "A spine detector behind the helper contract with a PROXY baseline recorded"
    check: "pnpm test && test -d evals/proxy-P2"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
  - id: S17
    phase: PH1
    title: "P-3 SAM baseline (conditional, OC23)"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 41
    moves_to: 41
    deliverable: "evals/proxy-P3/; SAM behind the same TS wrapper"
    entrance: "Only if E-2 first pass shows YOLO-OBB shelf-48 recall <0.85 or merge-plus-split >10%; P-2 merged; heavy slot"
    success: "Both backends run through the same wrapper"
    check: "pnpm test && test -d evals/proxy-P3"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S16"
  - id: S18
    phase: PH1
    title: "P-4 perceive wiring: the cheap pass on every spine"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 41
    moves_to: 48
    deliverable: "PR wiring bookcase perceive (detect + OCR into the ledger)"
    entrance: "L-2, P-1 and P-2 merged"
    success: "On 3 proxy images perceive writes traceable observations and replay is identical"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S16"
  - id: S19
    phase: PH2
    title: "K-2 verify the received files are originals"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 48
    moves_to: 49
    deliverable: "docs/ingest-verification.md"
    entrance: "O-1 photos unblock (owner)"
    success: "Every file has a verdict; the conductor tells the owner whether O-2 is needed"
    check: "test -f docs/ingest-verification.md && pnpm guard"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
  - id: S20
    phase: PH2
    title: "K-3 fixture ingest and public manifest (ran on pilot-000)"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 49
    moves_to: 52
    deliverable: "fixtures/<session>/manifest.json and bookcase manifest"
    entrance: "K-1 and Z-1 merged; K-2 verdicts all original"
    success: "Every photo accepted or each reject explained; the manifest validates"
    check: "pnpm test && test -f fixtures/pilot-000/manifest.json"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S19"
  - id: S21
    phase: PH2
    title: "V-3 label resolution to catalog ids"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 22
    moves_to: 27
    deliverable: "fixtures/<session>/labels-summary.json (counts only)"
    entrance: "F-0 machine labels (OC36) and C-3 merged"
    success: "100% of readable labels have a catalog id or not-in-catalog"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S54"
  - id: S22
    phase: PH2
    title: "E-1 pixels vs inference (capture protocol)"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 27
    moves_to: 35
    deliverable: "evals/E1/ and the docs/gates/G-E1.md packet"
    entrance: "P-4, V-2 and V-3 merged; a heavy-compute slot"
    success: "Run record committed; G-E1 packet written"
    check: "pnpm test && test -d evals/E1"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S21"
  - id: S23
    phase: PH2
    title: "E-2 which detector (feeds G-P)"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 35
    moves_to: 44
    deliverable: "evals/E2/ and docs/gates/G-P.md (detector rule applied)"
    entrance: "P-4, V-2 and V-3 merged; a heavy-compute slot"
    success: "Pre-registered G-P detector rule applied to a recorded run"
    check: "pnpm test && test -d evals/E2"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S21"
  - id: S24
    phase: PH2
    title: "E-3 which OCR (feeds G-P)"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 44
    moves_to: 53
    deliverable: "evals/E3/ and the G-P OCR rule applied"
    entrance: "P-1, V-2 and V-3 merged; checklist #7 key and ceiling"
    success: "Pre-registered G-P OCR rule applied to a recorded run"
    check: "pnpm test && test -d evals/E3"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S21"
  - id: S25
    phase: PH3
    title: "I-1 candidate retrieval"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 52
    moves_to: 57
    deliverable: "PR adding retrieval-only identify"
    entrance: "C-3 and P-4 merged; G-P recorded"
    success: "Retrieval-only top-1 and top-5 on the fixture recorded"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S18"
  - id: S26
    phase: PH3
    title: "I-2 joint shelf assignment, copies allowed (INV-4)"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 57
    moves_to: 63
    deliverable: "PR adding the joint assignment step"
    entrance: "I-1 merged"
    success: "Fixture top-1 recorded against I-1 alone"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S25"
  - id: S27
    phase: PH3
    title: "I-3 bands, reasons, work items"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 63
    moves_to: 68
    deliverable: "PR adding src/identify/bands.ts"
    entrance: "I-2 merged"
    success: "Band distribution and pre-adjudicator wrong-but-confident rate recorded"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S26"
  - id: S28
    phase: PH3
    title: "I-4 bounded adjudicator"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 68
    moves_to: 72
    deliverable: "PR adding the one bounded LLM step with a fake model client"
    entrance: "I-3 merged; G-R ruled; checklist #7"
    success: "Tests pass with the fake client; one live call recorded with tokens"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S27"
  - id: S29
    phase: PH3
    title: "I-5 expensive-pass scheduler and reactivation"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 72
    moves_to: 75
    deliverable: "PR adding the scheduler and trigger-event reactivation"
    entrance: "I-4 merged"
    success: "Budget exhaustion pauses; trigger events reactivate (INV-1, INV-2)"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S28"
  - id: S30
    phase: PH3
    title: "E-4 does the LLM earn its cost (feeds G-E4)"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 53
    moves_to: 62
    deliverable: "evals/E4/ and the docs/gates/G-E4.md packet"
    entrance: "I-4 and I-5 merged"
    success: "Run record committed; packet written"
    check: "pnpm test && test -d evals/E4"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S29"
  - id: S31
    phase: PH3
    title: "E-5 should context ever touch identity (feeds G-E5)"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 62
    moves_to: 70
    deliverable: "evals/E5/ and the docs/gates/G-E5.md packet"
    entrance: "I-4 merged; R-1 profile"
    success: "Run record committed; packet written"
    check: "pnpm test && test -d evals/E5"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S28"
  - id: S32
    phase: PH4
    title: "R-2 ranking with rationale and location"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 75
    moves_to: 83
    deliverable: "PR adding src/recommend/rank.ts"
    entrance: "R-1, O-4 and I-3 merged; R-0 ruled"
    success: "The fixture run yields a ranked list with a rationale and location per entry"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S27"
  - id: S33
    phase: PH4
    title: "R-3 corrections and preferences"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 83
    moves_to: 87
    deliverable: "PR adding correction and not-for-me commands"
    entrance: "I-5 and R-2 merged"
    success: "INV-7: not-for-me leaves identity unchanged; a correction leaves the profile unchanged"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S32"
  - id: S34
    phase: PH4
    title: "W-2 report integration: recommendations and the unresolved queue"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 87
    moves_to: 92
    deliverable: "PR extending the report with recommendations, click-to-locate and work items"
    entrance: "W-1, R-2 and R-3 merged"
    success: "A proxy-image report shows recommendations and the unresolved queue"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S33"
  - id: S35
    phase: PH4
    title: "M-1 MVP run on the fixture"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 92
    moves_to: 100
    deliverable: "evals/MVP/ and the docs/gates/G-MVP.md packet"
    entrance: "S6 and S7 exits; G-E4 and G-E5 ruled"
    success: "Run record and packet committed; spend under the ceiling"
    check: "pnpm test && test -f docs/gates/G-MVP.md"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S30"
  - id: S36
    phase: PH4
    title: "D-1 runbook and handoff"
    advances: "ns:l1-bookcase-discovery#P3"
    moves_from: 30
    moves_to: 50
    deliverable: "docs/RUNBOOK.md and docs/plan/HANDOFF.md"
    entrance: "G-MVP ruled (and G-LIVE, or its miss recorded)"
    success: "Files committed; the owner has read them"
    check: "test -f docs/RUNBOOK.md && test -f docs/plan/HANDOFF.md && pnpm guard"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S35"
  - id: S37
    phase: PH4
    title: "D-2 architecture ADR into core"
    advances: "ns:l1-bookcase-discovery#P3"
    moves_from: 50
    moves_to: 60
    deliverable: "PR on ojfbot/core adding the BookcaseDiscovery architecture ADR"
    entrance: "G-MVP ruled"
    success: "The ADR PR is open on core"
    check: "node scripts/northstar-lint.mjs && node scripts/roadmap-lint.mjs"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    repo: core
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S35"
  - id: S38
    phase: PH5
    title: "T-0 live-stream contracts"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "contracts/ live schemas with Zod checks"
    entrance: "L-1 merged"
    success: "Examples validate; equal-condition readings count once (INV-20); replay byte-identical"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S2"
  - id: S39
    phase: PH5
    title: "T-1 capture-live Mac harness (Continuity Camera)"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "docs/live/continuity-camera-formats.md and evals/live-A/ timestamps"
    entrance: "T-0 merged; the owner pairs the iPhone as Continuity Camera"
    success: "A 20-second clip replays through the core with identical events"
    check: "pnpm test && test -f docs/live/continuity-camera-formats.md"
    autonomy: gate-0
    claimable_by: human_only
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S38"
  - id: S40
    phase: PH5
    title: "T-2 tracker and debounce"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "evals/live-A/tracker.json"
    entrance: "T-0; a detector that emits OBB (P-2 or P-4); a recorded clip (T-1) or proxy video"
    success: "ID switches and fragmentation per arm recorded; no per-frame event written"
    check: "pnpm test && test -f evals/live-A/tracker.json"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S39"
  - id: S41
    phase: PH5
    title: "T-3 best-frame selection and OCR fusion"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "evals/live-A/ocr-fusion.json"
    entrance: "T-2 merged; P-1"
    success: "CER of fast, accurate and fused readings recorded"
    check: "pnpm test && test -f evals/live-A/ocr-fusion.json"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S40"
  - id: S42
    phase: PH5
    title: "T-4 streaming identify and cards"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "evals/live-A/cards.json"
    entrance: "T-3 merged; C-3; I-3 (I-4 or a stub)"
    success: "Card timeline with revisions and RBO; replay byte-identical; the adjudicator never blocks the loop"
    check: "pnpm test && test -f evals/live-A/cards.json"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S41"
  - id: S43
    phase: PH5
    title: "U-1 live overlay UX research (owner-launched design sessions)"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "docs/live/overlay-ux.md landed by the conductor"
    entrance: "None to start; T-0 vocabulary when merged"
    success: "Direction, lens set, k, label states and INV-24 parameters; the owner rules section 9"
    check: "test -f docs/live/overlay-ux.md"
    autonomy: gate-0
    claimable_by: human_only
    kind: s
    status: delivered
  - id: S44
    phase: PH5
    title: "T-5 Mac live overlay and card panel"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "PR adding the Mac overlay; a private screen-recording link"
    entrance: "T-4 merged; U-1 ruled (or OC30 defaults)"
    success: "Labels persist through a lost detection; every revision shows its badge; INV-24 flapping test"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S42"
  - id: S45
    phase: PH5
    title: "T-6 Core ML export, Swift OBB decode, on-device benchmark"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "evals/live-B/coreml-bench.json and the decode package"
    entrance: "F-2 (or P-2 proxy weights); checklist #0c phone; G-LIC ruled"
    success: "p50/p95 per size and quantization on the named iPhone; decode matches the Python decoder"
    check: "pnpm test && test -f evals/live-B/coreml-bench.json"
    autonomy: gate-0
    claimable_by: human_only
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S58"
  - id: S46
    phase: PH5
    title: "U-2 guided sweep UX (owner-launched design session)"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "docs/live/guided-sweep-ux.md landed by the conductor"
    entrance: "U-1 direction A ruled"
    success: "Guided sweep spec with an owner ruling"
    check: "test -f docs/live/guided-sweep-ux.md"
    autonomy: gate-0
    claimable_by: human_only
    kind: s
    status: delivered
    depends_on: "rm:rm-l1-bookcase-discovery#S43"
  - id: S47
    phase: PH5
    title: "U-3 chat layer UX: clarify-by-tap and taste tree"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "docs/live/chat-002-ux.md and docs/recommend/taste-tree-ux.md landed by the conductor"
    entrance: "U-1 ruled; R-0 vocabulary"
    success: "Both specs with owner rulings"
    check: "test -f docs/live/chat-002-ux.md && test -f docs/recommend/taste-tree-ux.md"
    autonomy: gate-0
    claimable_by: human_only
    kind: s
    status: delivered
    depends_on: "rm:rm-l1-bookcase-discovery#S43"
  - id: S48
    phase: PH5
    title: "T-9 guided sweep mode on the phone"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "evals/live-B/sweep.json and the sweep mode in apps/live-ios"
    entrance: "T-7a and T-4 merged; U-2 ruled"
    success: "Hold, pan, release returns results and a scrub-back replay (OC31)"
    check: "pnpm test && test -f evals/live-B/sweep.json"
    autonomy: gate-0
    claimable_by: human_only
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S50"
  - id: S49
    phase: PH5
    title: "T-8 FTS5 on iOS probe"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "docs/live/fts5-ios.md"
    entrance: "C-3 merged; checklist #0c phone"
    success: "Version, compile options, query timings and the on-device-or-link decision"
    check: "test -f docs/live/fts5-ios.md && pnpm guard"
    autonomy: gate-0
    claimable_by: human_only
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S12"
  - id: S50
    phase: PH5
    title: "T-7a apps/live-ios capture, detect, track, overlay"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "apps/live-ios and evals/live-B/overlay.json"
    entrance: "G-SURF; T-6; T-2; U-1; T-0 schemas"
    success: "Boxes and labels stick on the phone; per-stage latencies recorded"
    check: "pnpm test && test -f evals/live-B/overlay.json"
    autonomy: gate-0
    claimable_by: human_only
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S45"
  - id: S51
    phase: PH5
    title: "T-7b apps/live-ios OCR, lookup and cards"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "evals/live-B/cards.json and evals/live-B/ocr.json"
    entrance: "T-7a; T-8; T-4; R-1 seeds"
    success: "Time to first useful card, revision rate and CER recorded; the G-LIVE demo"
    check: "pnpm test && test -f evals/live-B/cards.json"
    autonomy: gate-0
    claimable_by: human_only
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S50"
  - id: S52
    phase: PH5
    title: "V-5 video fixtures and the live scorer"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 70
    moves_to: 75
    deliverable: "docs/live/metrics.md and the live scorer"
    entrance: "O-6 clips ingested by K-3; C-3; V-2"
    success: "Labels for ≥3 clips; the scorer passes on a synthetic clip; every metric defined"
    check: "pnpm test && test -f docs/live/metrics.md"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S7"
  - id: S53
    phase: PH5
    title: "E-6 live vs still on the same shelf (feeds G-LIVE)"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 75
    moves_to: 82
    deliverable: "evals/E6/ and the docs/gates/G-LIVE.md packet"
    entrance: "T-7b and V-5 merged; E-1 to E-3 records; O-7 targets set first"
    success: "Each G-LIVE metric marked met or missed with its number"
    check: "pnpm test && test -d evals/E6 && test -f docs/gates/G-LIVE.md"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S51"
  - id: S54
    phase: PH2
    title: "F-0 machine labelling with open-weight models (OC34, OC36)"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 5
    moves_to: 12
    deliverable: "evals/F0/ aggregates: yardstick box recall and precision, title and author accuracy, catalog-confirmed share"
    entrance: "K-3, H-0, P-1 and C-3 merged"
    success: "Labels scored on a yardstick the stack did not produce; spend per spine recorded"
    check: "pnpm test && test -d evals/F0"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: dispatched
    depends_on: "rm:rm-l1-bookcase-discovery#S55"
  - id: S55
    phase: PH2
    title: "H-0 open-weight labelling stack and public yardstick (OC36)"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 2
    moves_to: 5
    deliverable: "docs/models/open-weights.md"
    entrance: "docs/licences.md (C-0)"
    success: "Sourced tables, a recommended stack, a yardstick and an approved download list"
    check: "test -f docs/models/open-weights.md && pnpm guard"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: merged
    depends_on: "rm:rm-l1-bookcase-discovery#S10"
  - id: S56
    phase: PH2
    title: "V-6 yes/no tap check (optional, OC36)"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 12
    moves_to: 14
    deliverable: "bookcase taps and an aggregate in evals/"
    entrance: "F-0 has machine labels on pilot-000"
    success: "Seeded uniform sampling; one answer is one event; no per-spine rows in the aggregate"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: human_only
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S54"
  - id: S57
    phase: PH6
    title: "F-1 dataset manifest, grouped splits, near-duplicate flags"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 82
    moves_to: 86
    deliverable: "bookcase dataset build"
    entrance: "K-3 merged; V-2"
    success: "No group straddles splits; the guard rejects media and weights under datasets/"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S20"
  - id: S58
    phase: PH6
    title: "F-2 training pipeline on MPS and the model registry"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "models/registry/<id>.json and evals/F2/"
    entrance: "F-0 catalog-confirmed labels; F-1; P-2; G-LIC ruled; a heavy slot"
    success: "Held-out mAP-OBB and recall per size; the record names the licence path"
    check: "pnpm test && test -d evals/F2"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S54"
  - id: S59
    phase: PH6
    title: "F-3 prefill later fixtures from the trained detector"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 0
    deliverable: "Prefill wired into the labelling stack"
    entrance: "F-2 merged; a second fixture exists"
    success: "Prefill appears on a second-fixture photo; export round-trips"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: s
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S58"
  - id: S60
    phase: PH6
    title: "F-4 held-out harness over stills and clips"
    advances: "ns:l1-bookcase-discovery#P2"
    moves_from: 86
    moves_to: 100
    deliverable: "bookcase eval --model and evals/models/"
    entrance: "F-2, V-2 and V-5 merged"
    success: "F-2 and P-2 models scored the same way, labelled dev-set or held-out"
    check: "pnpm test && test -d evals/models"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: "rm:rm-l1-bookcase-discovery#S58"
---
# Roadmap — BookcaseDiscovery (L1)

**Route.** Foundations, catalog and perception spikes run in parallel on synthetic and proxy data while the owner shoots one real bookcase; open models label it (OC36), the experiments then pick defaults, identify is built behind the reconciliation gate, and the MVP run is judged by the owner. The live track and the flywheel run beside the batch path and meet it at G-LIVE.

The plan is canonical in `docs/plan/DELIVERY-PLAN.md`; this file is its fleet projection. Card names lead every slice title so the two stay joinable. Each slice carries one `depends_on` edge (the registry parser reads a scalar); the card's other prerequisites are in `entrance`. Movement numbers are proposals; nothing moves until a merge records it.

## PH1 — Foundations, catalog and perception spikes (S0–S3)

The privacy guard (S1) goes first because the repo is public. Contracts (S2) unblock nearly every build card: the ledger, ingest, the report scaffold, the OCR helper and the live contracts. The catalog chain C-0 → C-1 → C-3 → R-1 gives fragment retrieval and the reading profile. Perception (P-1 ∥ P-2 → P-4) produces traceable observations on PROXY images; P-3 is registered but runs only if E-2 triggers it.

## PH2 — Fixture and M1 (S4–S5)

The owner lane: verified originals (K-2), ingest (K-3, which ran first on `pilot-000`), then machine labels from the open-weight stack H-0 chose (F-0, in flight) instead of hand labelling (OC36). V-3 resolves labels to catalog ids; E-1 to E-3 pick the perceive defaults under the pre-registered G-P rule. V-6 taps are optional and only sharpen the real-use number.

## PH3 — Identify (S6)

Retrieval, joint shelf assignment and bands (I-1 → I-2 → I-3) run before the G-R ruling; the bounded adjudicator and the scheduler (I-4, I-5) wait for it. E-4 and E-5 put the LLM step and the context wall on the record for G-E4 and G-E5.

## PH4 — Recommend and MVP (S7–S8)

Ranking with rationale and location, corrections, and report integration lead to the M-1 run that the owner judges at G-MVP. D-1 writes the runbook and handoff; D-2 lands the architecture ADR in core.

## PH5 — Live track (S9)

Stage A (T-0 to T-5) proves the streaming stage graph on a Mac with the phone as Continuity Camera; Stage B (T-6, T-8, T-7a, T-7b, T-9) moves the loop onto the phone after G-SURF and a fixture-trained detector. U-1 to U-3 are owner-launched design sessions whose specs the conductor lands. These build slices advance P1 with zero proposed movement: P1 as approved is the batch report, and whether the live experience gets its own property (P4, `NORTHSTAR-PROPOSAL.md` §5) is pending the owner. V-5 and E-6 measure the stream and advance P2.

## PH6 — Flywheel (S10)

Grouped splits (F-1), training on MPS with a registry record (F-2), prefill for later shoots (F-3) and one held-out harness over stills and clips (F-4). F-4 is where P2's held-out clause is met.
