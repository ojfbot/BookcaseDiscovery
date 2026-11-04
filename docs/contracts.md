# Contracts

The record shapes every module writes and every helper speaks. Words are defined in [`CONTEXT.md`](../CONTEXT.md).

**The JSON Schemas in [`contracts/`](../contracts) are the source of truth** (OC13). Swift (Codable), Python and a later iOS app read the same files; there is no second copy. The Zod validators in `src/ledger/` are written by hand against them, and `test/contracts.test.ts` proves the two agree.

```
contracts/
  common.schema.json        primitives, enums, small shared shapes
  event.schema.json         the ledger envelope; maps `type` to a payload schema
  events/<Type>.schema.json one payload schema per event type (29)
  helpers/*.schema.json     JSON Lines records for the detect and OCR helpers (4)
  fixture-manifest.schema.json  the public fixture manifest, fixtures/<session>/manifest.json (K-3; `docs/ingest.md`)
test/fixtures/contracts/    synthetic examples: valid ones here, invalid ones under invalid/
src/ledger/contracts.ts           Zod validators for events
src/ledger/helper-contracts.ts    Zod validators for helper records
src/ledger/schemas.ts             Ajv, loading the schema files
src/ledger/ledger.ts              the Ledger interface
src/ledger/memory.ts              the in-memory implementation
src/ledger/sqlite.ts              the SQLite implementation (docs/ledger.md)
src/ledger/status.ts              the status machine and the budget rule
src/ledger/live.ts                the live track's rules: INV-20 counting, track edges, card revisions
```

Schemas are JSON Schema draft-07 with `additionalProperties: false` throughout, so an unknown field is an error, not a silent drop.

## Conventions

- **Ids** (`observationId`, `workId`, `sessionId`, …) are opaque non-empty strings chosen by the emitter. Never parse them.
- **Hashes** are lower-case hex SHA-256 (64 characters). `imageHash` is the original's; `workingCopyHash` is the GPS-stripped copy's.
- **Timestamps** are ISO 8601 with `Z` or a numeric offset. The emitter supplies `ts`; the ledger never stamps time, so replay is deterministic.
- **Polygons** are exactly four `[x, y]` corners in the pixel frame of the **orientation-normalised working copy** (working-copy pixels in [`CONTEXT.md`](../CONTEXT.md)): origin top-left, as `ImageAssetIngested.width/height` report it. A detector that finds free-form regions emits the minimum-area rotated quad. The detect response echoes the decoded image size so a mismatch is detectable. A polygon in a live event is in the live frame instead (`FramePixels` in `common.schema.json`; see Live track below).
- **Shelf** and **ordinal** are zero-based: shelf 0 is the top, ordinal 0 is leftmost.
- **Confidence** (`score`, OCR `confidence`) is a number from 0 to 1. Candidate and evidence scores are unbounded numbers; bands are not probabilities.

## Enums

