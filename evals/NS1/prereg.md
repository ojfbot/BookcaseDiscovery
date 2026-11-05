# NS1: overlap-and-margin arm — pre-registration

Fixed 2026-11-05, before the shoot. **No measurement was taken for this card.** No shoot data exists; the scorer
(`src/eval/ns1.ts`, constants `NS1`) was tested on synthetic label sets only. Nothing below changes after seeing a
result; a change is a deviation in `implementation-notes.md`, and the report (`evals/NS1/report.md`) says which
figures it touches. The arm is in `docs/capture-protocol.md` §4b and §7.

**Question.** How many works does a case's set of 2–3 overlapping unedited stills with margin read at `text-read` or
above, beyond the single whole-case still of the same visit? Motivation: Q-3's `frame-edge` bucket, 885 of 6,064
books (14.6 %; 766–1,006), 638 cut by the frame and 247 in the lens's outer ring (`evals/Q3/report.md`). That bucket
is the ceiling on what margin can recover; a cut book also loses to other causes (98 % of the 787 cut boxes were lost),
so the lift is expected below it (hypothesis).

## Before this was written (pilot-000, private manifest; aggregate counts, not the shoot)

Capture research Q10 asks how many of the 638 cut boxes the owner's crop cut, rather than the sensor frame. The
manifest flags 5 photos as originals (unedited, on the camera's own pixel grid) and 26 as derivatives. **158 cut boxes
lie in the 5 originals: cut by the sensor frame. 480 lie in the 26 derivatives**, whose frame is whatever the export
left. All 31 photos are 3:4 or 4:3, so aspect cannot tell a crop from a resample: between 0 and 480 were cut by the
owner's crop. (Outer ring: 14 in originals, 233 in derivatives.) At least 25 % of the bucket is the sensor's;
the rest is undecided. **Placeholder `NS1-crop-split-26`:** if the owner still has the 26 unmodified originals, export
them, re-ingest, rerun Q-3's frame-cut rule. §1 of the protocol now bans cropping so the next set cannot repeat this.

## Set and strata (OC35, OC39)

A **case** is one physical bookcase (`bookcaseId`). Per case, at one visit: the single whole-case still (`arm:
whole-case`, 48 MP) and 2–3 overlapping stills (`arm: overlap`), shot twice: as **protocol stills** (main 1×,
**controlled**) and as **shopper stills** (§7, handheld, the camera's lens, **real use**). Strata are
`mode | deviceClass` and are never pooled. Every figure is **machine agreement against the case's own union, never
accuracy** (INV-17, OC36). No yardstick, no training, CPU or MPS only.

## Measure (`scoreCase`, `scoreArm`)

- **Work key.** A reading counts under the catalog work id when its box matched or confirmed one, else under a
  `reading:` key of its normalised text. Merged by key across stills, **never by box**: book-level registration is
  unplanned (`docs/capture/coverage.md` §5). Two copies of one work are one key, so copies are undercounted
  and not measured here (INV-25 is G-SWEEP's).
- **Readable** = rung `text-read`, `matched` or `confirmed` (Q-0's fill line). `confirmed` alone is reported beside it.
- **Union** *U* = keys read in any still of the case. *S* = the whole-case still's keys, *O* = the union over its
  overlap stills.
- **Lift** = (|O| − |S|) / |U| per case; **pooled lift** = Σ(|O| − |S|) / Σ|U| per stratum. Also reported: works only
  *O* read, only *S* read, both; |O| after 1, 2, 3 stills in shot order (is the third worth shooting?).
- **Interval.** Cases are the cluster (2,000 resamples of cases, seed 20261105), **only with at least 5 cases in a
  stratum**. Below that, per-case values and the discordant counts only; works within a case are not independent, so
  no p-value is derived from them.
- **Same pipeline.** Every still of a case goes through the same stamped pipeline version, reader set and catalog
  build (DL-3 lineage), fixed before any still is read.

## Verdict (a hypothesis check, for the owner's ruling)

Margin is **supported** for a stratum if the pooled lift is at least **0.05** (hypothesis: about a third of the 14.6 %
ceiling) and, where an interval exists, its lower bound is above 0. Otherwise it is not supported there, and the
report says whether the lift was positive.

## What it cannot say

The overlap stills are also closer than the whole-case still, so margin, proximity and centrality are one bundle: this
measures the protocol arm, not margin alone. "Every book is central in one still" is not scored (it needs boxes).
One visit gives few cases: small-n results are descriptive. Whether a sweep recovers the same books is G-SWEEP's and
NS-10's question, not this card's.

## After the shoot

A runner reads the pipeline's per-still outputs under `$BOOKCASE_DATA` and writes `metrics.json` and `report.md`
here; only aggregates leave the data root.
