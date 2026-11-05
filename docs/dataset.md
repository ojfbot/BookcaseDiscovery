# Datasets: the manifest, grouped splits and the label ledger (F-1, TS-0)

`bookcase dataset build` turns every experiment's machine labels into one versioned training set under
`$BOOKCASE_DATA/datasets/`. It is private. Nothing in it leaves the machine until G-PUB rules, and no weight trained
on it leaves until G-W rules. The repo holds this page, the schema in code and the aggregate counts in
[`evals/TS0`](../evals/TS0/report.md).

```bash
node bin/bookcase dataset build              # default set: pilot-000; --set <name> to choose (repeatable)
node bin/bookcase dataset report             # evals/TS0/{metrics.json,report.md} from the latest version
```

It runs on the CPU, from caches, in about 40 s. It reads:

- RB-1's box set;
- F-0's cached decisions;
- F-0g's copies;
- F-0h's context decisions;
- Q-2b's rung table;
- the v1 catalog and its statistics sidecar;
- the fixture's ledger and private manifest.

`sips` computes each photo's dHash once. The hashes are cached in `datasets/cache/dhash.json`.

## Layout

```
$BOOKCASE_DATA/datasets/
  cache/dhash.json                    working-copy hash -> 64-bit dHash
  label-ledger/
    latest.json                       { "version": "v-…" }
    splits.json                       frozen split per photo (working-copy hash -> train | val | held-out)
    v-<12 hex>/
      manifest.json                   F-1: one row per photo (DatasetManifest, src/capture/dataset.ts)
      labels.jsonl                    TS-0: one row per label (LabelRow, src/eval/ts0.ts)
      build.json                      the hashes, skipped boxes and the counts
```

## The version

The version is `v-` plus 12 hex digits of a hash of two hashes (`versionKey` in `src/eval/ts0.ts`):

- **The box-set hash.** Every kept box's id, detection rectangle and exclusive outline.
- **The model-revision hash.** It covers:
  - the detector arm and layout;
  - each reader's model;
  - the crop method;
  - the catalog's and sidecar's stamps;
  - F-0's acceptance bar;
  - C-7's constants;
  - F-1's constants;
  - the sha256 of every cache read.

A box-set or model change gives a new version beside the old ones, so a training run can name exactly what it read.
The same inputs give the same version and byte-identical files. Re-run `build` after every such change.

**DL-1: one new version.** Before DL-1 the catalog's and sidecar's stamps were `size:mtime`, so a copy or a touch
of the catalog gave a new version. They are now content stamps (`docs/catalog.md`, "Content stamp"). The first build
after DL-1 therefore gives one new version, with the same rows. Re-stamp the sidecar first (`openStats` refuses a
pre-DL-1 one), then build:

```bash
node bin/bookcase catalog restamp
node bin/bookcase dataset build
```

## Crash safety (DL-1)

Nothing is backed up until a NAS exists, so the files nothing can rebuild are written by `writeFileDurable`
(`src/ledger/durable.ts`). It writes a temporary file beside the target, fsyncs it, renames it over the target and
fsyncs the folder. A killed process or a power cut leaves the old file or the new one, never half of either.

- `splits.json` is frozen history, and `latest.json` must not name a version whose files are not all down.
  `commitVersion` in `ts0-cli.ts` writes the version's files first, then `splits.json`, then `latest.json`, each
  this way. `datasets/cache/dhash.json` is written the same way, so a torn cache never blocks a build.
- Other writers of facts and frozen records written this way:
  - the private manifest (`writePrivateManifest`);
  - originals and working copies in the image store (`ImageStore.put`);
  - hand labels and their rolling backup (`labels:import`);
  - the profile seeds (`writeSeeds`);
  - the weights registry record (`ts2-cli.ts register`).
- The ledger is SQLite in WAL mode with the default `synchronous`, which is already durable, so it is unchanged.