| Enum | Values | Notes |
|---|---|---|
| Status | `unresolved` `resolved` `paused` `needs-pixels` | No `exhausted` (INV-1). Budget exhaustion gives `paused` (INV-2) |
| Band | `verified` `probable` `candidate` `unknown` | Evidence bands |
| Unresolved reason | `missing-pixels` `no-catalog-candidate` `conflicting-evidence` `strategies-exhausted` | A reason on an observation (INV-8), never a shelf state |
| Photo setting | `whole-12` `whole-48` `shelf-48` `overview` `real-use` | The first four are the controlled E1 settings (OC6). `real-use` is a handheld, angled shot with no protocol (OC35); it carries no `shelfIndex` |
| Rotation | `0` `90` `180` `270` | Degrees clockwise, before OCR |
| Track state | `born` `stable` `lost` | Live. Edges below |
| Viewpoint | `left-oblique` `frontal` `right-oblique` | Live. Half of an OCR condition (INV-20); bucket edges are T-3's |
| Exposure | `under` `normal` `over` | Live. The other half |

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
| `StatusChanged` | `observationId`, `from` (status or `null`), `to`; optional `cause` | `cause` is `budget-spent`, a trigger (`new-image` `correction` `model-change` with `eventSeq`, or `catalog-refresh`). Which transitions are legal and which need a cause: [`ledger.md`](ledger.md) |
| `WorkItemOpened` | `workItemId`, `kind` (`closer-photo`), `observationId`, `shelf`, `ordinal`, `reason` | |
| `WorkItemClosed` | `workItemId`, `resolution` (`fulfilled` `withdrawn`) | |
| `IdentityCorrected` | `observationId`, `correction`: `{kind:"is", workId}` \| `{kind:"not", workId}` \| `{kind:"unreadable"}` | Identity only |
| `PreferenceRecorded` | `workId`, `preference` (`more` `less` `not-for-me` `already-read`) | Taste only. Shares no type or field with `IdentityCorrected` (INV-3, INV-7) |
| `RecommendationIssued` | `recommendationId`, `rankingVersion`, `recommendation{workId, observationId, rank, band, lens, rationale}` | `band` is shown beside the rank, never multiplied into it. `unknown` is not recommendable |
| `RecommendationRevised` | the above plus `previous{…}` and `reasonEventSeqs` (≥1) | Never silent (INV-21) |
| `RunStarted` | `codeCommit`, `helperVersions{name: version}`, `modelIds[]`, `budget{maxAdjudications?, maxTokens?, maxSpendUsd?}` | `codeCommit` may end `-dirty` |
| `RunFinished` | `outcome` (`completed` `paused` `failed`), `usage{adjudications, inputTokens, outputTokens, spendUsd?}` | A spent budget gives `paused` (INV-2) |

### Live track events (S9, card T-0)

Written by the tracker, fusion and card stages (T-2 to T-5, T-7). Per lifecycle edge or per window, never per frame. Frames are never in the ledger: only a hash.

| Event | Payload (required fields) | Notes |
|---|---|---|
| `Track` | `trackId`, `sessionId`, `state`, `previous` (state or `null`), `firstFrame`, `lastFrame` | One event per edge; `previous` is the state it leaves |
| `FrameSample` | `sessionId`, `frameIndex`, `hash`, `capturedAt`, `frame{width,height}`, `mode` (`live` `sweep`), `retention` (`none` `keyframe`), `bystanderRegionsBlurred` | At most 1 Hz. A `live` sample says `retention: none` (INV-22). No pixels, no "dropped" flag: a dropped frame gets no sample |
| `TrackWindow` | `trackId`, `windowIndex`, `startFrame`, `endFrame`, `frameCount`, `bestFrame{frameIndex, hash, sharpness, pose{polygon, tiltDegrees}}` | One per track per window |
| `OcrReading` | `trackId`, `condition{viewpoint, exposure}`, `source` (`fast` `accurate` `fused`), `frameIndices` (≥1), `rotation`, `langCorrection`, `text`, `confidence`, `ocr{…}` | Same track and condition = one observation (INV-20) |
| `LookupResult` | `trackId`, `queryText`, `readingEventSeqs` (≥1), `catalog{name, version}`, `candidateSetHash`, `candidates[]`, `unknown{…}` | The same candidate and `unknown` shapes as `HypothesesProposed` |
| `AdjudicationRequested` | `requestId`, `trackId`, `lookupEventSeq`, `model`, `cropHash`, `candidateSetHash` | Refused once the run's counted cap is spent (INV-2) |
| `AdjudicationResult` | `requestId`, `model`, `cropHash`, `candidateSetHash`, `choice` (workId or `null`), `inputTokens`, `outputTokens`; optional `readText` | Counted against the run's budget |
| `AdjudicationCacheHit` | `trackId`, `model`, `cropHash`, `candidateSetHash`, `choice`, `sourceEventSeq`; optional `readText` | No call, no spend, no new evidence (INV-6) |
| `CardProposed` | `cardId`, `rankingVersion`, `card{workId, trackId, rank, band, lens, rationale}`, `evidenceEventSeqs` (≥1) | |
| `CardRevised` | `cardId`, `rankingVersion`, `card`, `previous`, `reasonEventSeqs` (≥1), `diff` (≥1) | Never silent (INV-21) |
| `CardRetracted` | `cardId`, `reason` (`track-lost` `evidence-withdrawn` `superseded` `dismissed`), `last`, `reasonEventSeqs` (≥1) | Final: a later card gets a new `cardId` |
| `CardUndo` | `cardId`, `revisionEventSeq`, `restored` | Reverses the latest revision not yet undone |

