# Backup: the data root on the home NAS, and a drill that proves a restore

Until DL-6 nothing under the data root was backed up: one internal disk held all of it (about 72 GB), and the
data-layer grill (2026-11-05) accepted that until a NAS existed. DL-1 made writes crash-safe and DL-3 stamped every
derived file; the remaining risk was losing the disk. `bookcase backup` copies the data root, versioned, to a share
on the home NAS that the owner mounts, and `bookcase backup restore-drill` proves the copy rebuilds the labels.

The NAS's name, address, share, account and mount point never appear in this repo, its PRs or its logs: the share
is an argument (`--target <mount>`), and the commands print counts, bytes and seconds, never a path or a file name.

## Classes of file

From [`docs/lineage.md`](lineage.md) and `SKIP_DIRS` in `src/eval/lineage-classes.ts`; the code is `classOfPath` in
`src/ledger/backup.ts`. **Everything is copied.** The classes decide the verify order and what the restore drill
brings back, not what is skipped.

| class | what | where | if lost |
|---|---|---|---|
| **fact** | the event ledgers; originals; labels; the private fixture manifests with the permission log; the frozen dataset history (`splits.json` cannot be regenerated, DL-1) | `ledger/`, `images/`, `raw/`, `labels/`, `private/fixtures/`, `datasets/` | gone for good |
| **derived** | stage caches, the depth and fusion caches, the proxy sets; each has a lineage stamp and a rebuild command | `f0*/`, every folder under `private/` but `fixtures/`, `proxy/` | hours of GPU time for some |
| **re-fetchable** | model weights (pinned by revision in the models manifest), catalog dumps and catalogs | `models/`, `catalog/` | a download, and hours to rebuild a catalog |
| **unclassified** | anything the rows above do not name: a top-level folder no card owns yet, a loose file under `private/` or at the top | | treated like a fact until it is named |

Left out of every snapshot, and counted (never named) in the output:

