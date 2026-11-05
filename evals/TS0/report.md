# TS-0 · label ledger export (2026-11-04)

**Answer.** One versioned training set now comes from every experiment's machine labels on RB-1's box set:
**824 labels on `pilot-000`**, of which **472 are in the strong class** (a distinctive title, two readers agreeing, no
dissenting reader). The strong class is flagged, not filtered, so TS-2 can choose. F-1's grouped splits put 24
photos (4 capture groups) in `train` and 7 photos (2 capture groups) in `val`, with no group on both sides. No
near-duplicate photos were found. The yardstick is never exported.

The figures are `pilot-000` only. They are real use (OC35) and machine labels: machine agreement, never accuracy
(INV-17). This card trains nothing, publishes nothing and changes no default.

## What a label is

Every kept box of RB-1's box set (F-0i's partition less NB-3's `on-lip`, `src/eval/rb1.ts`) with a confirmed work
is one row. Its **decision basis** is one of the three that ship:

- `readers-agree`: F-0's accept, from H-2's cached base decisions on F-0e's default boxes.
- `confirmed-by-copy`: F-0g, as re-run in RB-1.
- `confirmed-by-context`: F-0h, as re-run in RB-1.

F-0's accept comes first. The raised bases apply only to boxes F-0 left `unknown`. A box whose copy and context
bases name different works gets no row (none did). `confirmed-by-pooling` (F-0g2) did not ship and is not exported.
No row is a hand label (OC36): the export refuses any basis but these three.

Each row records:

- **INV-14.** The version key, the box-set hash and the model-revision hash.
  - The box-set hash covers every kept box's id, detection rectangle and exclusive outline.
  - The model-revision hash covers the detector arm and layout, each reader's model, the crop method, the v1
    catalog's and statistics sidecar's stamps, F-0's acceptance bar, C-7's constants, F-1's constants and a hash of
    every cache read.
  - The version is `v-` plus 12 hex digits of a hash of the two. A box-set or model change gives a new version;
    old versions stay beside it.
- **Who voted.** The voting readers and TS-1's agreeing pair (or "one reader" for a context label read by one).
- **Coverage rung.** The box's own rung in Q-2b's table, before any raise: `confirmed` for `readers-agree`, lower
  for a copy or context label.
- **TS-1's label-filter fields.**
  - Title class: distinctive, or shared (more than one catalog work holds the title form, or it is one word). A
    work with no title form counts as shared.
  - Third-reader dissent (M5), on two-reader `readers-agree` labels, and any reader confirming another work.
  - On a shared title, whether C-7's namesake test passes or a reader read the author. This is C-7's evidence on
    each voting reader whose top candidate is the label's work, recomputed on the v1 catalog. It is "unmeasured"
    when no voting reader's top is the work.
- **The photo.** Its F-1 split, capture group, split group and near-duplicate flag.
- **Crop geometry.** The detection rectangle, the exclusive outline where F-0i changed the box, the crop method and
  the working copy's store path. No crops are rendered.

Rows, the manifest and the frozen split assignments live only under `$BOOKCASE_DATA/datasets/label-ledger/`. The
repo holds the schema (`src/capture/dataset.ts`, `src/eval/ts0.ts`) and these counts.

## Splits (F-1)

- **Capture group.** A run of one session's photos with no capture gap over 120 s.
- **Split group.** A capture group, joined with every photo of the same bookcase in its store, in any session, and
  with every near-duplicate. A near-duplicate is a 64-bit dHash within 8 bits.
- **Assignment.** Split groups are assigned whole.
  - A group with a frozen photo keeps the most conservative of its frozen splits (held-out, then val, then train).
  - Groups from `sf-store-002` are `held-out`.
  - The rest go to `val` in seeded order (seed 1) while it is under 20 % of the photos, else to `train`.
  - Every assignment is frozen in `splits.json` for later versions.
- **Tests.** `test/dataset.test.ts` checks 200 random datasets: no capture group, bookcase or near-duplicate pair
  straddles a split. The Z-1 guard's new `datasets-dir` rule rejects images, videos, weights and row files under any
  `datasets/` directory, even under `test/fixtures/synthetic/`.

`pilot-000` has no store or bookcase ids, so its groups are capture groups. The closest pair of its photos is 18
bits apart, so the near-duplicate flag is vacuous on this set.

## Re-run

```bash
node bin/bookcase dataset build    # about 40 s on the CPU; writes a new version only when the inputs changed
node bin/bookcase dataset report   # this file's tables and metrics.json, from the latest version
```

Re-run after every box-set or model change, for example a new partition, a new not-a-book cause, a reader re-run,
a catalog rebuild or a new fixture.

**NS-4 (2026-11-05): capture provenance, schema 2.** Every row now carries `deviceClass`, `lens`, `captureMode`,
`caseId`, `dupClusterId`, `labelSource` and `rgbRecoverable` (`docs/dataset.md`, "Capture provenance"). The rebuild
gave the same 824 labels on the same splits; every `pilot-000` row is a `shopper-still` on the `metric-depth` tier,
`single-view` and RGB-recoverable, with no case id and no near-duplicate cluster. The tables below report the
distribution as counts. A schema-1 version is refused as stale until rebuilt.

<!-- generated by `bookcase dataset report`: edit above this line -->

## Version `v-f495741be2c5`

5757 kept boxes on RB-1's box set; **824 labels** on 29 photos. 4933 boxes have no label; 0 have a copy and a context label naming different works and are left out.

### Photos and splits (F-1)

