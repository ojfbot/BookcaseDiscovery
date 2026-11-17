# C11: the Open Library catalog (v2) on the store samples, re-decided from cache

Card C-11, run 2026-11-16 on this Mac's CPU (main `0c95ef5` plus this card's code; `metrics.json` records the
commit). Pre-registration: `prereg.md`, committed before any re-decision, with one amendment made before any figure
was read. Numbers: `metrics.json`. Intervals: photo-cluster bootstrap, 95 %, 2,000 resamples, seed 1.

**Every figure is machine agreement between the readers and a catalog, never accuracy** (INV-17, OC36). A real-use
set has no truth, so a box v2 gains is not judged right or wrong. **The default catalog stays `catalog.sqlite` (v1).**
This card switches nothing and tunes nothing.

## Headlines

- **v2 accepts 15.8 % to 23.9 % of v1's `no-catalog-match` boxes on every store set.** Between 40.1 % and 49.0 % of
  those boxes leave `no-catalog-match`, but most of them go to `single-reader`: one reader's top candidate confirms, and
  no second reader agrees. That outcome is below F-0's bar.
- **Confirmed share rises 2.1 to 3.9 times** (paired Δ +7.5 to +15.9 points, every interval above 0). The rise is
  larger than on `pilot-000` (C-5: +3.97, 2.06–6.19). Open Library works make up 62 % to 81 % of v2's accepts.
- **v2 loses few accepts and switches more.** It loses 9 to 50 boxes per set. It switches 22 to 170, nearly all of them
  (93 % to 98 %) to an Open Library work. A switch is not judged.
- **The cost side is the yardstick's, quoted and not recomputed.** Wrong accepts per spine are 0.53 % on v1 and 1.50 %
  on v2 (C-5). On the yardstick, 17 of v2's 44 accepts are wrong. The store's top-candidate margins thin out the way
  that risk predicts (below), but the yardstick rate is **not a prediction for the store**.
- `no-catalog-match` remains 24.9 % to 35.0 % of boxes on v2. `no-text` (19.3 % to 39.9 %) is untouched, as a catalog
  cannot change it.

## Run

- **Unit: F-0's own run.** Each set's `decisions.jsonl` and reader caches, under the data root's `f0/<set>/`, are
  re-decided with F-0's `ACCEPT` bar unchanged. F-0c's base decision on F-0e's default boxes, which #100 and #101
  tabulate, differs slightly:
  - `sf-store-001.every-3`: 11,828 boxes and 556 accepts there, 11,758 and 545 here;
  - `sf-store-003.frames.every-10`: 580 against 585;
  - `sf-store-004.frames.every-10`: 525 against 520;
  - `sf-store-005.frames.every-10`: 5,417 boxes and 301 accepts there, 5,325 and 290 here;
  - `sf-store-003.frames.every-41`: 163 against 162.
  - The stills are equal at 235.
- **Command.** `node src/eval/c5-eval.ts lookalike --set <set> --run C11 --min-reproduced 0.99`, one set at a time, then
  `publish --run C11`.
  - Offline: a process guard refused any `fetch` (none was attempted), with `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE`
    and `UV_OFFLINE` set.
  - `BOOKCASE_CATALOG` was unset, so v1 is `catalog.sqlite` and v2 is `catalog-v2.sqlite`.
  - No GPU, no model step and no stage rerun.
  - `c5-eval.ts publish` without `--run` was never run, so C-5's record is untouched.
- **Gate.** Every set reproduced F-0's cached decisions (accepted work and reason) on **1.0000** of boxes, with the
  crop-clip readings, so no set fell back to all crops.
- **Held out (OC35).** `sf-store-004` and `sf-store-005` were re-decided for measurement only, after a check that
  nothing `lookalike` writes can reach training, an export or a gallery:
  - it reads F-0's caches and both catalogs read-only;
  - it writes only `catalog/c11/` (aggregates) and `catalog/c11/private/` (the re-decision cache);
  - no training, export or gallery code reads either folder.
  - Their figures are aggregates only, and nothing was tuned.

### Wall time

The cap is 2 h (7,200 s) per set. Wall time covers process start to exit: loading, the v1 and v2 re-decisions and the
bootstraps. The v1 and v2 columns are the re-decision steps alone.

| set | boxes | wall time | v1 re-decision | v2 re-decision | v2 s per box |
|---|---:|---:|---:|---:|---:|
| `sf-store-003.stills` | 5,039 | 3,428 s | 409 s | 3,018 s | 0.60 |
| `sf-store-003.frames.every-41` | 1,873 | 1,290 s | 161 s | 1,128 s | 0.60 |
| `sf-store-003.frames.every-10` | 8,186 | 5,398 s | 668 s | 4,729 s | 0.58 |
| `sf-store-005.frames.every-10` | 5,325 | 4,717 s | 594 s | 4,121 s | 0.77 |
| `sf-store-004.frames.every-10` | 11,027 | **7,165 s** | 951 s | 6,213 s | 0.56 |
| `sf-store-001.every-3` | 11,758 | 5,286 s | 700 s | 4,584 s | 0.39 |

