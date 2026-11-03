# F0e: whole-spine boxes (F-0e)

Run 2026-11-03. Two sets, never merged (OC35): **`pilot-000` (real use)**, whose reader figures are **machine
agreement, never accuracy** (INV-17), and the **yardstick (PROXY, library shelves)**, used to evaluate only; nothing
was tuned on it. No hand labels (OC36), no paid calls. Aggregates only; renders and per-spine outputs stay private.
Method and arms: `docs/machine-labelling.md` (Whole-spine boxes). Intervals are 95 % photo bootstraps.

## Verdict

- **Cause: tiling.** A spine is found whole only when some tile holds it. With F-0's 1600 px tiles stepping 900 px,
  84 % of upright `pilot-000` boxes sat in shelf bands that fit no tile row; those were cut 33.0 % of the time
  against 6.4 % for bands that fit, and the cut share climbs from about 19 % to 66 % as band spine height grows
  from 1–1.5 to 2–2.5 times the 700 px overlap. The brief's "every spine over 700 px is cut in every tile" is too
  strong: a band fits a tile row wherever it happens to sit inside one, so cutting is likely, not certain. NMS only
  removes duplicates, so a spine no tile held stays a piece.
- **Part-of-spine detections are the smaller cause.** Of partial-height boxes, 35 % are tile cuts, 11 % sit inside
  a larger box (label blocks) and 5 % are stacked on a column neighbour; the rest (49 %) stand alone (short books,
  or pieces whose rest was suppressed or missed). `join` halves the stacked share but leaves the rest unchanged.
- **Winner: `bands+strips`, shipped as the whole-case default** (`CASE_TILING`). A box-only pass on 3100/1300 tiles
  finds the shelf bands, then one row of 1600 px-wide tiles follows each band, band height plus 12 % above and
  below; `strips` drops flat strips of spine ends that a tile edge cuts. On `pilot-000` the cut share falls from
  31.5 % to 4.3 %, partial height against the band's spine height from 8.1 % to 5.3 %, and upright boxes are 6 %
  longer on the same photos, with 10 % fewer boxes, 987 fine tiles against 1572 (plus 366 box-only tiles) and about
  the same detection time. Paired against tall tiles with `strips` (the larger-overlap fix), it had fewer
  partial-height boxes (×0.69, 0.48–0.96) and nested boxes (×0.85, 0.76–0.95) and 1.4 % longer upright boxes.
- **Not shipped:** `extend` (stretch each short box to its band and re-mask) looked best on `pilot-000` but lowered
  yardstick title recall by 6.3 points (−10.4 to −2.7): it grows boxes over neighbouring thin spines and the
  duplicate step drops them. `join` barely moves anything. Tall tiles fix cutting as well (8.1 %, 3.9 % with `strips`)
  but keep F-0's 1578 tiles and more partial-height boxes than `bands`.
- **The yardstick is untouched by the default**: shelf-scale photos keep F-0's 3100/1300 grid, whose tiles already
  hold a whole shelf (0.3 % cut where the band fits). `strips`, the only step that could apply there, removes 13
  of 1132 boxes and leaves yardstick titles unchanged: recall +1.4 points (−0.2 to +2.8), precision −0.4 (−1.6 to
  +0.4). Removing boxes shifts which hard crops reach Qwen's per-image cap, so a small move either way is expected.

## Readers on the winner

F-0's readers and decision (Vision, PP-OCRv5, Qwen3-VL on at most 40 hard crops a photo; same catalog bar) on the
`bands+strips` boxes of all 31 `pilot-000` photos, against F-0's run on its own boxes. **Machine agreement, not
accuracy** (INV-17); paired photo bootstrap in the table below.

