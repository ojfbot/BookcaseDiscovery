# G-SWEEP · The sweep gate (replaces G-LIVE)

**Status: proposed 2026-11-05 by the capture sub-conductor. The owner approved the S9 re-plan (PR #77) and ruled the four questions below on 2026-11-05; the gate itself is not yet ruled (no evidence exists).** The owner decided on 2026-11-05 that a
sweep gate replaces G-LIVE and that G-V2 opens there. This packet holds the gate's question, measures, the targets the
owner sets **before** the write-up exists, and four rulings the programme needs now. Evidence is added when V-5′ and
E-6′ run. The plan text is `docs/plan/DELIVERY-PLAN.md` S9.

## Question

Does the casual, uncoached natural sweep on one bookcase, on a phone **without** metric depth (the degraded tier,
held out by case and session), handle each visible physical book as a discrete, bounded, identified object to the
owner's targets, and what does the G-V2 packet inherit?

## Measures

Every measure is a distribution with its truth source named (INV-17, INV-23). Metric-depth and degraded-tier results
are reported apart; the gate judges on the degraded tier (OC35, OC39). A simulated degraded tier (depth withheld from
Pro captures) is labelled as such and is never the gate's real-use number.

| # | Measure | Definition | Truth source |
|---|---|---|---|
| 1 | Instance recall | Visible physical books that end the sweep as exactly one track carrying one identity at `text-read` or above, over all visible physical books | Exact on the lab's synthetic replays (stable physical ids); on a real case, the per-case union of books across every still and sweep of that case, labelled machine agreement |
| 2 | ID switches, fragmentation, copy swaps | ID switches per track and per minute (TrackEval IDSW, IDF1, HOTA); tracks per physical book; adjacent copies of one work whose tracks merge or exchange identities | Exact on lab replays; on real clips, the share of same-work neighbour pairs (F-0g copy groups) whose tracks merge or swap |
| 3 | Text | Fused reading CER on tracks against the still path's accurate reading on 48 MP of the same spines; `text-read` share per case | Paired, same case, same visit |
| 4 | Time to first card | Sweep start to first useful cheap-pass card, and to first confirmed identity; glass-to-glass only where an on-device loop exists | Replay with per-stage timestamps |
| 5 | Thermal | `ProcessInfo` thermal state timeline over at least three minutes of sweep at 4K; dropped frames; 4K→1080p fallback events; battery per minute | NS-9 benchmark and the device logger |

Reported, not gated: spend per sweep; unknowns with reason (OC32); spatial coverage (`seen`) apart from identity
resolution.

## Targets (owner sets these before `evals/E6/` exists)

Proposed ranges are proposals, not measurements. The owner picks a number and a percentile per row. Replaces O-7 and
checklist #16.

| Measure | Proposed range (label: proposal) | Owner's target | Percentile | Date |
|---|---|---|---|---|
| Instance recall, degraded tier | within 10 points of the still path's confirmed-plus-readable share on the same case | | | |
| ID switches per track | p95 ≤ 1 | | | |
| Copy swaps | 0 on lab replays; ≤ 2 % of neighbour pairs on real clips | | | |
| Fused CER vs the still path | within 10 % relative | | | |
| Time to first useful card | ≤ 3 s | | | |
| Thermal | no `.serious` state within 3 minutes at 4K; fallback recorded | | | |

## Rulings needed now

Each is one question with buttons. The recommended option is first. Record the ruling in this file, dated.

### Ruling 1 · What does green mean on glass? — **Ruled 2026-11-05: `text-read`, measured after each sweep.**

The cheap-signal student that would predict a per-book fill is NO-GO twice (Q-2 AUC 0.729, Q-2b 0.711, bar 0.75).
Q-0's fill line is `text-read`: re-panning cannot fix a catalog gap, so the fill must not ask for it.

- **`text-read`, measured after each sweep** (recommended): the fill shows `seen` while panning and fills a segment
  only when the processed sweep reads its text; identity stays with U-1's lenses.
- **`seen` only** until a student passes its bar: honest, but the fill then says nothing about reading.
- **`confirmed` only**: the app would ask shoppers to re-sweep catalog gaps forever.

### Ruling 2 · Haptics granularity — **Ruled 2026-11-05: one notification haptic per completed bay or shelf.**

The HIG says haptics "complement other feedback", warns against overuse, and reserves notification haptics for the
outcome of a task. Sommy ticks per label.

- **One notification haptic per completed bay or shelf** (recommended): a dense shelf would turn per-book ticks into
  noise.
- **Per book**, as Sommy does.
- **None**; visual and VoiceOver only.

### Ruling 3 · Relocalization — **Ruled 2026-11-05: hide, then redisplay the coverage segments in place; Start Over is never automatic.**

After ARKit loses and regains tracking, the HIG says to hide virtual objects and redisplay them in their new
positions, and to wait up to one second before fading.

- **Hide, then redisplay the coverage segments in place** (recommended); the session continues; a Start Over control
  exists but is never automatic.
- **Start Over begins a `new-session`**: simpler, loses the sweep's coverage.
- **Ask each time** tracking is regained.

### Ruling 4 · Degraded-tier simulation protocol until a borrowed non-Pro session exists — **Ruled 2026-11-05: withhold depth from Pro captures at ingest, reported as a simulation, replaced by real non-Pro sessions at the gate.**

- **Withhold depth from Pro captures at ingest** (recommended): same frames, depth and confidence masked, run through
  the degraded path; reported as "simulated degraded tier", never as a real-use number; the first real non-Pro
  sessions replace it at the gate.
- **Wait** for non-Pro sessions before any degraded-tier number is reported.
- **Use ultra-wide frames as the degraded proxy**: ARKit depth may be Wide-camera only, so ultra-wide frames carry no
  depth anyway; this is a hypothesis the NS-6 logger would first have to confirm.

### Carried from U-2's open questions (take the spec's proposals until ruled)

Which mode opens first (1); pause auto-finish (2); processing on device only or also over the local link (5); crash
during processing (6); libraries' "Save" and call numbers (9); multi-pass layout (10); time-to-result frame (12).
Questions 8 ("too slow" cue) and 11 (pacer as training) are moot under the natural sweep.

### Also owed

The U-1/U-2 amendments from the seed: a glare cue; the two-level low-light vs too-dark split; a CVD-safe pair plus
shape for U-1's amber-vs-green status pill; a per-bay done event; gap markers on unresolved segments; the fill driven
by recognition rungs only, never by taste (INV-13). One ruling, after rulings 2 and 3.

## Evidence

To be added: `evals/E6/` (E-6′), the V-5′ run record, the replay demo link (private).

## Ruling

The gate is not yet ruled. Owner rulings 1–4 above were given on 2026-11-05 in the capture sub-conductor's session, each on the recommended option; the sweep targets are still to be set.
