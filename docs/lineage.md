# Lineage: what every derived file came from

The owner's ruling (2026-11-05, the data-layer grill): the ledger holds facts, and everything else under the data
root is **derived data** that can be rebuilt, so every derived file must say what produced it. DL-3 gives each one a
**lineage stamp**, a sidecar `<file>.lineage.json` beside the file (`src/ledger/lineage.ts`):

| field | what it names | where it comes from |
|---|---|---|
| `boxSet` | the box-set hash TS-0 computes, or null upstream of any box set | `setInputs` in `src/eval/ts0-cli.ts` |
| `models` | model folder name → `sha256:` content hash of its weights | the models manifest (below) |
| `catalog` | the catalog's content stamp, or null when none was read | `catalogStamp` in `src/catalog/rarity.ts` (DL-1) |
| `codeCommit` | the git commit of the code that wrote the file, and a `dirty` flag | `git rev-parse HEAD`, `git status` over `src/`, `helpers/`, `bin/` |
| `schema` | the file class and its own format version | the writer (`STAGE_SCHEMAS` in `src/eval/f0.ts`, `src/eval/lineage-classes.ts`) |
| `writtenAt` | when the file was written | the writer |
| `restamped` | present on a file stamped by the re-stamp pass: when, and which fields it assumed | `bookcase lineage restamp` |

**Why a sidecar, not a first line.** A header line inside the JSONL would have changed `readJsonl` and its callers
and broken the Python helpers (`resolve.py`, `stage.py`, `strata.py`) that read the same files line by line. The
sidecar is written durably (`writeFileDurable`) after the file it describes: a crash between the two leaves a file
with no stamp, or an old one, and a reader refuses either.

## Readers refuse stale files

A reader that opens a stamped file compares the stamp's `schema`, `boxSet`, `models` and `catalog` with the inputs it
has in hand (`checkLineage`) and refuses on the first difference, naming the field:

```
f0/pilot-000/qwen.jsonl: stale: models.qwen3-vl-4b-8bit is sha256:1f4c… in the stamp, sha256:9a02… now: rebuild it, or pass --allow-stale
f0/pilot-000/qwen.jsonl: no lineage stamp (written before DL-3?): run `bookcase lineage restamp`, or pass --allow-stale
```

The comparison is cheap by design: the current model hashes come from the manifest (read once a process), the
catalog's from its `meta` table, and nothing is hashed on a read. `codeCommit` is recorded, never compared: every
merge would otherwise refuse every cache, and the owner's caches take hours of GPU time to rebuild.

`--allow-stale` (on `f0-cli.ts` and `bookcase dataset`) or `BOOKCASE_ALLOW_STALE=1` (any runner) logs the
difference and reads anyway. A stage that then appends to such a file re-stamps it with its own inputs, so the
file's history is the owner's choice to mix, logged on stderr at the time.

