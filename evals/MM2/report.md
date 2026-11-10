# MM-2 · multimodal self-gallery, shadow mode

Pre-registration: [`prereg.md`](prereg.md) (fixed at 9230ac7, before any shadow run). Arms:
`src/identify/appearance.ts`. Runner: `src/eval/mm2-cli.ts` (`ranked`, `texts`, `shadow --appearance shadow`,
`analyse`). Text-tower helper: `helpers/embed/text.py`. Every shadow row, ranked list and text vector is private,
under the data root's `private/mm2/`. This page holds aggregates only.

## Verdict

**Neither arm passes the keep rule, so both stay in shadow.** `appearance` defaults to `off`, and no decision
changed: every shadow row carries its cached F-0 decision, and the runner checks it is unchanged. Promotion to
`candidate` is the owner's ruling (MM-3), and nothing here argues for it yet.

- **Gallery arm.** K1 (the lookalike stress test) and K3 (a gain) fail.
  - At τv, 4 of 3,459 visual lookalike pairs on `pilot-000` val get past the text side, and 15 of 30,920 on the
    yardstick. All 4 on `pilot-000` and 10 of the 15 on the yardstick became the box's proposal.
  - The rule asks for zero, so the text side does not separate every lookalike at the threshold MM-2 had to use.
- **Gallery-free arm.** K3 fails. Its proposals agree with F-0 where F-0 accepted, but no reader takes one, so it
  adds nothing.
- **K2 passes for both arms, but trivially.** In the candidate simulation no reader takes any proposal from either
  arm, on either set. There are 0 new accepts, so 0 new wrong accepts.
- **One shop so far.** Cross-shop proof waits for a second fixture, and nothing here claims the arms generalise to
  another store. The yardstick is a different shop and catalog, so on it the gallery arm is only a cross-fixture
  lookalike test.

## What the run shows (pilot-000 is machine agreement, never accuracy; the yardstick is PROXY)