No set reached the cap. `sf-store-004.frames.every-10` finished 35 s under it. A later run on a larger set needs a
higher cap or a faster re-decision; this card changed neither.

## Results per set

Each set stands on its own; sets are never pooled. Shares are of the set's boxes unless the column says otherwise. In
the first table, "OL works" is the number of v2 accepts that are Open Library works, followed by their share of v2's
accepts.

| set | images | boxes | v1 confirmed | v2 confirmed | paired Δ, points | OL works |
|---|---:|---:|---:|---:|---:|---:|
| `sf-store-003.stills` | 16 | 5,039 | 235 (4.7 %) | 689 (13.7 %) | +9.01 (+5.75 to +12.11) | 501 (72.7 %) |
| `sf-store-003.frames.every-41` | 20 | 1,873 | 162 (8.6 %) | 336 (17.9 %) | +9.29 (+4.96 to +13.71) | 208 (61.9 %) |
| `sf-store-001.every-3` | 205 | 11,758 | 545 (4.6 %) | 1,425 (12.1 %) | +7.48 (+6.46 to +8.47) | 1,073 (75.3 %) |
| `sf-store-003.frames.every-10` | 82 | 8,186 | 585 (7.1 %) | 1,320 (16.1 %) | +8.98 (+7.14 to +10.97) | 848 (64.2 %) |
| `sf-store-004.frames.every-10` (held out) | 81 | 11,027 | 520 (4.7 %) | 1,811 (16.4 %) | +11.71 (+10.30 to +13.20) | 1,468 (81.1 %) |
| `sf-store-005.frames.every-10` (held out) | 57 | 5,325 | 290 (5.4 %) | 1,138 (21.4 %) | +15.92 (+13.82 to +17.98) | 916 (80.5 %) |

### Where v1's `no-catalog-match` boxes went (the headline), and the transitions

The two share columns are of v1's `no-catalog-match` boxes. The four transition columns (gained, lost, switched and
same) count every box.

| set | v1 `no-catalog-match` | **v2 accepts** | leaves `no-catalog-match` | gained | lost | switched (to OL) | same |
|---|---:|---:|---:|---:|---:|---:|---:|
| `sf-store-003.stills` | 2,863 (56.8 %) | **452 (15.8 %, 11.6–19.1)** | 1,148 (40.1 %, 33.8–44.5) | 463 | 9 | 39 (38) | 187 |
| `sf-store-003.frames.every-41` | 880 (47.0 %) | **178 (20.2 %, 13.7–26.0)** | 392 (44.5 %, 36.6–50.5) | 187 | 13 | 22 (21) | 127 |
| `sf-store-001.every-3` | 5,251 (44.7 %) | **844 (16.1 %, 14.4–17.6)** | 2,357 (44.9 %, 42.3–47.1) | 916 | 36 | 170 (158) | 339 |
| `sf-store-003.frames.every-10` | 4,134 (50.5 %) | **733 (17.7 %, 15.1–20.3)** | 1,806 (43.7 %, 40.2–46.9) | 773 | 38 | 78 (76) | 469 |
| `sf-store-004.frames.every-10` | 6,778 (61.5 %) | **1,279 (18.9 %, 17.1–20.6)** | 2,956 (43.6 %, 41.7–45.6) | 1,341 | 50 | 131 (127) | 339 |
| `sf-store-005.frames.every-10` | 3,443 (64.7 %) | **823 (23.9 %, 21.6–26.3)** | 1,687 (49.0 %, 46.5–51.4) | 865 | 17 | 52 (51) | 221 |

Where those boxes went on v2:

| set | accepted | `single-reader` | `readers-disagree` | stays `no-catalog-match` |
|---|---:|---:|---:|---:|
| `sf-store-003.stills` | 452 | 629 | 67 | 1,715 |
| `sf-store-003.frames.every-41` | 178 | 194 | 20 | 488 |
| `sf-store-001.every-3` | 844 | 1,310 | 203 | 2,894 |
| `sf-store-003.frames.every-10` | 733 | 927 | 146 | 2,328 |
| `sf-store-004.frames.every-10` | 1,279 | 1,547 | 130 | 3,822 |
| `sf-store-005.frames.every-10` | 823 | 787 | 77 | 1,756 |

Gains also come from v1's `single-reader` boxes (9 to 67 per set) and its `readers-disagree` boxes (0 to 5). The full
flow matrices are in `metrics.json` (`flow`).

### Outcome mix, v1 → v2

