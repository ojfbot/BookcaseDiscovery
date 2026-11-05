# SC-1: shelf-context reader — report

Pre-registration: [`prereg.md`](prereg.md), commit 49e2dda, fixed before any full-set run. Runner:
`src/eval/sc1-cli.ts`; pure functions: `src/eval/sc1.ts`. Aggregates only; every per-line and per-row record stays
under the data root's `private/sc1/`.

## Verdict

**Not recommended for F-0h v2 yet.** K1, K3 and K4 hold, but K2 fails. The reader finds a lot of signage. On
`pilot-000` it covers 16 times the baseline's rows. But on these photos none of the agreement measures beats its shuffle
control at the pre-registered bar. The `RowContext` adapter ships behind `--row-context sc1`, off by default. F-0h's
default is unchanged.

- **Coverage (M1).** `pilot-000`: 83 of 320 rows have a shelf context (25.9 %, 20.9–31.1), against 5 for F-0h's strip
  adapter. 28 of 31 photos have at least one such row.
  - 80 rows have a genre and 43 an ordering rule. 6 rows have dividers and none has a letter range.
  - Most records come from text on S-1's lip, covering the row above it (`lip:row` 46).
  - Without Qwen: 69 rows. Qwen adds 14 rows, mostly sections only one local reader named.
  - Yardstick: 8 of 90 rows, against 0. Seven of them rest on Qwen alone (confidence 0.5), and only one genre maps to
    a family. Library shelves carry little store signage; the lip text there is mostly labels and prices.
- **Letter agreement (M2), `pilot-000`.** 72.4 % of 29 (book, divider) pairs agree. The shuffle mean is 49.6 % and the
  p95 is also 72.4 % (p 0.125). The real value only ties the p95, so K2 is not met on letters.
  Only 6 rows have a divider, so the measure is thin. Letter ranges never appeared on these shelves.
- **Section agreement (M4), `pilot-000`.** 58.4 % of 231 pairs (45.6–73.8), against a shuffle mean of 54.6 % and a
  p95 of 66.7 % (p 0.31). The default catalog is ISFDB, which is nearly all speculative fiction, so a `nonfiction` or
  `literature` row still mostly holds works tagged SF or fantasy. The measure can hardly separate sections here (the
  same limit F-0h logged). On the yardstick it cannot be measured: the inventory catalog has no genre facets.
- **Order agreement (M3), `pilot-000`.** In rows with an ordering rule, 83.9 % of 124 consecutive pairs are in surname
  order. The shuffle mean is 80.2 % and the p95 85.3 % (p 0.121). Rows without a rule are in order 77.9 % of the
  time, so the store's rows are mostly ordered whether or not a strip says so. The rule adds little beyond that base
  rate. The yardstick has no ordering rule.
- **Never a confirmer, and not taste (K4).** With `--row-context sc1`, none of F-0h's decisions changes on either set
  (985 and 244 compared). `confirmed-by-context` stays 55 and 12. 50 promotion or price units on `pilot-000` and 22 on
  the yardstick were read and dropped; none reached a record. What does move is the hypotheses:
  - rows set ordered: 1 → 43;
  - hidden-reader top-5: 21.3 % → 25.3 %, with overlapping intervals;
  - bracket top-1: 20.3 % → 25.0 %.

  This is report only; promotion is a later card.
- **GPU.** About 5.5 min of the 60-min budget: Vision lines 64 s and Qwen 265 s (401 lines). No other GPU job was
  running at any step.

**Exploratory, in no rule.** Genre agreement by where the cue was read on `pilot-000`:

| cue read | agreement | pairs |
|---|---|---|
| lip | 58.9 % | 185 |
| not-a-book boxes | 100 % | 10 |
| gaps | 42.9 % | 7 |
| free | 44.8 % | 29 |

Text in a gap or in free space may include titles of unboxed books whose words name a section. A later card could
trust strip-like regions more. Any such change needs its own pre-registration.

**For KN-2.** The section signal is in `private/sc1/<set>/rows.jsonl` (`genre`, `family`, `genreRegion`,
`confidence`). It is reliable as a reading, with the two readers agreeing on 81 of 120 kept units. Its agreement with
the catalog is not yet shown beyond chance on these photos.

**Limits.**
- `pilot-000` is machine agreement, never accuracy (INV-17). Confirmed books are F-0's `readers-agree` accepts only.
- The letter and order measures rest on few rows.
- The yardstick is a library, with little signage and an inventory catalog without facets.
- The exploratory breakdown by region was added after the results; the pre-registered measures are unchanged.

<!-- tables -->
### pilot-000 (real use): machine agreement, never accuracy

