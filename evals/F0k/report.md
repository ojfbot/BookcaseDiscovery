# F0k: missed-book recovery (F-0k)

The pre-registration is [`prereg.md`](prereg.md), committed in 93bb02f before any GPU call or full-set run. Aggregates
are in [`metrics.json`](metrics.json); the tables below the marker come from `src/eval/f0k-cli.ts analyse`. The two
sets are reported apart (OC35). `pilot-000` figures are machine agreement, never accuracy (INV-17). The yardstick is a
PROXY, used to evaluate only.

## Verdict (run 2026-11-04)

**Every arm is off.** No candidate source passes K1: the `pilot-000` interval for distinct confirmed works never lies
wholly above 0. K2 holds for every arm, because the yardstick's wrong accepts do not move (22 → 22 in every arm).

| arm | `pilot-000` distinct confirmed works (K1) | yardstick wrong accepts (K2) | verdict |
|---|---|---|---|
| `row-gaps` | 629 → 629 (+0; 0 to 0) | 22 → 22 (+0; 0 to 0) | **off** |
| `front-stretches` | 629 → 631 (+2; −2 to 7) | 22 → 22 (+0; 0 to 0) | **off** |
| `headroom` | 629 → 628 (−1; −3 to 0) | 22 → 22 (+0; 0 to 0) | **off** |
| `all` | 629 → 630 (+1; −4 to 7) | 22 → 22 (+0; 0 to 0) | **off** |

Both re-prompt steps ran, with Qwen, well inside the budget. They used about 15 GPU-minutes of the 120 budgeted:

- re-prompt: 3.7 minutes on the yardstick and 10.4 on `pilot-000`;
- Qwen: about 1.2 minutes.

Neither fallback was needed. Every cached decision was reproduced from the cached readings: 5,761 of 5,761 on
`pilot-000`, 1,040 of 1,040 on the yardstick.

The default box set stays as it is. Nothing ships, so no downstream cache is invalidated.

## Findings

1. **Most "missed" places already have a box.**
   - On `pilot-000` the re-prompt put 412 candidates inside their regions, and 349 survived detect.py's own filters.
   - Of those 349, 204 duplicate an existing kept box and 30 are pieces of one. Another 70 are duplicates among the
     new candidates themselves.
   - Only 39 boxes are new instances, in 31 of the 354 capped regions.
   - The yardstick shows the same pattern: 32 candidates, 19 of them duplicates, 5 recovered.

   The detector finds the same books again, not new ones. So a front stretch with no box (S-2's `frontNoBox`) usually
   sits beside or across a book that is already boxed. That fits Q-3's note that the gap's rebuilt position is about
   half a width off, and it means Q-3's `frontNoBox` gap books overstate the never-boxed books.
2. **Recovered boxes are hard to read.** Of `pilot-000`'s 39 (arm `all`):
   - 8 read no text and 21 found no catalog match;
   - 6 stop at a single reader;
   - 4 are accepted, and one of those is an echo (a work an existing box in the same photo already accepts).

   So 3 new (photo, work) pairs come in, but taking Qwen slots displaces 4 existing boxes and loses 2 pairs. The net
   is +1. On the yardstick, `all`'s one accept is also an echo (right accepts 244 → 245, title recall unchanged).
3. **Front stretches carry what little signal there is.**
   - All of `pilot-000`'s new accepts come from `front-stretches`: 4 accepts on 30 boxes, 3 of them new pairs.
   - `headroom` recovers 10 boxes on `pilot-000` from 17 regions with any candidate (of 199), and accepts none.
     Through displacement it costs one pair (−1; −3 to 0).
   - `row-gaps` has 2 placeable regions on `pilot-000` (one flag could not be placed; see the deviations) and none
     on the yardstick. It recovers one box, which is read but not accepted.
4. **Displacement matters at this scale.**
   - With F-0b's procedure (every other box keeps its cached Qwen reading), `all` would gain 3 pairs.
   - Making the recovered boxes compete for Qwen's per-photo cap costs 2 of them.

   Any later recovery pass that adds boxes to dense photos should count this cost.
5. **Gate behaviour.**
   - Recovered boxes keep a median 99.5 % of their SAM 2.1 mask after cutting away every kept box's pixels, so the
     duplicate and piece rules carry the gate.
   - The absorb share removed 6 candidates on `pilot-000` and 1 on the yardstick.
   - Overlap with the existing exclusive outlines is 0 by construction.
   - The geometric not-a-book rules flagged 1 yardstick headroom box (`spans-books`); F-0f's label rules flagged
     none.

## Hypotheses for a later card (not tested here)

- Place S-2's front stretches by pixel polygon, not arc length (Q-3's request). Then re-test whether the
  `frontNoBox` stretches that survive the gate are book-sized, before re-prompting.
