# The SQLite ledger

Durable, replayable state (INV-14). The `Ledger` interface is in [`contracts.md`](contracts.md); words are in [`CONTEXT.md`](../CONTEXT.md). Code: `src/ledger/sqlite.ts`, `status.ts`, `images.ts`, `replay.ts`.

## Storage

`node:sqlite` (Node's built-in SQLite), not `better-sqlite3`: `docs/probe.md` shows its bundled SQLite (3.53.4) has FTS5 trigram, which C-1 needs, and it adds no native dependency. The choice is logged in `implementation-notes.md`.

- **WAL mode**, `foreign_keys` and `recursive_triggers` on. `user_version` carries the schema version; the ledger refuses a database it does not recognise.
- **`events(seq, ts, run_id, type, payload)`** is the source of truth. `payload` is JSON text. `UPDATE` and `DELETE` are rejected by trigger (`INSERT OR REPLACE` too, through `recursive_triggers`), and a trigger keeps `seq` gap-free.
- **Views** are tables derived from the events and updated incrementally, in the same transaction as the event insert. A refused event rolls back and leaves no row, no event and no gap in `seq`.

| Table | Holds |
|---|---|
| `images`, `rejections` | `ImageAssetIngested` and `ImageRejected` payloads |
| `observations` | the spine, and the latest hypotheses, band and status (with the `seq` that set it) |
| `observation_texts`, `observation_adjudications`, `observation_corrections` | one row per event, in order |
| `work_items` | the opening payload and the resolution |
| `recommendations` | the current recommendation and how many times it was revised |
| `runs` | the budget, the spend counted so far, and the outcome |
| `tracks`, `cards`, `adjudication_requests` | the live track (S9, T-0): each track's latest edge and whether it was ever `stable`; each card's current state, status and the revisions that can still be undone; each live adjudication request and whether it is answered |

`FrameSample`, `TrackWindow`, `OcrReading`, `LookupResult` and `AdjudicationCacheHit` have no table: they are checked on append (`src/ledger/live.ts`, [`contracts.md`](contracts.md)) and read from `events`. A live `AdjudicationResult` adds to `runs` exactly as `AdjudicationRecorded` does. The schema version is 2 (T-0 added the three tables). A writable `SqliteLedger` upgrades a version-1 file in place on open, by creating the three empty tables (a version-1 log holds no live events); a read-only open of a version-1 file is refused, so open it once writable before `bookcase replay`.

`viewDump()` reads these tables, not the events. The in-memory ledger folds the same events with `views.ts`; `test/ledger-behaviour.ts` runs the same tests against both, and a test checks their dumps are equal.

## Status machine

`src/ledger/status.ts` holds the table of legal transitions; the in-memory and SQLite ledgers both call it. `StatusChanged.from` must be the observation's current status. There is no `exhausted` (INV-1).

| From | To | Needs `cause` |
|---|---|---|
| (none) | `unresolved` | no |
| `unresolved` | `resolved` | no |
| `unresolved` | `needs-pixels` | no |
| `unresolved`, `needs-pixels` | `paused` | `budget-spent` |
| `needs-pixels` | `unresolved`, `resolved` | no |
| `paused` | `unresolved` | no |
| `resolved` | `unresolved` | a trigger: `new-image`, `correction`, `model-change`, `catalog-refresh` |

- **A pause is the only effect of a spent budget** (INV-2). A `budget-spent` cause is accepted when the run (from its `RunStarted`) has reached its adjudication or token cap, counted from `AdjudicationRecorded` events that were not cache hits. Once a cap is reached, a further paid adjudication in that run is refused; the last call may overshoot a token cap because tokens are known only after the call. A spend cap (`maxSpendUsd`) cannot be counted from events, so a pause under one is taken on the scheduler's word (I-5).
- **A trigger is an event.** `new-image`, `correction` and `model-change` cite `eventSeq`: an earlier `ImageAssetIngested`, an `IdentityCorrected` for that same observation, or a `RunStarted`, in each case later than the event that resolved the spine. A trigger is spent once the spine is resolved again. `catalog-refresh` has no event type yet, so it cites nothing and is not checked.
- A transition that takes no cause is refused if it carries one.

## Replay

```
bookcase replay <db> --to <fresh db>
```

Reads `<db>` read-only, appends every event into a new database (which must not exist) through the same `append`, then diffs the event lists and every view of the two. Exit 0: identical. Exit 1: differences, one line each with the path (`views.observations[0].status: "paused" != "resolved"`). Exit 2: usage error or unreadable database. A source log the status machine or the contracts would now refuse is reported as `event N (...) refused on replay`.

## Image store

`<$BOOKCASE_DATA>/images/sha256/<aa>/<bb>/<hash>.<ext>`, `aa` and `bb` the first two byte pairs of the hash (`$BOOKCASE_DATA` defaults to `~/data/bookcase-discovery/`; never in the repo). Originals and working copies share the store and are told apart by hash. `ImageStore.put` writes beside the destination and renames, is idempotent, and makes the file read-only (INV-12). Other modules need only the path layout.
