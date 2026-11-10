# Module layering

The import direction between the folders of `src/`, enforced by `test/layering.test.ts` (DL-4, DL-4b).

```
src/run/, src/eval/   ──may import──▶  anything
src/identify/, perceive/, recommend/, capture/, ledger/, catalog/, shared/   ──never──▶  src/eval/, src/run/
src/catalog/   ──never──▶  src/identify/
```

The pipeline (capture → perceive → identify → recommend → report) is what production runs. `src/eval/` (the
harnesses, every `*-eval.ts` and `*-cli.ts` runner) and `src/run/` (the CLI) sit on top of it. Static, type-only,
re-export, side-effect and dynamic imports all count.

`src/shared/` holds what two pipeline folders both need and neither should own, so that `catalog` (which `identify`
imports) never has to import `identify`:

| Module | Holds | Re-exported from (old callers keep these paths) |
|---|---|---|
| `src/shared/readings.ts` | `ReaderName`, `Reading`, `ReadVariant`, `UnknownReason` (types only) | `src/identify/readers.ts`, `src/identify/decision.ts`, `src/eval/f0.ts` |
| `src/shared/stats.ts` | `quantile`, `rng` (pure numeric helpers) | `src/eval/q1.ts` |

## Where the runners went (DL-4b)

Nine evaluation runners moved out of pipeline folders into `src/eval/` with `git mv`, keeping their file names (none
clashes with a file already there). Reports under `evals/` are historical records and still print the old commands;
find the runner at its new path.

| Old path | New path |
|---|---|
| `src/catalog/c5-eval.ts` | `src/eval/c5-eval.ts` |
| `src/catalog/c6-eval.ts` | `src/eval/c6-eval.ts` |
| `src/catalog/c7-eval.ts` | `src/eval/c7-eval.ts` |
| `src/catalog/c8-eval.ts` | `src/eval/c8-eval.ts` |
| `src/catalog/c9-eval.ts` | `src/eval/c9-eval.ts` |
| `src/catalog/kn1-eval.ts` | `src/eval/kn1-eval.ts` |
| `src/catalog/lookup-eval.ts` | `src/eval/lookup-eval.ts` |
| `src/catalog/coverage-cli.ts` | `src/eval/coverage-cli.ts` |
| `src/identify/section-prior-cli.ts` | `src/eval/section-prior-cli.ts` |

An old command only changes its path: `node src/catalog/c6-eval.ts readings ...` is now
`node src/eval/c6-eval.ts readings ...`. `bookcase catalog coverage` is unchanged for the user; `src/run/index.ts` now
routes it to `src/eval/coverage-cli.ts` (the catalog module no longer does).

`src/catalog/coverage.ts` (C-10's live lookup) stays in the catalog: it is a pipeline module. Its imports of
`ReaderName`, `Reading` and `quantile`/`rng` now come from `src/shared/`, and it declares the three fields it reads
of a decision (`DecidedSpine`) instead of importing `SpineDecision`.

## Not guarded yet

`src/report/` imports `src/eval/q2.ts` (`RUNGS`, `filled`, `Rung`) and is not in the guarded list. Guarding it would put two
lines in `KNOWN` (`display-draw.ts` and `display-modes.ts` into `q2.ts`), cleared by moving those three names to a
neutral module.