- Per box, more is read and confirmed: share at `text-read` (a reader's top candidate passes the catalog bar)
  +2.0 points (0.9 to 3.2), share `confirmed` +1.5 points (0.9 to 2.2). Fewer piece and strip boxes are in the
  denominator (24 fewer boxes a photo).
- Per photo, the books found did not change: distinct confirmed works +0.2 (−0.6 to +1.1), confirmed boxes +0.4
  (−0.5 to +1.5). So the shelf-aligned pass lost no books to missed bands, and whole spines did not yet add any:
  the readers already confirmed most books from a well-placed piece. The gain is cleaner boxes (one per spine, for
  ordinals, bands, crops and the capture overlay) at the same reader output.
- `text-read` boxes per photo fell by 2.0 (−4.1 to +0.3): two pieces of one spine used to count twice.

## Measures

- **cut**: box touching an inner tile edge. **partial (band polygon)**: upright box under 55 % of its machine
  band's polygon height, as briefed; perspective and rows chained across two shelves stretch that polygon, so this
  column moves with how bands come out (it is not monotonic in spine height above) and is reported, not used to
  choose. **partial (band spine height)**: the same against the p90 of the band's upright boxes. **stacked**: end to
  end with another upright box in one column, along the spine's own axis. **inside**: mostly within a larger box.
  **boxes per band**: boxes over band length ÷ median spine width. **vs base**: median over photos of arm ÷ base.
- Detection seconds were taken while two other sessions shared the GPU; tile counts are the load-free cost.

<!-- tables -->
### Diagnosis: pilot-000 (real use), F-0's cached B2 boxes (tiles 1600 px, overlap 700 px)

31 photos, 6894 boxes, 6337 upright boxes in a band with a spine height. Band polygon height p50 1262 px (p90 1708); band spine height p50 984 px (p90 1416, max 1628).

| upright boxes whose band | boxes | cut | partial (band polygon) | partial (band spine height) |
|---|---:|---:|---:|---:|
| fits one tile row | 1001 | 6.4 % (3.7–9.7) | 12.7 % (6.7–25.2) | 5.0 % (3.2–6.6) |
| fits no tile row | 5336 | 33.0 % (26.0–41.8) | 42.5 % (33.7–50.3) | 8.6 % (5.4–12.6) |

| band spine height ÷ overlap | boxes | photos | cut | partial (band polygon) | partial (band spine height) | stacked |
|---|---:|---:|---:|---:|---:|---:|
| 0–1 | 259 | 10 | 20.8 % (6.6–61.9) | 69.1 % (44.7–84.0) | 2.7 % (1.0–8.0) | 9.3 % (1.2–12.7) |
| 1–1.5 | 3873 | 28 | 18.5 % (13.2–25.4) | 39.9 % (28.3–53.0) | 4.5 % (2.5–7.6) | 6.5 % (4.6–8.5) |
| 1.5–2 | 1731 | 29 | 42.8 % (32.8–52.4) | 28.0 % (22.2–34.4) | 10.9 % (7.5–15.6) | 2.7 % (0.9–4.6) |
| 2–2.5 | 474 | 16 | 66.2 % (47.2–81.8) | 39.2 % (28.7–48.2) | 30.0 % (22.8–35.3) | 1.7 % (0.4–4.2) |

Where partial-height boxes (band polygon) come from: cut 35.4 % (24.9–49.5); inside 11.1 % (8.0–13.7); stacked 4.7 % (2.9–6.6); alone 48.8 % (37.4–57.8).

### Diagnosis: yardstick (PROXY), F-0's cached B2 boxes (tiles 3100 px, overlap 1300 px)

40 photos, 1132 boxes, 1050 upright boxes in a band with a spine height. Band polygon height p50 2843 px (p90 3725); band spine height p50 2634 px (p90 2981, max 3082).

| upright boxes whose band | boxes | cut | partial (band polygon) | partial (band spine height) |
|---|---:|---:|---:|---:|
| fits one tile row | 327 | 0.3 % (0.0–1.0) | 18.0 % (10.6–24.9) | 12.5 % (9.2–15.4) |
| fits no tile row | 723 | 8.4 % (4.5–13.8) | 28.1 % (19.7–36.9) | 20.8 % (12.9–28.8) |

| band spine height ÷ overlap | boxes | photos | cut | partial (band polygon) | partial (band spine height) | stacked |
|---|---:|---:|---:|---:|---:|---:|
| 0–1 | 44 | 4 | 0.0 % (0.0–0.0) | 50.0 % (0.0–74.1) | 22.7 % (0.0–33.3) | 9.1 % (0.0–57.1) |
| 1–1.5 | 8 | 1 | 0.0 % (0.0–0.0) | 25.0 % (25.0–25.0) | 0.0 % (0.0–0.0) | 0.0 % (0.0–0.0) |
| 1.5–2 | 333 | 13 | 3.0 % (0.3–6.1) | 17.1 % (12.0–23.1) | 14.4 % (9.1–20.5) | 6.0 % (1.9–11.6) |
| 2–2.5 | 665 | 28 | 7.8 % (3.3–13.7) | 27.2 % (17.3–36.8) | 20.0 % (11.7–29.1) | 6.2 % (2.2–13.1) |

Where partial-height boxes (band polygon) come from: cut 4.6 % (1.3–9.0); inside 34.7 % (25.8–44.8); stacked 8.8 % (4.9–14.4); alone 51.9 % (39.7–62.0).

### Box measures by arm: `pilot-000` (real use)

Pooled shares with 95 % photo-bootstrap intervals; ratios are arm / base on the same photos (median over photos).

| arm | boxes | cut | partial (band polygon) | partial (band spine height) | stacked in a column | inside a larger box | boxes per band ÷ (length ÷ median width), p50 | upright box length vs base | boxes vs base | tiles (+ box-only tiles), total | detect s/photo p50 | detect time vs base |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| base | 6894 | 31.5 % (25.6–38.8) | 37.9 % (29.1–45.8) | 8.1 % (5.3–11.5) | 5.2 % (3.8–6.8) | 9.8 % (8.2–11.4) | 0.88 (0.83 to 0.94) | 1.00 (1.00 to 1.00) | 1.00 (1.00 to 1.00) | 1572 | 78.33 | 1.00 (1.00 to 1.00) |
| bands | 6403 | 8.2 % (6.9–9.6) | 30.9 % (21.0–39.5) | 5.3 % (3.9–6.9) | 5.9 % (4.3–8.0) | 14.1 % (11.9–16.5) | 0.92 (0.89 to 0.98) | 1.06 (1.03 to 1.15) | 0.93 (0.89 to 0.97) | 987 (+366) | 69.1 | 0.98 (0.77 to 1.16) |
| bands+strips | 6145 | 4.3 % (3.2–5.5) | 35.1 % (23.8–45.1) | 5.3 % (4.0–6.9) | 5.9 % (4.3–8.0) | 14.5 % (12.2–17.0) | 1.01 (0.98 to 1.05) | 1.06 (1.03 to 1.15) | 0.90 (0.86 to 0.94) | 987 | 69.23 | 0.99 (0.77 to 1.16) |
| extend | 6171 | 15.8 % (13.6–18.3) | 30.9 % (21.8–39.3) | 4.3 % (2.9–5.7) | 7.3 % (5.8–9.0) | 5.8 % (4.6–7.2) | 0.87 (0.81 to 0.91) | 1.08 (1.05 to 1.13) | 0.90 (0.88 to 0.91) | 1572 | 94.44 | 1.19 (1.16 to 1.27) |
| join | 6764 | 31.7 % (25.9–39.1) | 50.1 % (45.6–55.1) | 9.7 % (6.6–13.7) | 1.9 % (1.3–2.7) | 12.0 % (9.9–14.1) | 0.87 (0.81 to 0.92) | 1.00 (1.00 to 1.01) | 0.99 (0.98 to 0.99) | 1572 | 79.88 | 1.03 (1.02 to 1.03) |
| strips | 6617 | 28.6 % (22.8–36.1) | 43.1 % (34.6–50.9) | 8.2 % (5.4–11.8) | 5.1 % (3.8–6.8) | 10.1 % (8.5–11.7) | 0.98 (0.91 to 1.00) | 1.00 (1.00 to 1.00) | 0.96 (0.95 to 0.97) | 1572 | 78.45 | 1.00 (1.00 to 1.00) |
| tall | 6630 | 8.1 % (6.9–9.4) | 37.4 % (27.9–46.1) | 8.0 % (6.0–10.3) | 5.6 % (3.9–7.5) | 15.6 % (13.6–17.7) | 0.93 (0.87 to 0.94) | 1.05 (1.03 to 1.13) | 0.97 (0.95 to 0.99) | 1578 | 172.2 | 2.31 (1.98 to 3.22) |
| tall+join | 6503 | 8.2 % (7.0–9.5) | 50.3 % (43.8–56.2) | 10.4 % (7.5–13.7) | 2.2 % (1.5–3.0) | 17.7 % (15.2–20.4) | 0.91 (0.85 to 0.95) | 1.07 (1.04 to 1.17) | 0.95 (0.93 to 0.97) | 1578 | 173.48 | 2.36 (2.02 to 3.26) |
| tall+strips | 6342 | 3.9 % (3.0–5.0) | 40.2 % (30.7–49.5) | 8.0 % (5.9–10.2) | 5.5 % (3.9–7.5) | 16.1 % (14.1–18.2) | 1.04 (0.97 to 1.06) | 1.05 (1.03 to 1.13) | 0.93 (0.91 to 0.95) | 1578 | 172.36 | 2.31 (1.98 to 3.22) |
| tall+strips+extend | 5437 | 2.3 % (1.8–3.0) | 33.4 % (23.8–42.9) | 4.6 % (2.8–6.9) | 6.9 % (5.5–8.3) | 6.2 % (4.8–7.8) | 0.92 (0.91 to 0.96) | 1.09 (1.08 to 1.28) | 0.78 (0.76 to 0.81) | 1578 | 180.74 | 2.46 (2.08 to 3.36) |

### Box measures by arm: Yardstick (PROXY, library shelves; evaluation only, nothing tuned on it)

Pooled shares with 95 % photo-bootstrap intervals; ratios are arm / base on the same photos (median over photos).

| arm | boxes | cut | partial (band polygon) | partial (band spine height) | stacked in a column | inside a larger box | boxes per band ÷ (length ÷ median width), p50 | upright box length vs base | boxes vs base | tiles (+ box-only tiles), total | detect s/photo p50 | detect time vs base |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| base | 1132 | 7.3 % (3.9–11.5) | 25.1 % (18.6–31.6) | 18.2 % (12.7–24.3) | 6.4 % (3.1–11.0) | 22.7 % (19.2–25.9) | 0.99 (0.92 to 1.11) | 1.00 (1.00 to 1.00) | 1.00 (1.00 to 1.00) | 256 | 5.08 | 1.00 (1.00 to 1.00) |
| extend | 883 | 4.4 % (2.3–6.6) | 17.5 % (10.9–23.7) | 14.4 % (8.4–20.4) | 1.8 % (0.3–3.9) | 6.1 % (4.3–8.3) | 0.97 (0.91 to 1.02) | 1.04 (1.02 to 1.13) | 0.81 (0.78 to 0.85) | 256 | 7.48 | 1.48 (1.42 to 1.56) |
| join | 1109 | 6.7 % (3.7–9.8) | 24.8 % (17.7–31.8) | 18.3 % (12.7–24.6) | 2.3 % (1.1–3.7) | 23.3 % (19.5–26.9) | 1.01 (0.93 to 1.11) | 1.00 (1.00 to 1.00) | 1.00 (1.00 to 1.00) | 256 | 5.31 | 1.01 (1.01 to 1.02) |
| strips | 1119 | 6.3 % (3.0–10.3) | 25.1 % (18.6–31.6) | 18.4 % (12.7–24.3) | 6.4 % (3.1–11.0) | 23.0 % (19.3–26.3) | 0.99 (0.93 to 1.11) | 1.00 (1.00 to 1.00) | 1.00 (1.00 to 1.00) | 256 | 5.12 | 1.01 (1.01 to 1.01) |
| strips+extend | 872 | 3.2 % (1.3–5.2) | 17.3 % (10.7–23.7) | 14.2 % (8.2–20.3) | 1.6 % (0.1–3.6) | 6.2 % (4.3–8.4) | 0.97 (0.93 to 1.05) | 1.04 (1.02 to 1.13) | 0.81 (0.77 to 0.84) | 256 | 8.16 | 1.56 (1.48 to 1.64) |

### Yardstick titles with `extend` (PROXY, 40 images, evaluation only)

| | B2 base | B2 +extend | change (paired image bootstrap, 95 %) |
|---|---:|---:|---:|
| spine boxes | 1132 | 883 | |
| accepted labels | 269 | 219 | |
| title recall | 36.9 % | 30.6 % | -6.3 pts (-10.4 to -2.7) |
| title precision | 92.7 % | 92.2 % | -0.5 pts (-2.7 to 1.8) |

### Yardstick titles with `strips` (PROXY, 40 images, evaluation only)

| | B2 base | B2 +strips | change (paired image bootstrap, 95 %) |
|---|---:|---:|---:|
| spine boxes | 1132 | 1119 | |
| accepted labels | 269 | 284 | |
| title recall | 36.9 % | 38.3 % | 1.4 pts (-0.2 to 2.8) |
| title precision | 92.7 % | 92.3 % | -0.4 pts (-1.6 to 0.4) |

### Readers on `bands+strips` against the base boxes: `pilot-000` (machine agreement, not accuracy)

| | base | bands+strips | change (paired photo bootstrap, 95 %) |
|---|---:|---:|---:|
| boxes | 6894 | 6145 | per photo -24.16 (-30.49 to -18.58) |
| share at `text-present` | 74.8 % | 77.8 % | |
| share at `text-read` (a reader's top candidate passes the bar) | 25.0 % | 27.0 % | 2.0 pts (0.9 to 3.2) |
| share `confirmed` | 10.4 % | 11.9 % | 1.5 pts (0.9 to 2.2) |
| `text-read` boxes per photo | | | -2.00 (-4.13 to 0.29) |
| `confirmed` boxes per photo | 23.2 | 23.6 | 0.42 (-0.45 to 1.45) |
| distinct confirmed works per photo | 20.1 | 20.3 | 0.19 (-0.61 to 1.06) |

<!-- /tables -->

## Limits

- The shelf-aligned layout only tiles bands the coarse pass finds; a shelf it misses gets no fine tiles (no
  `pilot-000` photo fell back to the grid, and a photo with none found falls back to the tall grid). The renders
  show missed books at the edge of a frame where a shelf is only partly in view.
- `pilot-000` has no box ground truth: whole-spine figures are geometry and machine agreement, not box accuracy.
- Box ground truth on the yardstick is still pending (F-0), so the yardstick check is end to end by title.
- Bands are inferred from boxes (F-0); the band polygon partial share is reported as briefed but is unreliable.
