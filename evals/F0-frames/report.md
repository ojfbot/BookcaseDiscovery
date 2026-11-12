# F0-frames: the still stages on `sf-store-001` (video tier), every 3rd frame

**Scope, 2026-11-11: this covers about a third of the session's frames, not all of them.** The run is the sample
part `sf-store-001.every-3`: every 3rd frame of the session's image list, in list order. That is 205 of 616 frames
(0.3328), about 3 s apart, where the session's frames are 1 s apart. It ran on the owner's ruling, after the 20-frame
pilot projected the whole session at 29.8 hours. The ruling is recorded as an amendment to `prereg.md`, committed
before any step of the run started. Nothing here is scaled up to the whole session.

Steps 1 to 11 of `docs/ingest.md` ("Stage order") all ran, and all 24 commands exited 0. Every figure below is
**machine agreement** between the stack's own stages and readers, **never accuracy** (INV-17). There are no hand labels
(OC36). Every figure is measured from the caches, and all counts are in `metrics.json`. The comparison set is
`pilot-000` (31 stills of about 48 MP), read from its existing caches; nothing of it was rerun.

## Run

- **Where**: this Mac, one model step at a time, nothing else on the GPU. The catalog was local. A process guard
  refused any network fetch (none was attempted), and the model helpers ran offline. Nothing was downloaded, and
  `contracts/` is unchanged.
- **Frames**: 205 in the sample. All 205 were processed and 0 failed, both in F-0's own run and in the default boxes.
  For 6 of the 11,828 default boxes, `vision` and `ppocr` wrote no reading row.
- **Unit**: a box or a frame. Frames overlap, so one physical book is counted once per frame it appears in. No figure
  is deduplicated across frames, so a per-box share here is not a per-book share.

## Time: projected against actual

