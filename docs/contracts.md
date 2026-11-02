# Contracts

The record shapes every module writes and every helper speaks. Words are defined in [`CONTEXT.md`](../CONTEXT.md).

**The JSON Schemas in [`contracts/`](../contracts) are the source of truth** (OC13). Swift (Codable), Python and a later iOS app read the same files; there is no second copy. The Zod validators in `src/ledger/` are written by hand against them, and `test/contracts.test.ts` proves the two agree.

```
contracts/
  common.schema.json        primitives, enums, small shared shapes
  event.schema.json         the ledger envelope; maps `type` to a payload schema
  events/<Type>.schema.json one payload schema per event type (17)
  helpers/*.schema.json     JSON Lines records for the detect and OCR helpers (4)
test/fixtures/contracts/    synthetic examples: valid ones here, invalid ones under invalid/
src/ledger/contracts.ts           Zod validators for events
src/ledger/helper-contracts.ts    Zod validators for helper records
src/ledger/schemas.ts             Ajv, loading the schema files
src/ledger/ledger.ts              the Ledger interface
src/ledger/memory.ts              the in-memory implementation
```

Schemas are JSON Schema draft-07 with `additionalProperties: false` throughout, so an unknown field is an error, not a silent drop.

## Conventions

- **Ids** (`observationId`, `workId`, `sessionId`, …) are opaque non-empty strings chosen by the emitter. Never parse them.
- **Hashes** are lower-case hex SHA-256 (64 characters). `imageHash` is the original's; `workingCopyHash` is the GPS-stripped copy's.
- **Timestamps** are ISO 8601 with `Z` or a numeric offset. The emitter supplies `ts`; the ledger never stamps time, so replay is deterministic.
- **Polygons** are exactly four `[x, y]` corners in the pixel grid of the image they refer to (original-image pixels). A detector that finds free-form regions emits the minimum-area rotated quad. *Open:* which EXIF orientation that grid uses is not yet fixed; see `implementation-notes.md`. The detect response echoes the decoded image size so a mismatch is detectable.
- **Shelf** and **ordinal** are zero-based: shelf 0 is the top, ordinal 0 is leftmost.
- **Confidence** (`score`, OCR `confidence`) is a number from 0 to 1. Candidate and evidence scores are unbounded numbers; bands are not probabilities.

## Enums

| Enum | Values | Notes |
|---|---|---|
| Status | `unresolved` `resolved` `paused` `needs-pixels` | No `exhausted` (INV-1). Budget exhaustion gives `paused` (INV-2) |
| Band | `verified` `probable` `candidate` `unknown` | Evidence bands |
| Unresolved reason | `missing-pixels` `no-catalog-candidate` `conflicting-evidence` `strategies-exhausted` | A reason on an observation (INV-8), never a shelf state |
| Photo setting | `whole-12` `whole-48` `shelf-48` `overview` | |
| Rotation | `0` `90` `180` `270` | Degrees clockwise, before OCR |

## Events

Every event is an envelope `{ seq?, type, ts, runId, payload }`. `seq` is assigned by the ledger on append and absent on a new event (`NewEvent` vs `LedgerEvent` in `contracts.ts`).

