# Northstar and roadmap proposal — BookcaseDiscovery (TEXT ONLY, not registered)

Planning output, 2026-10-31 (Opus 5.5 draft; **checked against core's registry schema by the Fable 5.1 pass** the same evening — §4 lists what the check added). **Owner-approved as proposed on 2026-10-31** (checklist #13): Card Z-2 writes these files and the core registry entries once Z-0 lands. Format: `core/decisions/northstar/template.md` and `roadmap-schema.md` v1.1. **Numeric currents and targets are proposals for the owner to calibrate.**

The ladder targets were checked on disk on 2026-10-31. `ns:l2-ojfbot#P1` and `ns:l2-ojfbot#P2` exist in `core/decisions/northstar/l2-ojfbot.md`. Every recent L1 ladders directly to `l2-ojfbot` (there is no cluster tier), and the `l1-<app>` slug is the convention; both are followed here. `posture: active` is used on recent registry entries but is undocumented in the schema; it is optional.

## 1. Northstar file — `BookcaseDiscovery/.claude/northstar.md`

```yaml
---
type: northstar
slug: l1-bookcase-discovery
tier: L1
app: BookcaseDiscovery
ladders_up_to: l2-ojfbot
status: active
properties:
  - id: P1
    name: "A photographed bookcase becomes located, explained recommendations"
    target: "On a real bookstore bookcase, ingest → run → report yields a ranked, explained recommendation list where every entry highlights its spine in the source photo, and unresolved spines stay visible with reasons; accepted by the owner at G-MVP."
    current: 0
    verification: "G-MVP ruling in docs/gates/G-MVP.md plus the evals/MVP/ run record."
    ladders_up_to: "ns:l2-ojfbot#P1"
  - id: P2
    name: "Recognition quality is measured, not asserted"
    target: "Every perceive/identify default is chosen from a recorded run against owner labels (E1–E5), and accuracy claims cite a held-out fixture (sf-store-002), not the dev set."
    current: 0
    verification: "evals/ holds E1–E5 + MVP + held-out run records with commit and helper versions; G-P/G-E4/G-E5 packets cite them."
    ladders_up_to: "ns:l2-ojfbot#P2"
  - id: P3
    name: "Built in public without leaking private data"
    target: "Public repo with plan, gates and aggregate evals; the privacy guard is green on every PR and on full history; M1 and MVP are posted to the Newline community by the owner."
    current: 0
    verification: "pnpm guard --history clean on main; CI guard job required; the owner confirms the M1 and MVP posts."
    ladders_up_to: "ns:l2-ojfbot#P1"
---

# Northstar — BookcaseDiscovery (L1)

**Vision.** Photograph a bookstore bookcase and walk out knowing which spines are worth pulling: it identifies books from partial evidence, never forces a match, keeps recognising after the first good recommendations, and explains every pick against my own tastes. It is built in public as a measured, teachable example of a pipeline plus one bounded LLM step.

## P1 — A photographed bookcase becomes located, explained recommendations
The usable surface is the local HTML report: every spine boxed with status and band, each recommendation explained and clickable to its spine, unresolved spines listed with reasons. Movement is recorded at G-M1 (traceable observations) and G-MVP (accepted recommendations).

## P2 — Recognition quality is measured, not asserted
No perceive or identify default is chosen without a recorded run against the owner's labels. Dev-set numbers are labelled as such; accuracy claims wait for the held-out fixture.

## P3 — Built in public without leaking private data
The repo, plan, gates and aggregate evals are public. ChatGPT-derived and SelfCo data never enter git; photos, crops and labels stay private until the G-PUB release. The guard runs on every PR and on full history.
```

**Open calibration points for the owner:**
- P3's ladder: `#P1` usable surfaces, or `#P2` traceable work? The proposal is `#P1`.
- Whether P2's held-out clause belongs in the MVP northstar or later.
- **The P2 ladder to `ns:l2-ojfbot#P2` is a stretch.** L2-P2 is about work tracing to a measurable northstar property; BookcaseDiscovery P2 is about eval accuracy. Z-2 records it as a `strain` ladder-stress verdict (§4) unless the owner picks a different parent.

## 2. Roadmap file — `BookcaseDiscovery/.claude/roadmap.md` (shape; Z-2 fills every slice)

```yaml
---
type: roadmap
slug: rm-l1-bookcase-discovery
northstar: l1-bookcase-discovery
status: active
phases:
  - id: PH1
    name: "Foundations, catalog and perception spikes (S0–S3)"
    goal: "Synthetic end-to-end passes; catalog golden set ≥90% top-5; perceive writes traceable observations on proxy images; privacy guard live."
  - id: PH2
    name: "Fixture and M1 (S4–S5)"
    goal: "sf-store-001 labelled; E1–E3 recorded; G-M1 accepted."
  - id: PH3
    name: "Identify (S6)"
    goal: "Bands, assignment, adjudicator per G-R; E4/E5 ruled."
  - id: PH4
    name: "Recommend and MVP (S7–S8)"
    goal: "G-MVP accepted; runbook and handoff written."
slices:
  # One slice per dispatched card, ids assigned once in card order. Two shown as examples.
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
    status: queued
  - id: S2
    phase: PH1
    title: "L-1 contracts (JSON Schema source) and CONTEXT.md glossary"
    advances: "ns:l1-bookcase-discovery#P1"
    moves_from: 0
    moves_to: 5
    deliverable: "PR adding contracts/, src/ledger/contracts.ts, CONTEXT.md, docs/contracts.md"
    entrance: "Z-0 bootstrap merged"
    success: "Examples validate; no `exhausted` status; Zod agrees with JSON Schema"
    check: "pnpm test"
    autonomy: gate-0
    claimable_by: agent_eligible
    kind: m
    status: queued
    depends_on: ["rm:rm-l1-bookcase-discovery#S1"]
---

# Roadmap — BookcaseDiscovery (L1)

**Route.** Foundations, catalog and perception spikes run in parallel on synthetic and proxy data while the owner shoots and labels one real bookcase; the experiments then pick defaults, identify is built behind the reconciliation gate, and the MVP run is judged by the owner.

## PH1 — Foundations, catalog and perception spikes (S0–S3)
## PH2 — Fixture and M1 (S4–S5)
## PH3 — Identify (S6)
## PH4 — Recommend and MVP (S7–S8)
```

(The body after the frontmatter is required by `roadmap-schema.md`; the Opus draft omitted it.)

**Rules for Z-2 when it fills the remaining slices:**
- `advances`:
  - **P1** for build cards (L-, K-, P-, C-, I-, R-, W-, M-);
  - **P2** for experiment and eval cards (V-2, V-3, E-*);
  - **P3** for Z-1 and the curriculum/handoff cards.
- `moves_to` increments are proposals that sum to each P's MVP value. They are recorded only on merge, by the merging human (movement contract).
- Owner cards (O-*) are **not** slices: they produce no PR. They stay in `DELIVERY-PLAN.md` and appear as `entrance` conditions on the slices they unblock.
- `depends_on` is a typed ref even within the same roadmap: `rm:rm-l1-bookcase-discovery#S<n>`. It is pairwise with no transitivity, so the chains in `DELIVERY-PLAN.md` §4 are flattened to direct edges only.
- Every agent-dispatched slice needs a machine-runnable `check:`; a slice without one is demoted to `human_only` at compile time. Experiment slices use their scorer command (`bookcase score … && test -f evals/E<n>/metrics.json`).
- V-1b and P-3 are conditional cards: register them as slices with `status: queued` and an `entrance` naming the trigger, so the roadmap stays honest about what may not run.

## 3. Registry entries (core `decisions/northstar/README.md` frontmatter)

```yaml
  # BookcaseDiscovery: public build-in-public bookstore discovery engine (planned 2026-10-31,
  # Opus 5.5 draft revised by Fable 5.1; plan canonical in BookcaseDiscovery/docs/plan/).
  # NUMERIC CURRENTS/TARGETS ARE PROPOSALS (operator to calibrate).
  - slug: l1-bookcase-discovery
    tier: L1
    app: BookcaseDiscovery
    path: ../BookcaseDiscovery/.claude/northstar.md
    ladders_up_to: l2-ojfbot
    posture: active
```

```yaml
  - slug: rm-l1-bookcase-discovery
    northstar: l1-bookcase-discovery
    path: ../BookcaseDiscovery/.claude/roadmap.md
```

The README's comments note that trailing comments break the frontmatter parser, so these comments are full-line only. The slug is immutable once landed; settle `l1-bookcase-discovery` and `app: BookcaseDiscovery` before Z-2.

## 4. Ladder-stress verdicts (the registry's one hard landing requirement; the Opus draft missed it)

`core/decisions/northstar/schema.md` requires one ladder-stress verdict per parent property laddered to, appended to `decisions/northstar/ladder-stress.jsonl` at land time; a missing verdict rejects the land. Z-2 appends two lines (fields `{date, app, northstar, parent, verdict, reason, actor}`; a reason is required unless the verdict is `clean`):

```jsonl
{"date":"<land date>","app":"BookcaseDiscovery","northstar":"l1-bookcase-discovery","parent":"ns:l2-ojfbot#P1","verdict":"clean","reason":"","actor":"<conductor or owner>"}
{"date":"<land date>","app":"BookcaseDiscovery","northstar":"l1-bookcase-discovery","parent":"ns:l2-ojfbot#P2","verdict":"strain","reason":"L2-P2 is about work tracing to a measurable property; BookcaseDiscovery P2 measures recognition accuracy. The fit is that every default is chosen from a recorded run, which is traceable work; the strain is that the parent does not speak of model quality.","actor":"<conductor or owner>"}
```

**No `status.jsonl` row at registration.** Registration is not movement; rows come later from `scripts/record-movement.mjs` at merges. All `current: 0` values are consistent with that.

**Z-2's exact write list:** `BookcaseDiscovery/.claude/northstar.md` (frontmatter + body above), `BookcaseDiscovery/.claude/roadmap.md` (frontmatter + body above, every slice filled), the two README frontmatter entries in §3, the two `ladder-stress.jsonl` lines, then `node scripts/northstar-lint.mjs && node scripts/roadmap-lint.mjs` from core with 0 ERRORs.

## 5. Proposed addition from the gap cycle (2026-10-31, late) — **pending the owner; not part of the approved text**

The owner approved P1–P3 as proposed. The live experience (OC24) is not expressed by them: P1 speaks of a *photographed* bookcase and a report. If the owner wants the northstar to carry the goal experience, Z-2 adds a fourth property; otherwise the live track advances P1 and P2 as written and the northstar is revised after G-LIVE.

```yaml
  - id: P4
    name: "A shelf in view becomes labelled spines and revising cards, live"
    target: "On the owner's phone, pointed at a real bookstore bookcase, spine labels appear within the owner's latency targets and stay with the spines as the camera moves; recommendation cards appear, rank and revise with every revision shown; measured on recorded sweep clips and accepted at G-LIVE."
    current: 0
    verification: "G-LIVE ruling in docs/gates/G-LIVE.md plus evals/E6/ and evals/live-B/ run records with the owner's targets recorded before the result."
    ladders_up_to: "ns:l2-ojfbot#P1"
```

Slice rules if P4 is adopted: S9 build cards (T-*) advance P4; V-5, E-6 and F-* advance P2; G-W-related work advances P3. Ladder-stress verdict for `ns:l2-ojfbot#P1` is already `clean`; no new parent is laddered to, so no new jsonl line is needed. If P4 is declined, T-* cards advance P1 with `moves_to` increments the owner calibrates.