- **The credentials file** `labels/ls-credentials.txt` (Label Studio's local login). The backup never opens, hashes,
  copies or names it; a test checks that neither its name nor its bytes reach the target or the output. Whether Time
  Machine includes it is the owner's system, not this card's: Time Machine copies the whole disk as it is.
- `private/restore-drill/` under the data root: the drill's own scratch roots, which are restores of the backup.
- A fact database's `-wal`, `-shm` and `-journal` files (its consistent copy holds what they held), and any other
  database's `-shm` (a shared-memory index SQLite rebuilds). A catalog's `-wal`, when one exists, is copied.

The two empty files at the data root's top level (`catalog.stats.sqlite` and `ledger.sqlite`, 0 bytes) are copied as unclassified, reported by `run` as a count, and never removed.

## How it works

**Consistency.** The ledgers are SQLite in WAL mode (`src/ledger/sqlite.ts`). A plain copy of the file while a
writer is open can catch a WAL half checkpointed, and Time Machine copies files as they are. So every SQLite file
among the facts is copied with SQLite's own backup path first: `VACUUM INTO` from a read-only connection, which reads
the last committed state whatever a writer has open, into a private temporary folder and from there to the target.
A test holds a writer open with committed rows still in the WAL and uncommitted rows in flight, and checks the copy
has every committed row and none of the others.

**Versioned, never mirrored.** The share refuses hard links, so a dated folder of full copies would cost the whole
data root on every run. Each file body is stored once instead, named by its sha256, and each run writes one dated
snapshot folder holding its fact manifest, which maps every path to its body:

```
<mount>/bookcase-discovery/
  objects/sha256/<aa>/<sha256>                 every file body, written once, never rewritten
  snapshots/<2026-11-07T23-51-02Z>/backup-manifest.json
  incoming/                                    this repo's temporaries while a body is copied
```

Nothing on the target is overwritten, and nothing a kept snapshot names is deleted: a file deleted (or corrupted)
at the source simply has its old body in the older snapshots. A body is copied to a temporary, fsynced and renamed into
place, and named by the bytes actually read, so a file that changes mid-run is stored under its new hash (the run
counts these) and never under a wrong one. The manifest is written last, so a snapshot without one never happened.
This repo writes only inside `bookcase-discovery/` on the share, which other tenants share.

**Unchanged files are not copied again.** A file whose size and mtime match the previous full snapshot's entry keeps
that entry's hash and is not read. Any other file is hashed locally and copied only when the target has no body with
that hash. The first run copies everything; later runs copy what changed.

**The fact manifest** (`backup-manifest.json`): every file's path relative to the data root, class, size, mtime, mode
and sha256 (the fact databases marked as consistent copies), the symlinks, every lineage stamp the run saw (keyed by
the file it describes), and the counts per class. It is private: it lives on the NAS, never in the repo.

**Retention.** `run` keeps the newest `--keep` full snapshots (default 12) and prunes older ones: first the manifest,
then the bodies no remaining snapshot names. `snapshot` keeps its own count the same way. Because unchanged bodies are
shared, a snapshot costs the target only what changed since the one before; the sizing is in the PR that landed DL-6
(bytes per snapshot, measured) and in the table below.

## Commands

```bash
node bin/bookcase backup run --target <mount>             # weekly, and after every capture or labelling session
node bin/bookcase backup snapshot --target <mount>        # the ledgers alone, in seconds; after any session that wrote one
node bin/bookcase backup verify --target <mount>          # re-hash the latest snapshot's facts (--all: every class)
node bin/bookcase backup restore-drill --target <mount>   # monthly, and after any change to this code
```

`verify` re-hashes the facts and unclassified files on the target against the latest manifest (`--snapshot <id>` for
another) and checks the rest by size, or re-hashes everything with `--all`. It prints, per class, checked, ok, missing
and changed, and exits 1 on any failure.

`restore-drill` is the exit that matters. It restores the latest full snapshot into a fresh scratch root, the data
root's `private/restore-drill/<date>/`: the facts, the derived and unclassified files, and of the re-fetchable inputs
only the two that TS-0's build reads (the models manifest and the catalog with its stamp and statistics sidecar).
Dataset versions and `latest.json` are not restored, so the build writes its version anew. Every body is re-hashed as
it is read; a mismatch stops the drill. Then, with the scratch root as the data root, it runs `bookcase replay` on
each restored ledger and `bookcase dataset build`, and compares the TS-0 version id (and the bytes of its
`labels.jsonl`) with the live one. It exits 0 only when every replay is identical and the version matches. The
scratch root is left in place for the owner to inspect; nothing under the data root is ever deleted.

The drill restores derived data as well as facts, because TS-0's build reads the stage caches (F-0c's detections,
F-0e's readings, H-2's base decisions, F-0g's copies, F-0h's context, Q-2b's rungs, F-0i's partition, NB-3's flags),
not only the facts. Rebuilding those from the facts alone means re-running the GPU stages, hours of work; the drill
proves the backup rebuilds the labels, which is what a restore after a lost disk needs.

Exit codes: 0 done, 1 a failure (verify or drill), 3 the target is missing or unwritable.

**A locked or missing share.** The share is encrypted, and after a NAS reboot it stays locked until the owner unlocks
it. A missing or read-only target is reported ("is the share mounted and unlocked?", exit 3) and never retried, and the
target folder is never created.

## The owner's part (the commands cannot do these)

These are system settings, accounts and network setup; no command here touches them or handles a password.

1. **NAS on the home network only.** The vendor's cloud sync, remote access and relay features off for the share that
   holds the book data. Private photos never go to the cloud.
2. **Encryption at rest** on that share, with the key kept by the owner.
3. **Mount the share** on the Mac that holds the data root (Finder → Go → Connect to Server) and pass the mount point
   as `--target`.
4. **Optional: Time Machine to the NAS** for the whole Mac. It versions everything hourly, but it copies SQLite files
   as they are, so it is not enough on its own for the ledgers; `bookcase backup` is what makes their copy consistent.

## How often (proposal)

| what | when | why |
|---|---|---|
| `backup snapshot` | after any session that appended to a ledger | seconds; the ledgers are the facts that change most |
| `backup run` | weekly, and after every capture or labelling session | new originals and labels are the facts that cannot be re-made |
| `backup verify` | after every `run` | re-hashes the facts on the NAS (about a gigabyte) |
| `backup restore-drill` | monthly, and after any change to `src/ledger/backup.ts` | a backup that has not been restored is a hope |

## Still not covered

- **A second copy away from the house.** A fire or a theft takes the Mac and the NAS together. Without the cloud, the
  answer is a drive kept elsewhere (a USB disk with the same `--target`, swapped monthly): the owner's call.
- **Both bays at once.** RAID 1 survives one disk, not a controller fault, a bad firmware update or a mistaken delete
  on the NAS itself; the versioned snapshots cover the last of these only for files this repo wrote.
- **Silent corruption at the source.** A file whose size and mtime have not changed is not re-read (rsync's quick
  check), so a change that keeps both goes unseen until the file is written again. The older snapshots keep the body
  they copied. A periodic run that re-reads everything is a follow-up if wanted.
- **Scheduling.** Nothing runs on its own; a launchd job is the owner's system setting, not this repo's.