| Event | Payload (required fields) | Notes |
|---|---|---|
| `ScanSessionOpened` | `sessionId`, `minPixels` | |
| `ImageAssetIngested` | `sessionId`, `imageHash`, `workingCopyHash`, `format`, `width`, `height`, `setting`, `capturedAt`; optional `shelfIndex`, `flags` | `flags`: `edited-derivative` |
| `ImageRejected` | `sessionId`, `fileName`, `reasons` (≥1); optional `fileHash` | Reasons: `below-min-resolution` `no-exif` `unsupported-format` `zero-byte` `icloud-placeholder` |
| `SpineObserved` | `observationId`, `sessionId`, `imageHash`, `setting`, `polygon`, `score`, `shelf`, `ordinal`, `detector{backend, weightsSha256}` | Raw observation (INV-3, INV-14) |
| `TextObserved` | `observationId`, `rotation`, `langCorrection`, `text`, `confidence`, `ocr{helper, os, requestRevision}` | One event per variant. `text` may be empty |
| `HypothesesProposed` | `observationId`, `candidates[]`, `unknown{score, evidence[]}` | `unknown` is required (INV-5). A candidate has `workId`, `title`, `author`, `score`, `evidence[]` (≥1); optional `editionId`, `year`, `series` |
| `AdjudicationRecorded` | `observationId`, `model`, `cropHash`, `candidateSetHash`, `choice` (workId or `null` for none), `cached`, `inputTokens`, `outputTokens`; optional `readText` | Cache key is (crop, candidate set, model). Agreement on one crop is one piece of evidence (INV-6) |
| `BandAssigned` | `observationId`, `band`, then `reason` **iff** `unknown`, else `workId` | Both schema and Zod enforce the either/or |
| `StatusChanged` | `observationId`, `from` (status or `null`), `to` | Legal transitions belong to L-2's status machine |
| `WorkItemOpened` | `workItemId`, `kind` (`closer-photo`), `observationId`, `shelf`, `ordinal`, `reason` | |
| `WorkItemClosed` | `workItemId`, `resolution` (`fulfilled` `withdrawn`) | |
| `IdentityCorrected` | `observationId`, `correction`: `{kind:"is", workId}` \| `{kind:"not", workId}` \| `{kind:"unreadable"}` | Identity only |
| `PreferenceRecorded` | `workId`, `preference` (`more` `less` `not-for-me` `already-read`) | Taste only. Shares no type or field with `IdentityCorrected` (INV-3, INV-7) |
| `RecommendationIssued` | `recommendationId`, `rankingVersion`, `recommendation{workId, observationId, rank, band, lens, rationale}` | `band` is shown beside the rank, never multiplied into it. `unknown` is not recommendable |
| `RecommendationRevised` | the above plus `previous{…}` and `reasonEventSeqs` (≥1) | Never silent (INV-21) |
| `RunStarted` | `codeCommit`, `helperVersions{name: version}`, `modelIds[]`, `budget{maxAdjudications?, maxTokens?, maxSpendUsd?}` | `codeCommit` may end `-dirty` |
| `RunFinished` | `outcome` (`completed` `paused` `failed`), `usage{adjudications, inputTokens, outputTokens, spendUsd?}` | A spent budget gives `paused` (INV-2) |

## Helper contracts

Each helper reads one JSON object per line from stdin and writes one per line to stdout. A request's `id` is echoed in its response, so a caller can pipeline. A helper that fails one request answers `{id, error:{code, message}}` and keeps running. A response is exactly one of the success shape or the error shape.

| File | Direction | Shape |
|---|---|---|
| `helpers/detect-request.schema.json` | core → detect | `{id, image}`, `image` the path of the working copy |
| `helpers/detect-response.schema.json` | detect → core | `{id, image:{width, height}, detections:[{polygon, score}], version:{backend, weightsSha256}}` or the error |
| `helpers/ocr-request.schema.json` | core → ocr-vision | `{id, image, polygon, rotations[]}` |
| `helpers/ocr-response.schema.json` | ocr-vision → core | `{id, variants:[{rotation, langCorrection, text, confidence}], version:{helper, os, requestRevision}}` or the error |

Example lines: `test/fixtures/contracts/helpers/*.jsonl`. Zod: `src/ledger/helper-contracts.ts`.

OCR semantics (card P-1; details in [`helpers/ocr-vision/README.md`](../helpers/ocr-vision/README.md)): the request polygon is in the stored pixels of the working copy and the helper applies no EXIF orientation; a request yields two variants per rotation, correction off then on, in request order; `rotations` may name 0, 90, 180 or 270; `confidence` is the mean over recognised lines and `text` joins them with a newline. TypeScript callers use `runOcr` in `src/perceive/ocr.ts`.

## The Ledger interface

`src/ledger/ledger.ts`. L-1 ships `MemoryLedger`; L-2 adds SQLite behind the same interface.

- `append(event): LedgerEvent` — validates with Zod, assigns `seq`, returns the stored event. With `{ crossCheck: true }` it also validates with the JSON Schema and refuses if the two disagree.
- `events(after = 0)` — events with `seq` greater than `after`, oldest first. `lastSeq()` is the newest.
- Views: `observation(id)`, `observations({sessionId?, imageHash?})`, `workItems({open?})`, `recommendations()`, `images(sessionId?)`, `rejections(sessionId?)`.
- `viewDump()` — every view as one plain ordered object. Equal dumps mean equal state; replay is checked on it.

`append` refuses (throws `LedgerError`, leaving the ledger unchanged) an event that fails its contract, carries a `seq`, names an observation, work item or recommendation the ledger has not seen, or reuses an existing `observationId`, `workItemId` or `recommendationId`. Results are copies; mutating one never changes the ledger.

## Changing a contract

1. Edit the schema in `contracts/`, and its validator in `src/ledger/`.
2. Add a valid example under `test/fixtures/contracts/` (named `<Type>.<variant>.json`) and, for a new rule, an invalid one under `invalid/`. Examples are synthetic: no real titles, no OCR text from real photos.
3. Run `pnpm test`. A new event type must be listed in `event.schema.json` (`type` enum and the `allOf` table) and in `payloadSchemas`; the tests fail until every one of those agrees.

The agreement test mutates every node of every example (delete, retype, extend) and requires the schema and Zod to give the same verdict, so a field loosened in one place and not the other is caught even where no example exercises it.