Main arm: `sc1` (Qwen selected 300 lines, read 300). Intervals: 95 % photo bootstrap.

| measure | F-0h strip adapter (baseline) | `sc1` | `sc1-no-qwen` |
|---|---|---|---|
| rows with context | 5 of 320 (1.6 %) | 83 of 320 (25.9 % (20.9–31.1)) | 69 of 320 (21.6 % (16.6–26.5)) |
| photos with any row context | – | 28 of 31 | 25 of 31 |
| rows with genre (mapped to a family) | 4 | 80 (67) | 62 (62) |
| rows with an ordering rule | 1 | 43 | 37 |
| rows with a letter range / with dividers | 0 / 0 | 0 / 6 | 0 / 6 |
| rows by cue source (region:scope) | f0f-shelf-strip | lip:row 46, free:row 12, not-a-book:row 8, gap:row 6, free:case 4, gap:divider+lip:row 2, free:row+lip:divider+lip:row 1, gap:row+lip:row 1, free:divider+gap:row 1, gap:divider+gap:row 1, free:divider+lip:row 1 | lip:row 39, free:row 8, not-a-book:row 7, gap:row 4, free:case 4, free:divider 2, free:row+not-a-book:row 1, free:row+lip:divider+lip:row 1, gap:divider 1, gap:divider+lip:row 1, gap:divider+gap:row 1 |
| genre families of rows | – | sf-fantasy 33, nonfiction 24, fantasy 7, sf 2, literature 1 | sf-fantasy 28, nonfiction 23, fantasy 8, sf 2, literature 1 |
| record confidence, median | – | 0.97 | 0.97 |
| **letter agreement** (book surname vs range or divider side) | – | 72.4 % (40.0–100.0); n 29; shuffle mean 49.6 %, p95 72.4 %, p 0.125 | 72.4 % (40.0–100.0); n 29; shuffle mean 49.6 %, p95 72.4 %, p 0.125 |
| letter pairs by kind | – | divider:agree 21, divider:disagree 8 | divider:agree 21, divider:disagree 8 |
| **genre agreement** (book facets vs row section) | – | 58.4 % (45.6–73.8); n 231; shuffle mean 54.6 %, p95 66.7 %, p 0.31 | 57.4 % (46.5–70.9); n 216; shuffle mean 52.7 %, p95 63.9 %, p 0.278 |
| genre agreement by cue region (exploratory, no rule) | – | lip 58.9 % (rows 42, n 185); not-a-book 100.0 % (rows 7, n 10); gap 42.9 % (rows 5, n 7); free 44.8 % (rows 13, n 29) | lip 59.1 % (rows 38, n 171); not-a-book 100.0 % (rows 6, n 8); gap 42.9 % (rows 5, n 7); free 40.0 % (rows 13, n 30) |
| **order agreement** (in-order consecutive pairs, rows with an ordering rule) | – | 83.9 %; n 124; shuffle mean 80.2 %, p95 85.3 %, p 0.121 | 84.7 %; n 111; shuffle mean 80.3 %, p95 85.9 %, p 0.112 |
| rows with an ordering rule / of them ordered by F-0h's rule | – | 28 / 11 | 25 / 11 |
| in-order share, rows without an ordering rule | – | 77.9 % (n 181) | 77.8 % (n 194) |
| text units: lines (per photo) / not-a-book boxes with text | – | 961 (31.0) / 16 | 961 (31.0) / 16 |
| units by region | – | line:free 459, line:gap 333, line:lip 131, line:not-a-book 38, box:not-a-book 16 | line:free 459, line:gap 333, line:lip 131, line:not-a-book 38, box:not-a-book 16 |
| units by class | – | other 793, section 77, ordering 35, promotion 32, letter 22, price 18 | other 836, section 48, ordering 36, promotion 20, letter 19, price 18 |
| units kept / dropped (why) | – | other 792, kept 120, promotion 32, price 18, lone-divider 13, low-confidence 1, disagree 1 | other 830, kept 92, promotion 20, price 18, lone-divider 10, disagree 6, low-confidence 1 |
| kept units by class | – | section 76, ordering 35, letter 9 | section 47, ordering 36, letter 9 |
| kept units by agreeing readers | – | ppocr+vision 81, qwen 23, ppocr+qwen 9, vision 3, ppocr 2, ppocr+qwen+vision 1, qwen+vision 1 | ppocr+vision 81, ppocr 5, vision 5, ppocr+qwen+vision 1 |
| cues scoped / unscoped | – | 113 / 7 | 86 / 6 |
| promotion or price units reaching a record (must be 0) | – | 0 | 0 |

### yardstick (PROXY, library shelves)

Main arm: `sc1` (Qwen selected 101 lines, read 101). Intervals: 95 % photo bootstrap.