- **The self-gallery has nothing to re-find across split groups in this shop.**
  - The train gallery has 667 confirmed copies of 424 works.
  - None of its same-work pairs lie across two split groups: all 187 are within one photo.
  - None of `pilot-000` val's 144 F-0 accepts is a book the gallery holds.
  - So on `pilot-000` every gallery proposal is a lookalike by construction, and S2 (proposal = F-0's accept) is 0 %.
  - This is a property of the fixture: F-1's split groups are capture groups, and each covers different shelves.
    It is not a measured limit of the arm. The re-find case (the same copy in a later shoot) needs a second visit.
- **Near-duplicates did not set τv, because there are none to control for.**
  - The manifest has no near-duplicate flags, and there are no same-work pairs across split groups.
  - So MM-1's same-work pairs across photos are, at least on train, all within one capture group. There,
    leave-group-out already keeps a query away from them.
  - τv came from known different copies (two boxes in one photo): 0.642 for SigLIP 2, against MM-1's median-style
    0.810.
  - This is the conservative threshold the pre-registration asked for. It lets 3,459 lookalike pairs on `pilot-000`
    val and 30,920 on the yardstick reach the text side.
  - At MM-1's median, no lookalike passes on either set (9 pairs and 320 pairs). Choosing that threshold after
    seeing this would be a forking path, so it is reported, not used.
- **The text side holds back most visual lookalikes, but not all.**
  - On train, 13 of 8,000 lookalike pairs reach a text agreement of 0.8. So τt could not be calibrated and fell back
    to F-0's title bar, as pre-registered.
  - On val, the 4 `pilot-000` pairs that pass are all `unrelated`: a different title form and a different surname.
    Of the yardstick's 15, 6 are unrelated and 9 are on boxes whose own book is not known (F-0 left them open).
  - *Hypothesis, not measured:* the entry's title is short or common enough that the query's reading explains it.
    That is the one-word-title case C-6's lookalike guard targets.
  - About three quarters of `pilot-000` val strips (75.4 %) have a near entry that the text side rejects. On the
    yardstick it is 87.5 %. Nearness alone is common, which is the owner's "many books look similar", and it is
    never proposed.
- **The gallery-free arm reads titles poorly on real-use strips.**
  - On train boxes with an F-0 accept in their pool, SigLIP 2's top title matches the accept in 52 % with no
    margin. It is 73 % at δ = 0.01 and 92 % at δ = 0.08.
  - No grid value reached the 95 % bar, so δ fell back to 0.08 and the arm proposes on under 1 % of strips.
  - Where it does propose on an accepted box it agrees with F-0, but it never moves a reader. The secondary template
    (`title+author`) agrees as well where it proposes.
  - This is below the surprise line written in the pre-registration (under 80 % agreement). MM-1's 0.977 AUC was
    image-to-image, and image-to-title is a harder task on these crops.
- **No reader takes a proposal, so the candidate simulation adds nothing.** A proposal is only tested by readers
  that confirm no work of their own, and every proposal fell on a box whose readers either already confirmed or
  could not pass F-0's full bar on it.
- **DINOv2's lookalike stress figures are reported for comparison only.** At its own τv (0.426), 60,453 lookalike
  pairs reach the text side on `pilot-000` val and 9 pass it. On the yardstick it is 247,054 pairs and 29 passes.
  Its threshold sits much lower and lets through far more pairs, as MM-1 found.

## For MM-3 (if the owner wants appearance to go further)

- K1 needs a stronger text side before any arm can propose. Candidates, untested here: C-6's lookalike guard on
  the proposal, and a text agreement that needs coverage and author evidence, not only the title field.
- The re-find case needs a second visit to the same shop (a later shoot of the same cases) or a second fixture. The
  current split never puts one work on both sides.
- The gallery-free arm is not useful at this strip quality. MM-3 should not build on it without a better
  image-to-title signal.

## Cost

- Retrieval for the pools ran on the CPU: about 15 min on `pilot-000` and 2 min on the yardstick.
- The text tower ran on the CPU: 58,777 texts in 377 s. GPU time: 0 s, and TS-2's lane was never touched.
- A shadow pass takes about 1 min on `pilot-000` and 2.5 min on the yardstick.

<!-- generated by `node src/eval/mm2-cli.ts analyse`: edit above this line -->

## Gallery and thresholds (pilot-000 train only)

Gallery: 667 confirmed copies of 424 works, 23 photos in 4 split groups. Near-duplicate flags in the manifest: 0.

| model | same-work pairs across groups / within a photo | 10th pct across groups | 10th pct within a photo | τv (lower) | median (MM-1 style) |
|---|---|---:|---:|---:|---:|
| siglip2 | 0 / 187 | – | 0.642 | 0.642 | 0.810 |
| dinov2 | 0 / 187 | – | 0.426 | 0.426 | 0.698 |

τt = 0.8 (**not calibrated: fallback**; 8000 train lookalike pairs, highest text agreement 1.000). δ = 0.08 (**not calibrated: fallback**; 582 train accepts in their pool, 12 proposals at δ, agreement 91.7 %). Text tower: 58777 texts on the CPU in 377 s; no GPU time.

## Keep rule (for a promotion to `candidate`: the owner rules)

| arm | K1 lookalike stress | K2 no new yardstick wrong accepts | K3 a gain | verdict |
|---|---|---|---|---|
| gallery | **fail** | pass | **fail** | stays in shadow |
| gallery-free | n/a | pass | **fail** | stays in shadow |

## pilot-000 val (real use: machine agreement, never accuracy)

7 photos, 1249 queries (1246 valid strips, 1079 with text). F-0: 144 accepted; 168 no-text, 793 no-catalog-match, 132 single-reader, 12 readers-disagree. Median pool: 14 works. F-0-accepted boxes whose work the gallery holds (book key): 0.

| measure | gallery | gallery-free |
|---|---|---|
| S1 proposal share (valid strips) | 0.8 % (0.1–1.4) | 0.7 % (0.1–1.2) |
| S1 … on F-0 `accepted` | 2.8 % (0.0–3.0) | 2.1 % (0.0–4.0) |
| S1 … on F-0 `no-text` | 0.0 % (0.0–0.0) | 0.0 % (0.0–0.0) |
| S1 … on F-0 `no-catalog-match` | 0.5 % (0.0–1.2) | 0.3 % (0.0–0.6) |
| S1 … on F-0 `single-reader` | 1.5 % (0.0–1.7) | 3.0 % (0.0–4.8) |
| S1 … on F-0 `readers-disagree` | 0.0 % (0.0–0.0) | 0.0 % (0.0–0.0) |
| S2 proposal = F-0's accept | 0.0 % (0.0–0.0) | 100.0 % (100.0–100.0) |
| proposals / boxes where a reader takes one | 10 / 0 | 9 / 0 |
| S3 new accepts (candidate simulation) | 0 — 0 (0–0) | 0 — 0 (0–0) |

Gallery `near-only` (near but the text side fails): 75.4 % (69.8–79.3). Gallery-free, secondary template (`title+author`), proposal = F-0's accept: 96.3 % (88.9–100.0).

### L1 lookalike stress test (pilot-000)

| model | threshold | value | lookalike pairs (queries) | pass the text side | share (95 %) | became the proposal |
|---|---|---:|---:|---:|---|---:|
| siglip2 | τv | 0.642 | 3459 (89) | 4 | 0.1 % (0.0–0.1) | 4 |
| siglip2 | withinPhoto | 0.642 | 3459 (89) | 4 | 0.1 % (0.0–0.1) | 4 |
| siglip2 | median | 0.810 | 9 (4) | 0 | 0.0 % (0.0–0.0) | 0 |
| dinov2 | τv | 0.426 | 60453 (144) | 9 | 0.0 % (0.0–0.0) | – |
| dinov2 | withinPhoto | 0.426 | 60453 (144) | 9 | 0.0 % (0.0–0.0) | – |
| dinov2 | median | 0.698 | 5733 (127) | 1 | 0.0 % (0.0–0.0) | – |

SigLIP 2 lookalike pairs passing the text side at τv, by kind: 0 namesake, 0 same-author, 4 unrelated, 0 unknown.

## yardstick (PROXY, evaluation only)

40 photos, 1038 queries (1028 valid strips, 776 with text). F-0: 266 accepted, 22 of them wrong; 258 no-text, 366 no-catalog-match, 147 single-reader, 1 readers-disagree. Median pool: 13 works. Boxes in an image with an annotated book the gallery holds (book key): 33.

| measure | gallery | gallery-free |
|---|---|---|
| S1 proposal share (valid strips) | 1.0 % (0.3–1.8) | 0.7 % (0.1–1.4) |
| S1 … on F-0 `accepted` | 1.1 % (0.0–3.0) | 1.1 % (0.0–2.9) |
| S1 … on F-0 `no-text` | 0.0 % (0.0–0.0) | 0.0 % (0.0–0.0) |
| S1 … on F-0 `no-catalog-match` | 1.4 % (0.3–2.6) | 0.3 % (0.0–0.8) |
| S1 … on F-0 `single-reader` | 1.4 % (0.0–3.4) | 2.1 % (0.0–4.5) |
| S1 … on F-0 `readers-disagree` | 0.0 % (0.0–0.0) | 0.0 % (0.0–0.0) |
| S2 proposal = F-0's accept | 0.0 % (0.0–0.0) | 100.0 % (100.0–100.0) |
| S2 proposal is an annotated book (on accepted) | 33.3 % (0.0–100.0) | 100.0 % (100.0–100.0) |
| proposals / boxes where a reader takes one | 10 / 0 | 7 / 0 |
| S3 new accepts (candidate simulation) | 0 — 0 (0–0) | 0 — 0 (0–0) |
| S3 new wrong / new right accepts | 0 / 0 | 0 / 0 |

Gallery `near-only` (near but the text side fails): 87.5 % (84.3–90.2). Gallery-free, secondary template (`title+author`), proposal = F-0's accept: 100.0 % (100.0–100.0).

### L1 lookalike stress test (yardstick)

| model | threshold | value | lookalike pairs (queries) | pass the text side | share (95 %) | became the proposal |
|---|---|---:|---:|---:|---|---:|
| siglip2 | τv | 0.642 | 30920 (648) | 15 | 0.1 % (0.0–0.1) | 10 |
| siglip2 | withinPhoto | 0.642 | 30920 (648) | 15 | 0.1 % (0.0–0.1) | 10 |
| siglip2 | median | 0.810 | 320 (82) | 0 | 0.0 % (0.0–0.0) | 0 |
| dinov2 | τv | 0.426 | 247054 (773) | 29 | 0.0 % (0.0–0.0) | – |
| dinov2 | withinPhoto | 0.426 | 247054 (773) | 29 | 0.0 % (0.0–0.0) | – |
| dinov2 | median | 0.698 | 25824 (557) | 3 | 0.0 % (0.0–0.0) | – |

SigLIP 2 lookalike pairs passing the text side at τv, by kind: 0 namesake, 0 same-author, 6 unrelated, 9 unknown.