**The live frame.** Every polygon in a live event is in the pixel grid of the frame as the detector received it, upright as the owner sees it (device orientation applied), origin top-left, `x` right, `y` down, extent `FrameSample.frame`. This is the live twin of working-copy pixels (`FramePixels` in `common.schema.json`). `firstFrame`, `lastFrame`, `startFrame`, `endFrame` and `frameIndices` are `FrameIndex`: the position in the session's capture stream, counted from 0 for every frame the tracker sees (so a track spans many more frames than there are `FrameSample`s). A live session has no opening event: the first `Track` or `FrameSample` naming a `sessionId` introduces it.

**Track edges.**

| Edge | Meaning |
|---|---|
| `(none)` → `born` | A detection with no track |
| `born` → `stable` | Seen for N frames (N is T-2's parameter) |
| `born` → `lost` | Gone before it stabilised; never resumed, a new track starts instead |
| `stable` → `lost` | Gone; the overlay's grace period runs |
| `lost` → `stable` | Re-acquired, only if it had once been `stable` |

The schema allows exactly these `state`/`previous` pairs (`(none)` is `previous: null`). The ledger adds what a pair cannot say: `previous` must be the track's current state, `sessionId` and `firstFrame` never change, `lastFrame` never goes back and is not before `firstFrame`, and `lost` → `stable` needs a track that was once `stable`.

**What the ledger checks, beyond the schemas** (`src/ledger/live.ts`; each is a rule that compares an event with another event or with state, which draft-07 cannot):

- Every event naming a `trackId` needs that track to have been born. A `TrackWindow`'s best frame lies inside the window and `frameCount` fits in it.
- `LookupResult.readingEventSeqs` are earlier `OcrReading`s of the same track. `AdjudicationRequested.lookupEventSeq` is an earlier `LookupResult` of the same track with the same `candidateSetHash`. An `AdjudicationResult` answers an open request once, under its own `model`, `cropHash` and `candidateSetHash`. An `AdjudicationCacheHit` repeats the key and `choice` of an earlier `AdjudicationResult` or `AdjudicationRecorded`.
- Budget (INV-2): a request is refused once the run's counted cap is spent; a result adds to the run's usage like `AdjudicationRecorded`; a cache hit costs nothing.
- Cards (INV-21): `CardRevised.previous` is the card's current state; `diff` is exactly the fields in which `previous` and `card` differ, once each, in the order rank, workId, trackId, band, lens, rationale (so identity, rank and rationale changes are all visible), and at least one differs; every cited `reasonEventSeqs` and `evidenceEventSeqs` entry is an earlier event. `CardUndo.revisionEventSeq` is the card's latest revision not yet undone and `restored` is what that revision replaced; undo walks back one revision at a time. A retracted card takes no further event.
- **Not checked:** that `FrameSample`s are at most 1 Hz apart (a producer rule, measured by T-1), that `candidateSetHash` is the right hash of its candidates (the emitter's), and that a `stable` track precedes its windows and readings (a late result for a track that has just been lost is still data).

**INV-20, counted.** `observationCount(readings)` in `src/ledger/live.ts` is the one place the rule is written: readings are grouped by (`trackId`, `conditionKey(condition)`), and each group is one observation. `agreeingObservationCount(readings, text)` counts the groups that read `text`; a band may rise only when that is 2 or more (I-3 owns the band rule).

**Privacy (INV-22 as amended 2026-11-02).** Faces inside a detected book box are published cover art and are kept. A face outside every book box has only its region blurred, counted in `bystanderRegionsBlurred`. A frame where a person dominates, or a face's placement is ambiguous, is dropped, so it has no `FrameSample`. No frame, clip or weight file is committed; the Z-1 guard (`docs/privacy.md`) refuses video and weight file types.

## Helper contracts

Each helper reads one JSON object per line from stdin and writes one per line to stdout. A request's `id` is echoed in its response, so a caller can pipeline. A helper that fails one request answers `{id, error:{code, message}}` and keeps running. A response is exactly one of the success shape or the error shape.

| File | Direction | Shape |
|---|---|---|
| `helpers/detect-request.schema.json` | core → detect | `{id, image}`, `image` the path of the working copy |
| `helpers/detect-response.schema.json` | detect → core | `{id, image:{width, height}, detections:[{polygon, score}], version:{backend, weightsSha256}}` or the error |
| `helpers/ocr-request.schema.json` | core → ocr-vision | `{id, image, polygon, rotations[]}` |
| `helpers/ocr-response.schema.json` | ocr-vision → core | `{id, variants:[{rotation, langCorrection, text, confidence, fields?}], version:{helper, os, requestRevision}}` or the error. `fields` (optional, F-0j) is a field read: `{lines:[{i, text}], title, author, imprint:{lineIds, text, from}, unassigned?}`, each field `{lineIds, text}` with `text` null when not read |

Example lines: `test/fixtures/contracts/helpers/*.jsonl`. Zod: `src/ledger/helper-contracts.ts`.

OCR semantics (card P-1; details in [`helpers/ocr-vision/README.md`](../helpers/ocr-vision/README.md)): the request polygon is in the stored pixels of the working copy and the helper applies no EXIF orientation; a request yields two variants per rotation, correction off then on, in request order; `rotations` may name 0, 90, 180 or 270; `confidence` is the mean over recognised lines and `text` joins them with a newline. TypeScript callers use `runOcr` in `src/perceive/ocr.ts`.

## The Ledger interface

`src/ledger/ledger.ts`. L-1 ships `MemoryLedger`; L-2 adds `SqliteLedger` behind the same interface, and the same tests run against both.

- `append(event): LedgerEvent` — validates with Zod, assigns `seq`, returns the stored event. With `{ crossCheck: true }` it also validates with the JSON Schema and refuses if the two disagree.
- `events(after = 0)` — events with `seq` greater than `after`, oldest first. `lastSeq()` is the newest.
- Views: `observation(id)`, `observations({sessionId?, imageHash?})`, `workItems({open?})`, `recommendations()`, `run(id)` / `runs()`, `images(sessionId?)`, `rejections(sessionId?)`, and for the live track `tracks()`, `cards()`, `adjudicationRequests()`.
- `viewDump()` — every view as one plain ordered object. Equal dumps mean equal state; replay is checked on it.

`append` refuses (throws `LedgerError`, leaving the ledger unchanged) an event that fails its contract, carries a `seq`, names an observation, work item, recommendation, run, track, card or adjudication request the ledger has not seen, breaks one of the live rules above, reuses an existing `observationId`, `workItemId`, `recommendationId` or run, breaks the status machine, or (`AdjudicationRecorded`) spends a run's budget past its cap. Results are copies; mutating one never changes the ledger.

## Recommend contracts (R-1)

Two single-document contracts, outside the ledger, with the same rule: the schema is the source of truth (OC13), Zod mirrors it, and a test mutates every node of the examples and requires them to agree (`test/support/mutants.ts`).

| File | Describes | Zod and Ajv |
|---|---|---|
| `profile.schema.json` | a profile file: `profile/seeds.json` and the private overlay (entries, taste nodes, open questions, provenance) | `src/recommend/profile.ts`, `schemas.ts` |
| `vocabulary.schema.json` | `src/recommend/vocabulary.json`: facets, terms, crosswalk, drop list | `src/recommend/vocabulary.ts`, `schemas.ts` |

What a schema cannot say is checked in code: `checkProfileFile` (unique ids, a seed reference names a seed, a node's kind sits on its facet), `checkVocabulary` (unique terms, parent on the same facet, depth at most 3, no rule maps a dropped value) and `publishProblems` (what may be public). Examples: `test/fixtures/profile/`. `docs/profile.md` has the rules.

## Changing a contract

1. Edit the schema in `contracts/`, and its validator in `src/ledger/`.
2. Add a valid example under `test/fixtures/contracts/` (named `<Type>.<variant>.json`) and, for a new rule, an invalid one under `invalid/`. Examples are synthetic: no real titles, no OCR text from real photos.
3. Run `pnpm test`. A new event type must be listed in `event.schema.json` (`type` enum and the `allOf` table) and in `payloadSchemas`; the tests fail until every one of those agrees.

The agreement test mutates every node of every example (delete, retype, extend) and requires the schema and Zod to give the same verdict, so a field loosened in one place and not the other is caught even where no example exercises it.