- Give recovered boxes their own Qwen budget (a separate cap), so they do not displace existing boxes. This would be
  pre-registered against the per-photo compute ceiling, not after this result.

## Caches it would invalidate

None: nothing ships. Had an arm been kept, adding its boxes would invalidate everything that reads the box set:

- F-0g/F-0g2 copy groups;
- Q-2b outlines;
- H-2 faces;
- S-1 voids and S-2 headroom;
- F-0h rows and brackets;
- Q-3's audit;
- NB-3's probe on the new ids.

Existing boxes' caches and readings would not change.

## Limits

- **No ground truth for boxes on `pilot-000`.** "Recovered" means a new, non-overlapping detection. It does not mean
  a real book: only the readers' agreement speaks to that, and only as machine agreement.
- **Small counts.** With 3 to 4 new accepts a set, the intervals are wide. This is a null result at this scale, not
  proof that no missed books exist.
- **Region inputs are approximate.** Gap regions are rebuilt from arc lengths, about half a width off (Q-3). S-2
  did not meet adequacy, so its headroom regions are candidates only.

<!-- generated by src/eval/f0k-cli.ts analyse: edit above this line -->

## `pilot-000` (real use: machine agreement, never accuracy (INV-17))

Regions found / after the per-photo cap / re-prompt tiles: row-gaps 2 / 2 / 2; front-stretches 153 / 153 / 154; headroom 206 / 199 / 296.
Regions skipped: row-gaps: S-1 stretch not found 1.
Re-prompt: 31 photos, 452 tiles, 412 candidates in their regions, pool row-gaps 4, front-stretches 246, headroom 99; 621 GPU seconds.
Cached decisions reproduced from the cached readings on 5761 of 5761 kept boxes.

| figure | `row-gaps` | `front-stretches` | `headroom` | `all` |
|---|---|---|---|---|
| pool candidates (gate in) | 4 | 246 | 99 | 349 |
| gate: nms / duplicate / piece-of / absorbed / thin | 2 / 1 / 0 / 0 / 0 | 32 / 165 / 13 / 6 / 0 | 31 / 41 / 17 / 0 / 0 | 70 / 204 / 30 / 6 / 0 |
| recovered boxes | 1 | 30 | 10 | 39 |
| not-a-book (never read or no Qwen) | 0 | 0 | 0 | 0 |
| read / text read / Qwen selected | 1 / 1 / 0 | 30 / 24 / 12 | 10 / 8 / 4 | 39 / 31 / 15 |
| existing boxes displaced from Qwen | 0 | 3 | 1 | 4 |
| recovered accepts (echo accepts) | 0 (0) | 4 (1) | 0 (0) | 4 (1) |
| (photo, work) pairs lost to displacement | 0 | 1 | 1 | 2 |
| **M1 distinct confirmed works (95 % interval)** | 629 → 629 (+0; 0 to 0) | 629 → 631 (+2; -2 to 7) | 629 → 628 (-1; -3 to 0) | 629 → 630 (+1; -4 to 7) |
| by source: recovered / accepts | row-gaps 1 / 0 | front-stretches 30 / 4 | headroom 10 / 0 | row-gaps 1 / 0; front-stretches 30 / 4; headroom 8 / 0 |
| by row elevation: recovered / accepts | below 1 / 0 | below 20 / 3; level 9 / 1; above 1 / 0 | below 9 / 0; level 1 / 0 | below 28 / 3; level 10 / 1; above 1 / 0 |
| reader calls (vision, ppocr, qwen) | 2, 2, 0 | 60, 60, 24 | 20, 20, 8 | 78, 78, 30 |