| split | photos | capture groups | split groups | labels |
|---|---:|---:|---:|---:|
| train | 24 | 4 | 4 | 667 |
| val | 7 | 2 | 2 | 157 |
| held-out | 0 | 0 | 0 | 0 |

Near-duplicate photo pairs: 0 (0 across capture groups, each joined into one split group), in 0 near-duplicate clusters. Photos with no dHash: 0. Groups straddling a split: **0**.

### Capture provenance (NS-4)

Photos by device tier, lens and capture mode; labels by the same and by label source and RGB-recoverability. Counts only.

| photos | counts |
|---|---|
| device class | metric-depth 31 · relative-stereo 0 · none 0 |
| lens | main 4 · ultra-wide 27 · telephoto 0 · unknown 0 |
| capture mode | shopper-still 31 · protocol-still 0 · natural-sweep 0 · rich-session 0 |
| with a case id | 0 |

| device class | all | train | val | held-out |
|---|---:|---:|---:|---:|
| metric-depth | 824 | 667 | 157 | 0 |
| relative-stereo | 0 | 0 | 0 | 0 |
| none | 0 | 0 | 0 | 0 |

| lens | all | train | val | held-out |
|---|---:|---:|---:|---:|
| main | 46 | 45 | 1 | 0 |
| ultra-wide | 778 | 622 | 156 | 0 |
| telephoto | 0 | 0 | 0 | 0 |
| unknown | 0 | 0 | 0 | 0 |

| capture mode | all | train | val | held-out |
|---|---:|---:|---:|---:|
| shopper-still | 824 | 667 | 157 | 0 |
| protocol-still | 0 | 0 | 0 | 0 |
| natural-sweep | 0 | 0 | 0 | 0 |
| rich-session | 0 | 0 | 0 | 0 |

| label source | all | train | val | held-out |
|---|---:|---:|---:|---:|
| single-view | 824 | 667 | 157 | 0 |
| mono-geometry | 0 | 0 | 0 | 0 |
| multiview-fusion | 0 | 0 | 0 | 0 |
| lidar-privileged | 0 | 0 | 0 | 0 |
| lidar-scale | 0 | 0 | 0 | 0 |

| RGB-recoverable | all | train | val | held-out |
|---|---:|---:|---:|---:|
| yes | 824 | 667 | 157 | 0 |
| no | 0 | 0 | 0 | 0 |
| unknown | 0 | 0 | 0 | 0 |

Labels with a case id: 0; in a near-duplicate cluster: 0.

### Labels

| strong class | all | train | val | held-out |
|---|---:|---:|---:|---:|
| strong | 472 | 379 | 93 | 0 |
| not strong | 352 | 288 | 64 | 0 |

| title class | all | train | val | held-out |
|---|---:|---:|---:|---:|
| distinctive | 560 | 456 | 104 | 0 |
| shared | 264 | 211 | 53 | 0 |

| decision basis | all | train | val | held-out |
|---|---:|---:|---:|---:|
| readers-agree | 726 | 582 | 144 | 0 |
| confirmed-by-copy | 9 | 9 | 0 | 0 |
| confirmed-by-context | 89 | 76 | 13 | 0 |

| coverage rung | all | train | val | held-out |
|---|---:|---:|---:|---:|
| not-seen | 0 | 0 | 0 | 0 |
| seen | 0 | 0 | 0 | 0 |
| spine-found | 0 | 0 | 0 | 0 |
| text-present | 7 | 6 | 1 | 0 |
| text-read | 17 | 15 | 2 | 0 |
| matched | 74 | 64 | 10 | 0 |
| confirmed | 726 | 582 | 144 | 0 |

| agreeing readers | all | train | val | held-out |
|---|---:|---:|---:|---:|
| vision+ppocr | 558 | 443 | 115 | 0 |
| vision+qwen | 153 | 130 | 23 | 0 |
| ppocr+qwen | 38 | 31 | 7 | 0 |
| vision+ppocr+qwen | 1 | 1 | 0 | 0 |
| one reader | 74 | 62 | 12 | 0 |

| third reader (two-reader `readers-agree`) | all | train | val | held-out |
|---|---:|---:|---:|---:|
| dissents | 17 | 13 | 4 | 0 |
| contradicts | 72 | 60 | 12 | 0 |
| supports | 74 | 62 | 12 | 0 |
| read-nothing | 19 | 17 | 2 | 0 |
| not-read | 544 | 430 | 114 | 0 |
| none | 98 | 85 | 13 | 0 |

| any reader dissents | all | train | val | held-out |
|---|---:|---:|---:|---:|
| dissent | 17 | 13 | 4 | 0 |
| no dissent | 807 | 654 | 153 | 0 |

| shared title backed by | all | train | val | held-out |
|---|---:|---:|---:|---:|
| author read | 181 | 144 | 37 | 0 |
| namesake test | 43 | 33 | 10 | 0 |
| neither | 37 | 33 | 4 | 0 |
| unmeasured | 3 | 1 | 2 | 0 |

| basis · title class · class | labels |
|---|---:|
| confirmed-by-context · distinctive · not strong | 71 |
| confirmed-by-context · shared · not strong | 18 |
| confirmed-by-copy · distinctive · not strong | 6 |
| confirmed-by-copy · shared · not strong | 3 |
| readers-agree · distinctive · not strong | 11 |
| readers-agree · distinctive · strong | 472 |
| readers-agree · shared · not strong | 243 |

Labels on photos with a near-duplicate: 0.