| set | accepted | `single-reader` | `readers-disagree` | `no-catalog-match` | `no-text` |
|---|---:|---:|---:|---:|---:|
| `sf-store-003.stills` | 4.7 → 13.7 % | 6.5 → 18.0 % | 0.2 → 2.3 % | 56.8 → 34.2 % | 31.8 % |
| `sf-store-003.frames.every-41` | 8.6 → 17.9 % | 9.7 → 18.3 % | 1.5 → 4.3 % | 47.0 → 26.4 % | 33.1 % |
| `sf-store-001.every-3` | 4.6 → 12.1 % | 9.5 → 18.6 % | 1.2 → 4.4 % | 44.7 → 24.9 % | 39.9 % |
| `sf-store-003.frames.every-10` | 7.1 → 16.1 % | 9.8 → 19.5 % | 0.9 → 4.0 % | 50.5 → 28.8 % | 31.6 % |
| `sf-store-004.frames.every-10` | 4.7 → 16.4 % | 7.9 → 20.1 % | 0.5 → 2.9 % | 61.5 → 35.0 % | 25.5 % |
| `sf-store-005.frames.every-10` | 5.4 → 21.4 % | 10.0 → 22.2 % | 0.7 → 3.9 % | 64.7 → 33.3 % | 19.3 % |

### Lost boxes, by the reason v2 gives

| set | lost | `readers-disagree` | `single-reader` | `no-catalog-match` |
|---|---:|---:|---:|---:|
| `sf-store-003.stills` | 9 | 4 | 4 | 1 |
| `sf-store-003.frames.every-41` | 13 | 6 | 4 | 3 |
| `sf-store-001.every-3` | 36 | 22 | 11 | 3 |
| `sf-store-003.frames.every-10` | 38 | 23 | 14 | 1 |
| `sf-store-004.frames.every-10` | 50 | 33 | 9 | 8 |
| `sf-store-005.frames.every-10` | 17 | 11 | 5 | 1 |

Most lost boxes become `readers-disagree`: a second catalog's candidate splits readers who agreed on v1.

### Top-candidate margins (C-5's measure)

The margin is the top candidate's score minus the runner-up's. The table covers readings whose top candidate
confirms. Under 0.02 the top candidate won on popularity rather than on text (C-6's arm (a)).

| set | v1 n | v1 p50 | v1 share under 0.02 | v2 n | v2 p50 | v2 share under 0.02 |
|---|---:|---:|---:|---:|---:|---:|
| `sf-store-003.stills` | 821 | 0.147 | 18.3 % | 2,613 | 0.088 | 33.8 % |
| `sf-store-003.frames.every-41` | 564 | 0.137 | 15.3 % | 1,260 | 0.092 | 32.1 % |
| `sf-store-001.every-3` | 2,520 | 0.098 | 25.3 % | 6,501 | 0.058 | 37.6 % |
| `sf-store-003.frames.every-10` | 2,151 | 0.146 | 17.3 % | 5,239 | 0.082 | 34.5 % |
| `sf-store-004.frames.every-10` | 2,036 | 0.104 | 25.4 % | 6,978 | 0.113 | 30.3 % |
| `sf-store-005.frames.every-10` | 1,185 | 0.107 | 22.5 % | 4,220 | 0.094 | 32.2 % |

On v2, 30 % to 38 % of confirming readings win by under 0.02, against 15 % to 25 % on v1. The median margin falls on
five of the six sets. Thin margins are where the yardstick's v2 lookalikes came from (C-5, C-6).

## Quoted beside it: the yardstick's cost (not recomputed)

`yardstick-library-b2` is PROXY: 40 photos and 1,132 spines with annotated books. Wrong accepts per spine:

| arm | catalog | confirmed | wrong | wrong per spine | source |
|---|---|---:|---:|---:|---|
| none | v1 | 13 | 6 | 0.53 % (0.10–1.05) | `evals/C5/metrics.json` |
| none | v2 | 44 | 17 | 1.50 % (0.66–2.46) | `evals/C5/metrics.json` |
| C-6 arm (c), short title | v2 | 35 | 8 | 0.71 % (0.18–1.32) | `evals/C6/` |
| C-7 `c7`, rarity basis | v2 | 35 | 9 | 0.80 % (0.22–1.41) | `evals/C7/` |

Neither guard passed its card's keep rule, so neither is in force here. The yardstick is a library, not these stores,
and its wrong rate is **not a prediction** for the store sets. The store's gained accepts have no truth and are not
judged. For reference, C-5 on `pilot-000` (real use, 6,894 spines) found v1 718, v2 992 and Δ +3.97 points
(2.06–6.19).

## Observations (hypotheses, not findings)

- The general-shop sets gain more than `pilot-000`. The two held-out stores have the largest `no-catalog-match` shares
  and the largest gains: -005 gains +15.9 points and -004 gains +11.7. That fits C-4's finding that about three
  quarters of the missing books are not SF. Store stock is not measured here.
- `single-reader` roughly doubles on every set. More readings now find a catalog candidate, but F-0's two-reader bar
  keeps them below acceptance. This card measures no relaxation of that bar.
- About half of `no-catalog-match` stays put even on v2 (1,715 to 3,822 boxes per set). This card cannot tell what
  that residue is: readings too broken to retrieve, books in neither catalog, or non-books. The brief's next steps (an
  author-or-imprint rule for short v2-only titles, a store inventory list, a capped live-lookup verifier) are the
  owner's to choose.

## What this does not decide

It sizes the catalog gap on store data, as machine agreement. It does not switch the catalog: switching is the owner's
call, against the yardstick's cost above. Not run, as the prereg says: `catalog-v2-c9.sqlite`, and C-6's and C-7's
arms on the store sets.