Readers that check today: F-0's stage functions before they append (`detectStage`, `probeStage`, `visionStage`,
`pyReaderStage`), `loadReadings` (every card that reads the readers' caches), TS-0's `setInputs` (the detection
cache) and `report` (the version), H-2's `faceRows`, F-0i's `partition` and RB-1's `loadBoxSet`. A `readJsonl` call
elsewhere does not check; the list grows as cards touch their readers.

## The models manifest

`$BOOKCASE_DATA/models/manifest.json` (`src/ledger/models.ts`, `bookcase models manifest`): for every folder under
`models/`, its name, the Hugging Face revision recorded by the download (when there is one) and a content hash over
every file in it (weights, configs, tokenizers; the `.cache/` download metadata is left out). Each file's hash is
kept with its size and mtime, so a refresh re-hashes only a file that moved; the first build reads every byte once.
`bookcase models list` prints it. The weights and the manifest are private.

Run `bookcase models manifest` once after any model folder changes. A stage refuses to run without the manifest or
with a model it does not name.

## Derived file classes

| file | derived from | rebuilt by | stamp field that would change |
|---|---|---|---|
| `<stage>/detect.jsonl` (F-0) | the photos, the arm's detector and SAM 2.1 weights, the tiling (in each row), `helpers/label/detect.py` | `src/eval/f0-cli.ts pilot\|yardstick` into a fresh stage folder | `models.<arm's models>`, `schema` |
| `<stage>/probe.jsonl` (F-0f, NB-3) | `detect.jsonl`, the photos' pixels, `helpers/label/probe.py` | `probeStage` (F-0f's runner) | `schema.version` (2 since NB-3) |
| `<stage>/vision.jsonl` | `detect.jsonl`, the crop method (in each row), Apple Vision (the OS; no folder, so `models` is empty) | `visionStage` | `schema` |
| `<stage>/ppocr.jsonl`, `qwen.jsonl` | `detect.jsonl`, the crop method, the reader's weights, `helpers/label/read.py` | `pyReaderStage` | `models.pp-ocrv5`, `models.qwen3-vl-4b-8bit` |
| `private/h2/<set>/stage-<tag>.jsonl`, `stage-latest.jsonl` | `detect.jsonl`, the photos, MoGe-2's weights, `helpers/depth/{stage,geometry,faces}.py` | `src/eval/h2-cli.ts stage <set>` | `models.moge-2-vitl-normal` |
| `private/h2/<set>/faces.jsonl` | the stage file above, RB-1's kept ids | `h2-cli.ts stage <set>` | `models.moge-2-vitl-normal` |
| `private/f0i/<set>/partition.jsonl` | `detect.jsonl`, F-R1's pairs, H-2's depth, SAM 2.1 conflict tiles, `helpers/coverage/resolve.py` | `src/eval/f0i-cli.ts plan`, `tiles`, `resolve <set>` | `models.sam2.1-hiera-base-plus`, `models.moge-2-vitl-normal` |
| `datasets/label-ledger/<version>/{manifest.json,labels.jsonl,build.json}` | RB-1's box set, F-0's decisions, F-0g copies, F-0h context, Q-2b rungs, the readers' caches, the catalog and its statistics sidecar, the private fixture manifests (capture provenance, NS-4) | `bookcase dataset build` (a new version beside the old) | `boxSet`, `models.*`, `catalog`, `schema.version` (2 since NS-4; the re-stamp pass stamps a legacy version with its manifest's own schema version, so it is refused as stale until rebuilt) |

A stage folder is any folder holding these file names: `f0/<session>/`, `f0c/<set>/`, `f0e/<set>/<tiling>/`,
`f0f/<set>/<variant>/` and the reader variants under `private/<card>/<set>/<variant>/`.

Not stamped yet (each is a follow-up for the card that owns its writer): F-0's `decisions.jsonl` (its catalog differs
per session: the inventory catalog for the yardstick), F-0g's copies, F-0h's context decisions, Q-2b's rung table,
NB-3's flags, MM-1's records (they carry their own version key), H-2's byte cache under `private/h2/cache/`
(`stage.py` keys it by revision and code already), the catalog and its sidecar (DL-1's own stamp) and the
aggregates under `evals/`.

## The re-stamp pass

Files written before DL-3 have no stamp and are refused until `bookcase lineage restamp` runs once. The pass walks
the data root for the classes above, skipping inputs and facts (`SKIP_DIRS` in `src/eval/lineage-classes.ts`), and
gives every file with no stamp one. It cannot know which weights produced an old file, so it records the manifest's
current hashes and, for a dataset version, the current catalog's stamp, and says so: `restamped.assumed` lists the
fields it took from the current state, and `codeCommit.commit` is null. A detection cache's arms come from its rows;
a dataset version's box set from its `build.json`. A file that already has a stamp is left alone, so the pass is
idempotent, and `--dry-run` prints the counts only. It never deletes anything.

```bash
node bin/bookcase models manifest          # once, then after any model folder changes
node bin/bookcase lineage restamp --dry-run
node bin/bookcase lineage restamp
node bin/bookcase lineage show "$BOOKCASE_DATA/f0/pilot-000/qwen.jsonl"
```