| | seconds | hours |
|---|---:|---:|
| pilot (20 frames), actual | 3,479 | 0.97 |
| this run, projected from the pilot (× 205 / 20) | 35,663 | 9.91 |
| this run, projected after F-0 (F-0's actual × 3,479 / 1,181) | 31,085 | 8.63 |
| **this run, actual** | **30,556** | **8.49** |

The run took 14% less time than the pilot projected: 149 s per frame, against 174 s per frame in the pilot. The stop
line after F-0 was about 15 hours (54,000 s), and the run was well under it.

| step | command | pilot s | projected s | actual s | actual s per frame | peak resident MB |
|---|---|---:|---:|---:|---:|---:|
| 1 | F-0 | 1181 | 12105 | 10552 | 51.47 | 6140 |
| 2 | F-0e detect bands | 92 | 943 | 744 | 3.63 | 2911 |
| 2 | F-0e detect bands+strips | 7 | 72 | 6 | 0.03 | 435 |
| 2 | F-0e read bands+strips | 1146 | 11747 | 10008 | 48.82 | 7112 |
| 3 | F-0c detect | 36 | 369 | 285 | 1.39 | 2009 |
| 3 | F-0c read | 124 | 1271 | 1139 | 5.56 | 7633 |
| 3 | F-0c base | 82 | 841 | 747 | 3.64 | 551 |
| 4 | F-0f probe | 2 | 21 | 13 | 0.06 | 136 |
| 5 | Q-2b features | 6 | 62 | 27 | 0.13 | 255 |
| 5 | Q-2b outlines | 435 | 4459 | 3810 | 18.59 | 699 |
| 5 | Q-2b table | 0 | 0 | 1 | 0.00 | 328 |
| 6 | H-2 stage | 11 | 113 | 89 | 0.43 | 575 |
| 6 | H-2 base | 78 | 800 | 687 | 3.35 | 558 |
| 7 | F-0i plan | 1 | 10 | 5 | 0.02 | 205 |
| 7 | F-0i tiles | 77 | 789 | 669 | 3.26 | 753 |
| 7 | F-0i resolve | 36 | 369 | 318 | 1.55 | 582 |
| 8 | NB-3 stage | 2 | 21 | 11 | 0.05 | 293 |
| 8 | NB-3 shelf | 31 | 318 | 279 | 1.36 | 1073 |
| 8 | NB-3 probe | 2 | 21 | 13 | 0.06 | 132 |
| 8 | NB-3 flags | 0 | 0 | 1 | 0.00 | 478 |
| 10 | F-0g pairs | 1 | 10 | 9 | 0.04 | 438 |
| 10 | F-0g evidence | 68 | 697 | 575 | 2.80 | 551 |
| 10 | F-0g copies | 0 | 0 | 1 | 0.00 | 479 |
| 11 | F-0h decide | 61 | 625 | 567 | 2.77 | 3487 |
| | **total** | **3479** | **35663** | **30556** | **149.05** | |

Step 9 (RB-1) is a function, not a command. Peak resident memory is the maximum resident set size that
`/usr/bin/time -l` reports for the command and the helpers it waited on.

- **Reading takes 71% of the time**, against 70% in the pilot: F-0, F-0e's read and F-0c's read take 21,699 of
  30,556 s. Q-2b's SAM 2.1 outlines come next, at 3,810 s.
- **A correction to the pilot's report.** The pilot report called H-2's stage time a lower bound, because its depth
  geometry was a cache hit. The run shows why it hit: F-0 runs NB-3's depth stage itself and writes the
  content-addressed geometry cache. H-2 then hit it on all 205 frames within the same run. The depth time is in F-0's
  row, not missing. F-0h scaled about linearly: 2.77 s per frame, against 3.05 s in the pilot.

## Agreement: `sf-store-001.every-3` beside `pilot-000`

The difference column is `sf-store-001.every-3` minus `pilot-000`.

| measure | `pilot-000` | every 3rd frame | difference |
|---|---:|---:|---:|
| default boxes per frame, mean (p50) | 198.2 (193) | 57.7 (56) | −140.5 |
| `vision` reading with text, share of default boxes | 0.6698 | 0.5260 | −0.1438 |
| `ppocr` reading with text, share | 0.7365 | 0.5559 | −0.1806 |
| `qwen` reading row, share (hard crops only, cap 40 per photo) | 0.2002 | 0.4855 | +0.2853 |
| `qwen` reading with text, share | 0.1795 | 0.4104 | +0.2309 |
| base decision: accepted, share | 0.1190 | 0.0470 | −0.0720 |
| base decision: `no-text`, share | 0.2221 | 0.3894 | +0.1673 |
| base decision: `no-catalog-match`, share | 0.5079 | 0.4532 | −0.0547 |
| base decision: `single-reader`, share | 0.1403 | 0.0979 | −0.0424 |
| base decision: `readers-disagree`, share | 0.0107 | 0.0125 | +0.0018 |
| `vision`+`ppocr` same work, share of boxes both confirm | 0.9104 | 0.8635 | −0.0469 |
| `vision`+`ppocr` same work, share of all boxes | 0.0893 | 0.0246 | −0.0647 |
| F-0's own run: accepted, share | 0.1041 | 0.0464 | −0.0577 |
| F-0's own run: `vision`+`qwen` same work, share of both confirm | 0.8084 | 0.7003 | −0.1081 |
| F-0's own run: `ppocr`+`qwen` same work, share of both confirm | 0.5965 | 0.4943 | −0.1022 |
| F-0i: kept, share | 0.9412 | 0.9694 | +0.0282 |
| F-0i dropped: `duplicate`, share of dropped | 0.3833 | 0.2689 | −0.1144 |
| F-0i dropped: `merged-parent`, share of dropped | 0.0500 | 0.1681 | +0.1181 |
| NB-3 flagged, share of the partition | 0.0132 | 0.0282 | +0.0150 |
| NB-3 flags: `pixel` cause, share of flags | 0.3951 | 0.8659 | +0.4708 |
| NB-3 flags: `depth` cause, share of flags | 0.5432 | 0.0945 | −0.4487 |
| F-0g copy groups: grouped boxes, share of default boxes | 0.0550 | 0.0776 | +0.0226 |
| F-0g grouped boxes with no basis (`none`), share | 0.7426 | 0.9248 | +0.1822 |
| F-0g grouped boxes `readers-agree`, share | 0.2308 | 0.0621 | −0.1687 |
| F-0h `confirmed-by-context`, share of its rows | 0.0904 | 0.0373 | −0.0531 |
| accepted boxes whose work is accepted in another frame, share | 0.3010 | 0.5665 | +0.2655 |

**Copy groups.** Every 3rd frame: 395 groups holding 918 boxes. By size: 302 groups of 2, 65 of 3, 21 of 4 and 7 of 5.
`pilot-000`: 154 groups holding 338 boxes. **Groups that span more than one frame: 0 on both sets**, as expected:
F-0g pairs neighbours inside one photo.

**Work recurrence** (the cross-frame signal, pre-registered measure 8). Every 3rd frame: 556 accepted boxes over 333
works. 108 of those works are accepted in two or more frames, and 315 accepted boxes (0.5665) have their work accepted
in another frame too. `pilot-000`: 731 accepted boxes over 516 works; 85 works and 220 boxes (0.3010). The frames are
about 3 s apart here, so recurrence at the session's 1 s spacing would differ. It is machine agreement: two frames may
show two copies of one work.

**RB-1's box set**: 11,282 boxes (`pilot-000`: 5,757). **F-0h usable**: 850 of 1,181 rows (`pilot-000`: 864 of 985).

## The video-tier note (observations, not tuning)

These are the figures that moved most against `pilot-000`. Each cause named is a hypothesis unless it says otherwise.

- **Text from the per-crop readers falls, and the base decision accepts less than half as often** (0.047 against
  0.119). `vision` and `ppocr` find text on 14 and 18 points fewer of the boxes, and `no-text` becomes the outcome for
  0.389 of boxes, up from 0.222. Fewer pixels per spine and motion blur are hypotheses.
- **`qwen` reads far more of the boxes.** Its share of boxes more than doubles (0.20 to 0.49). Part of this is
  arithmetic, not a hypothesis: `qwen` reads up to 40 hard crops per photo, and a frame has about 58 boxes against
  about 198. A larger share of a frame's boxes is hard, which is a hypothesis about the readers. Where `qwen` and
  another reader both confirm a work, they agree less often, by about 10 points for each pair.
- **NB-3's flags change cause.** The flagged share doubles (0.013 to 0.028), and the pixel cause goes from 0.40 to 0.87
  of flags while the depth cause falls from 0.54 to 0.09. Depth from MoGe-2 on 2 MP frames is a hypothesis for this.
- **Copy groups carry less evidence.** 0.92 of grouped boxes have no basis, against 0.74. `readers-agree` falls from
  0.23 to 0.06, which follows the fall in reader text. F-0h's context rule confirms 0.037 of its rows, against 0.090.
- **F-0i keeps more boxes, and drops them for other reasons**: more `merged-parent`, fewer `duplicate`.
- **Accepted works recur across frames.** 0.57 of accepted boxes have their work accepted in another frame of the
  sample. Overlapping sweeps are the plain reason; this is the signal the tracking and fusion card would use.

## Changes (code and records)

- `samplePart` in `src/eval/set-paths.ts`, used by `sessionImages`, `acceptSet`, `setPaths` and F-0's photo list. It
  adds the sample part `<session>.every-<n>`, which is never declared, so it is never manifested, exported or trained
  on. Tests are in `test/f0-frames-sample.test.ts`; `pilot-000`'s and the whole session's paths and lists are unchanged.
- `src/eval/f0-frames-cli.ts`: the pre-registered aggregates (`measure`, the same code on both sets) and the time-only
  record (`pilot`). Three fixes came after its first `measure` on this run, with tests:
  - a sample part's frames are counted from its session's list, since it has no manifest of its own;
  - F-0c's `accepted` is the work id itself, and the first pass had put every accepted box under one work;
  - copy-group sizes now count groups; the first pass counted boxes.

  None of the three changes a measure, and all are logged in `implementation-notes.md`.

## What was not done

- The other two thirds of `sf-store-001`'s frames; `sf-store-002`, TS-0 and TS-2 (later cards). No live catalog
  lookup, no download, no `contracts/` change.