Stage caches are JSONL files appended line by line by `openAppender`. It keeps one descriptor open and fsyncs at most
once a second and on close. On 200,000 synthetic 340-byte lines (68 MB, M4) the old one-`appendFileSync`-per-line
path took 4.3 s and the appender takes 0.5 s. An fsync per line costs about 4 ms a line, some 800 s for the same file.
A crash loses at most the last second of lines, and those are recomputed on the next run.

`readJsonl` (`src/eval/f0.ts`) skips a **torn last line**, one that does not parse. It reports the file (relative to
the data root) and the row count on stderr and leaves the line in the file. A bad line anywhere else still throws.
Before its next append, `openAppender` moves a torn tail to `<file>.torn`, so new lines never land behind it. The
fragment is kept, never deleted. A last line that parses but lacks its newline gets one.

## Manifest rows (F-1)

One row per photo:

- `sha256`, `originalSha256`, `path` and `size`. The path is the working copy's place in the content-addressed
  store, relative to the data root.
- `session`, `storeId`, `bookcaseId`, `shelf` and `setting`.
- `dhash`.
- `captureGroup`, `splitGroup` and `split`.
- `nearDuplicates` and `crossGroupNearDuplicate`.

The capture instant is read to form capture groups and is never written.

Splits are assigned to **split groups**, so a split never cuts a group:

- A split group is a capture group (no gap over 120 s) joined with the same bookcase's photos (in its store, any
  session) and with near-duplicates (dHash within 8 bits).
- A group with a frozen photo keeps the most conservative frozen split among its photos.
- `sf-store-002`'s groups are held out.
- The rest fill `val` to about 20 % of the photos in seeded order (seed 1), and go to `train` after that.
- Every photo's split is frozen in `splits.json`, so later versions never move a photo across splits.

`test/dataset.test.ts` checks the no-straddle property on 200 random datasets. The guard rule `datasets-dir`
rejects images, videos, weights and row files under any `datasets/` directory in the repo, including under
`test/fixtures/synthetic/` (`docs/privacy.md` rule 12).

## Label rows (TS-0)

One row per confirmed label on a kept box:

| Field | What it is |
|---|---|
| `version`, `boxSet`, `modelRevision` | INV-14: what produced the label |
| `set`, `boxId`, `imageSha256`, `path` | which box, on which working copy |
| `polygon`, `outline`, `crop` | the detection rectangle, F-0i's exclusive outline where it changed the box, the readers' crop method |
| `workId`, `title`, `authors` | the label, from the v1 catalog |
| `basis` | `readers-agree`, `confirmed-by-copy` or `confirmed-by-context` |
| `readers`, `agreeing` | the readers that voted, and TS-1's agreeing pair (null for one reader) |
| `rung` | Q-2b's coverage rung from the box's own reads |
| `titleClass` | `distinctive`, or `shared` (shared or one-word title; no title form counts as shared) |
| `thirdReader`, `dissenting` | TS-1's M5 on two-reader `readers-agree` labels; readers confirming another work |
| `sharedBacking` | on a shared title: C-7's namesake test passes, and/or a reader read the author; null when distinctive or when no voting reader's top is the work |
| `strong` | distinctive, `readers-agree` with two readers, nothing dissenting |
| `split`, `captureGroup`, `splitGroup`, `nearDuplicate` | the photo's F-1 fields |

The strong class is a flag, never a filter. TS-2 chooses what to train on.

## What is never exported

- **Yardstick, PROXY and audit sets (OC35).** `assertTrainable` refuses any set or session whose name holds
  `yardstick`, `proxy` or `audit`. It runs:
  - before `build` reads anything;
  - on every row;
  - on every manifest photo, in `assertExportable` before anything is written.
- **Hand labels (OC36).** `assertMachineBasis` refuses any basis but the three shipped machine bases. That includes
  owner corrections, taps and `confirmed-by-pooling` (F-0g2 did not ship).
- **Crops.** Rows carry crop geometry and the store path. The trainer cuts its own crops, under the data root.