## yardstick (PROXY; confirmed = accepted and annotated in the image)

Regions found / after the per-photo cap / re-prompt tiles: row-gaps 0 / 0 / 0; front-stretches 14 / 14 / 14; headroom 43 / 43 / 67.
Re-prompt: 25 photos, 81 tiles, 51 candidates in their regions, pool row-gaps 0, front-stretches 24, headroom 8; 204 GPU seconds.
Cached decisions reproduced from the cached readings on 1040 of 1040 kept boxes.

| figure | `row-gaps` | `front-stretches` | `headroom` | `all` |
|---|---|---|---|---|
| pool candidates (gate in) | 0 | 24 | 8 | 32 |
| gate: nms / duplicate / piece-of / absorbed / thin | 0 / 0 / 0 / 0 / 0 | 6 / 15 / 0 / 1 / 0 | 0 / 4 / 1 / 0 / 0 | 6 / 19 / 1 / 1 / 0 |
| recovered boxes | 0 | 2 | 3 | 5 |
| not-a-book (never read or no Qwen) | 0 | 0 | spans-books 1 | spans-books 1 |
| read / text read / Qwen selected | 0 / 0 / 0 | 2 / 2 / 1 | 2 / 1 / 1 | 4 / 3 / 2 |
| existing boxes displaced from Qwen | 0 | 0 | 0 | 0 |
| recovered accepts (echo accepts) | 0 (0) | 1 (1) | 0 (0) | 1 (1) |
| (photo, work) pairs lost to displacement | 0 | 0 | 0 | 0 |
| **M2 wrong accepts (95 % interval)** | 22 → 22 (+0; 0 to 0) | 22 → 22 (+0; 0 to 0) | 22 → 22 (+0; 0 to 0) | 22 → 22 (+0; 0 to 0) |
| right accepts | 244 → 244 (+0; 0 to 0) | 244 → 245 (+1; 0 to 3) | 244 → 244 (+0; 0 to 0) | 244 → 245 (+1; 0 to 3) |
| wrong accepts per box (kept, plus recovered read) | 2.1 % → 2.1 % | 2.1 % → 2.1 % | 2.1 % → 2.1 % | 2.1 % → 2.1 % |
| title recall / precision | 36.9 % → 36.9 % / 92.7 % → 92.7 % | 36.9 % → 36.9 % / 92.7 % → 92.7 % | 36.9 % → 36.9 % / 92.7 % → 92.7 % | 36.9 % → 36.9 % / 92.7 % → 92.7 % |
| by source: recovered / accepts / wrong | row-gaps 0 / 0 / 0 | front-stretches 2 / 1 / 0 | headroom 3 / 0 / 0 | row-gaps 0 / 0 / 0; front-stretches 2 / 1 / 0; headroom 3 / 0 / 0 |
| by row elevation: recovered / accepts | — | below 1 / 1; level 1 / 0 | below 1 / 0; level 2 / 0 | below 2 / 1; level 3 / 0 |
| reader calls (vision, ppocr, qwen) | 0, 0, 0 | 4, 4, 2 | 4, 4, 2 | 8, 8, 4 |

## Verdict (generated)

| arm | K0 ran | K1 pilot works interval above 0 | K2 yardstick wrong not up | verdict |
|---|---|---|---|---|
| `row-gaps` | yes | no | yes | **off** |
| `front-stretches` | yes | no | yes | **off** |
| `headroom` | yes | no | yes | **off** |
| `all` | yes | no | yes | **off** |
