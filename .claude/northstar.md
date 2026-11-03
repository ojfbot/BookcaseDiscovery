---
type: northstar
slug: l1-bookcase-discovery
tier: L1
app: BookcaseDiscovery
ladders_up_to: l2-ojfbot
status: active
# Registered 2026-11-02 by card Z-2 from docs/plan/NORTHSTAR-PROPOSAL.md, owner-approved as
# proposed on 2026-10-31 (checklist #13): P3 ladders to #P1; the P2 ladder to #P2 is a recorded
# strain (core decisions/northstar/ladder-stress.jsonl).
# NUMERIC CURRENTS/TARGETS ARE PROPOSALS (owner to calibrate). current: 0 everywhere because
# registration is not movement; movement is recorded at merges (core scripts/record-movement.mjs).
# OC36 (2026-11-02, no hand labelling): in P2, "owner labels" now reads as the F-0 machine labels,
# scored on H-0's public yardstick and, when they exist, the owner's optional V-6 taps.
properties:
  - id: P1
    name: "A photographed bookcase becomes located, explained recommendations"
    target: "On a real bookstore bookcase, ingest → run → report yields a ranked, explained recommendation list where every entry highlights its spine in the source photo, and unresolved spines stay visible with reasons; accepted by the owner at G-MVP."
    current: 0
    verification: "G-MVP ruling in docs/gates/G-MVP.md plus the evals/MVP/ run record."
    ladders_up_to: "ns:l2-ojfbot#P1"
    okr_drivers: []
  - id: P2
    name: "Recognition quality is measured, not asserted"
    target: "Every perceive/identify default is chosen from a recorded run against owner labels (E1–E5), and accuracy claims cite a held-out fixture (sf-store-002), not the dev set."
    current: 0
    verification: "evals/ holds E1–E5 + MVP + held-out run records with commit and helper versions; G-P/G-E4/G-E5 packets cite them."
    ladders_up_to: "ns:l2-ojfbot#P2"
    okr_drivers: []
  - id: P3
    name: "Built in public without leaking private data"
    target: "Public repo with plan, gates and aggregate evals; the privacy guard is green on every PR and on full history; M1 and MVP are posted to the Newline community by the owner."
    current: 0
    verification: "pnpm guard --history clean on main; CI guard job required; the owner confirms the M1 and MVP posts."
    ladders_up_to: "ns:l2-ojfbot#P1"
    okr_drivers: []
---

# Northstar — BookcaseDiscovery (L1)

**Vision.** Photograph a bookstore bookcase and walk out knowing which spines are worth pulling: it identifies books from partial evidence, never forces a match, keeps recognising after the first good recommendations, and explains every pick against my own tastes. It is built in public as a measured, teachable example of a pipeline plus one bounded LLM step.

## P1 — A photographed bookcase becomes located, explained recommendations
The usable surface is the local HTML report: every spine boxed with status and band, each recommendation explained and clickable to its spine, unresolved spines listed with reasons. Movement is recorded at G-M1 (traceable observations) and G-MVP (accepted recommendations).

## P2 — Recognition quality is measured, not asserted
No perceive or identify default is chosen without a recorded run against the owner's labels. Dev-set numbers are labelled as such; accuracy claims wait for the held-out fixture. Since OC36 (2026-11-02) the labels are machine labels (F-0) scored on a public yardstick the labelling stack did not produce (H-0), plus the owner's optional yes/no taps (V-6).

## P3 — Built in public without leaking private data
The repo, plan, gates and aggregate evals are public. ChatGPT-derived and SelfCo data never enter git; photos, crops and labels stay private until the G-PUB release. The guard runs on every PR and on full history.