| measure | F-0h strip adapter (baseline) | `sc1` | `sc1-no-qwen` |
|---|---|---|---|
| rows with context | 0 of 90 (0.0 %) | 8 of 90 (8.9 % (4.0–15.4)) | 1 of 90 (1.1 % (0.0–3.7)) |
| photos with any row context | – | 8 of 40 | 1 of 40 |
| rows with genre (mapped to a family) | 0 | 7 (1) | 1 (1) |
| rows with an ordering rule | 0 | 0 | 0 |
| rows with a letter range / with dividers | 0 / 0 | 0 / 1 | 0 / 0 |
| rows by cue source (region:scope) | f0f-shelf-strip | lip:row 3, gap:row 3, gap:divider 1, free:row 1 | gap:row 1 |
| genre families of rows | – | nonfiction 1 | nonfiction 1 |
| record confidence, median | – | 0.50 | 0.98 |
| **letter agreement** (book surname vs range or divider side) | – | 33.3 % (33.3–33.3); n 3; shuffle mean 33.3 %, p95 33.3 %, p 1 | – (n 0) |
| letter pairs by kind | – | divider:disagree 2, divider:agree 1 | none |
| **genre agreement** (book facets vs row section) | – | – (n 0) | – (n 0) |
| genre agreement by cue region (exploratory, no rule) | – | lip – (rows 0, n 0); not-a-book – (rows 0, n 0); gap – (rows 1, n 0); free – (rows 0, n 0) | lip – (rows 0, n 0); not-a-book – (rows 0, n 0); gap – (rows 1, n 0); free – (rows 0, n 0) |
| **order agreement** (in-order consecutive pairs, rows with an ordering rule) | – | – (n 0) | – (n 0) |
| rows with an ordering rule / of them ordered by F-0h's rule | – | 0 / 0 | 0 / 0 |
| in-order share, rows without an ordering rule | – | 69.1 % (n 123) | 69.1 % (n 123) |
| text units: lines (per photo) / not-a-book boxes with text | – | 334 (8.3) / 4 | 334 (8.3) / 4 |
| units by region | – | line:lip 129, line:gap 104, line:free 100, box:not-a-book 4, line:not-a-book 1 | line:lip 129, line:gap 104, line:free 100, box:not-a-book 4, line:not-a-book 1 |
| units by class | – | other 294, price 22, section 12, letter 10 | other 307, price 21, letter 9, section 1 |
| units kept / dropped (why) | – | other 294, price 22, kept 14, lone-divider 8 | other 307, price 21, lone-divider 8, kept 2 |
| kept units by class | – | section 12, letter 2 | letter 1, section 1 |
| kept units by agreeing readers | – | qwen 11, ppocr+vision 2, ppocr+qwen 1 | ppocr+vision 2 |
| cues scoped / unscoped | – | 9 / 5 | 1 / 1 |
| promotion or price units reaching a record (must be 0) | – | 0 | 0 |

### F-0h v2 with `--row-context sc1` (report only)

Decisions unchanged on both sets: **yes**. Pairs are [default, sc1].

| set | decisions compared / changed | confirmed-by-context | rows labelled | rows set ordered | hidden-reader top-1 | top-5 | bracket top-1 |
|---|---|---|---|---|---|---|---|
| pilot-000 | 985 / 0 | 55 → 55 | 5 → 83 | 1 → 43 | 10.3 % (6.2–14.4) → 11.4 % (6.2–16.9) | 21.3 % (16.8–23.5) → 25.3 % (19.8–28.0) | 20.3 % (7.7–32.7) → 25.0 % (8.1–41.0) |
| yardstick | 244 / 0 | 12 → 12 | 0 → 8 | 0 → 0 | 5.0 % (1.5–8.9) → 5.0 % (1.5–8.9) | 16.8 % (7.5–26.3) → 16.8 % (7.5–26.3) | 33.3 % (14.3–66.7) → 33.3 % (14.3–66.7) |

### Keep rule for F-0h v2 (report only; promotion is a later card)

| rule | holds |
|---|---|
| K1 coverage (pilot rows with context ≥ baseline + 10) | true |
| K2 evidence (pilot letter or genre agreement above its shuffle p95, n ≥ 20) | false |
| K3 no contradiction (every measured agreement ≥ its shuffle mean, both sets) | true |
| K4 never a confirmer (F-0h decisions unchanged; no promotion or price in a record) | true |
| **recommend wiring into F-0h v2** | **false** |

GPU: 5 min in all (pilot-000:qwen-sign 3, pilot-000:vision-lines 1, yardstick:qwen-sign 1, yardstick:vision-lines 0 min).
