# Glossary — BookcaseDiscovery

The shared vocabulary. Code, docs, commits and card briefs use these words in these senses.
A new term goes here in the same PR that introduces it (`docs/plan/OPERATING-MODEL.md` §5).
Citations: `INV-n` and `OCn` are in `docs/plan/REQUIREMENTS.md`; card ids are in `docs/plan/DELIVERY-PLAN.md`.
The record shapes these words name are in `contracts/` and explained in `docs/contracts.md`.

## What we look at

- **Bookcase** — one physical case of shelves. The unit of a fixture.
- **Shelf** — one horizontal level of a bookcase. Indexed from 0 at the top. *Not* a state: a shelf is never "exhausted" or "done" (INV-1).
- **Shelf band** — the vertical strip of a whole-case photo that belongs to one shelf. Drawn by hand on labelled photos, found by y-clustering when perceiving.
- **Spine** — the visible edge of one book on a shelf. The thing we detect.
- **Face-out** — a book shown cover-forward rather than spine-forward. A label kind, not a spine.
- **Ordinal** — a spine's position on its shelf, counted from the left, from 0.
- **Physical copy** — one book on the shelf. Two copies of the same work are two observations with the same identity; never collapsed (INV-4).

## Photos and ingest

- **Scan session** — one visit's set of photos, ingested together (`ScanSessionOpened`). Named like a fixture (`sf-store-001`).
- **Original** — the file exactly as exported from the phone ("Export Unmodified Original"). Hashed first, never written to (INV-12). Edited derivatives are **flagged, not rejected** (OC35): an `IMG_E*` name, an `.AAE` sidecar, a `Software` tag that is not the camera's, or an EXIF size that differs from the stored pixels.
- **Working copy** — the GPS-stripped, orientation-normalised copy every later stage reads (INV-12): pixels rotated per EXIF Orientation and the tag cleared (set to 1), so it has one pixel frame. Its hash is `workingCopyHash`; `imageHash` is the untouched original's.
- **Image asset** — an original that passed validation, identified by its SHA-256 (`ImageAssetIngested`). A file that fails is **rejected** (`ImageRejected`) with reasons and never processed.
- **Photo setting** — how a photo was taken: `whole-12` (whole case, 12 MP), `whole-48` (whole case, 48 MP), `shelf-48` (one shelf, 48 MP), `overview`: the controlled settings E1 compares (OC6). `real-use` is the other kind (OC35): a handheld, angled shot taken the way a shopper would, with no protocol and no shelf index. Lens class and edit status of a real-use photo are recorded in the private fixture manifest.
- **Public manifest** / **private manifest** — the two files that describe a fixture, split by the OC9 boundary. The public one (`fixtures/<session>/manifest.json`, `contracts/fixture-manifest.schema.json`) holds hashes, working-copy dimensions, setting, shelf index and the derivative flag, built from the ledger by `bookcase manifest`. The private one (`<data root>/private/fixtures/<session>.json`) adds file names, capture instants, device, lens class and edit status, and is written by `bookcase ingest`. GPS is in neither.
- **Working-copy pixels** — the coordinate frame of every box and polygon: the decoded pixel grid of the working copy, origin top-left, as `ImageAssetIngested.width/height` report it. The report scales from it to display size. (Replaces "original-image pixels": the original may carry an Orientation tag that the working copy has applied.)
- **Display derivative** — the JPEG the report shows for a working copy, made by `sips` with its long edge at most 3000 px (never enlarged). Polygons are scaled from working-copy pixels to it; it is a view, never an input to any stage. It lives in the report folder, not the image store.
- **Report** — the static site `bookcase report` writes to `$BOOKCASE_DATA/reports/<session>/<run>/` (`docs/report.md`): the photos with every spine boxed, coloured by status and stroked by band, plus a panel per spine and the unresolved and closer-photo lists. It holds photos, so it is private like the image store.
- **Content-addressed** — stored under its own hash, so the path never matters (ADR §10).

## Observation, hypothesis, work (INV-3)

These are kept apart on purpose: raw evidence is stored separately from interpretation.

- **Observation** — what the system saw in a photo: a spine's polygon plus the OCR readings from it (`SpineObserved`, `TextObserved`). Carries the detector and OCR versions that produced it, so a re-run is reproducible (INV-14).
- **Text variant** — one OCR reading of one spine at one rotation with language correction off or on (`TextObserved`; 0/90/270° x two flags).
- **Crop method** — how a spine's polygon is cut and turned before a reader sees it: which quad (the detector's rectangle, or the spine face from the mask), trimmed to the frame or not, and which rotations (`src/perceive/crop.ts`). Every machine-labelling reading names its crop method (`crop`, e.g. `rect;rot=fixed;clip=frame`), so readings cut differently are never mixed (F-0b).
- **Hypothesis** — an interpretation of an observation: a ranked list of candidates **plus the explicit `unknown`**, each with evidence (`HypothesesProposed`). Never an observation.
- **Candidate** — one Work (optionally one Edition) a spine might be.
- **`unknown`** — the none-of-the-above hypothesis. Present for every observation, so no match is forced (INV-5). An honest output, but every `unknown` is a defect with a reason (OC32).
- **Work** — a title as a creative work, independent of printing (ISFDB *title*). **Edition** — one printing of it, with an ISBN (ISFDB *publication*). Kept separate, with source provenance (INV-3).
- **Evidence** — one reason a candidate is plausible (a title fragment match, an author fragment, an ISBN read, an adjudicator's choice, a correction). Repeated LLM agreement on the same crop counts once (INV-6); repeated readings of one track under the same condition count once (INV-20).
- **Work item** — something the system cannot do itself, tracked until done (`WorkItemOpened/Closed`). Today: a **closer photo** of one spine. Distinct from a status.
- **Closer photo** — a work item asking for a better image of a named spine (shelf plus ordinal), opened when pixels are the problem.
- **Adjudication** — one bounded call to a language model about one crop, answering a candidate id or `none` (`AdjudicationRecorded`). **Adjudicator** — the model behind it. It never sees the profile (INV-13).
- **Correction (identity correction)** — the owner says which book a spine is, or that it is not a given book, or that it is unreadable (`IdentityCorrected`). It is about identity only and is *not* a dislike (INV-7).
- **Preference** — the owner's taste signal about a work: more, less, not-for-me, already-read (`PreferenceRecorded`). It is about taste only and is *not* a wrong identity (INV-7). Shares no type with a correction.

## Bands, statuses, reasons

- **Band** — how strongly we hold an identity. **`verified`** (an ISBN read that matches an edition, or an owner correction), **`probable`** (title and author both match one candidate with a margin, no contradiction), **`candidate`** (a partial match with alternatives alive), **`unknown`**. Evidence bands, not probabilities (A4).
- **Status** — where a spine is in the work: **`unresolved`**, **`resolved`**, **`paused`**, **`needs-pixels`**. There is no `exhausted` (INV-1). A spent budget gives `paused` (INV-2); `resolved → unresolved` happens only on a trigger.
- **Status machine** — the table of legal status changes (`src/ledger/status.ts`). `StatusChanged` carries an optional **cause** where the table asks for one: `budget-spent` for a pause, a trigger for reopening a resolved spine.
- **Unresolved reason** — why a spine is `unknown` (INV-8): **`missing-pixels`**, **`no-catalog-candidate`**, **`conflicting-evidence`**, **`strategies-exhausted`**. A reason on an observation, never a state of a shelf. "Strategies exhausted" means *current* strategies, and a new image or model reopens it.
- **Trigger** — an event that requeues observations: a new image, a correction, a catalog refresh, a model change.
- **Recognition coverage** — identified spines over all spines on a shelf, with each `unknown`'s reason. The aim is every spine (OC32); the number is measured, never claimed (INV-23).
- **Recommendation readiness ≠ recognition completeness** — we can recommend well from a partly read shelf. No threshold marks a shelf finished (INV-1).

## The passes and the wall

- **Cheap pass** — detection, OCR and catalog retrieval, run on 100 % of spines every run. No paid calls.
- **Expensive pass** — adjudication under a budget, on spines still ambiguous after the cheap pass. Relevance may order the spending, never the identity scores (ADR §7).
- **Budget** — the caps on a run's adjudications, tokens and spend. When spent, work **pauses**; the unresolved queue persists (INV-2).
- **The wall** — context ranks recommendations and never scores identity. The profile and lenses never reach `identify` (INV-13). E-5 tests whether lifting it helps; G-E5 rules.
- **Run** — one execution of the pipeline: `RunStarted` records the code commit, helper versions, model ids and budget; `RunFinished` the outcome and usage.

## Ledger

- **Ledger** — the append-only record of everything that happened. The only way modules talk about state.
- **Event** — one fact in the ledger: `{seq, type, ts, runId, payload}`. Defined by a JSON Schema.
- **Seq** — an event's position in the ledger, assigned on append.
- **View** — current state derived from the events (observations, hypotheses, bands, statuses, work items, recommendations). Rebuilt by replay.
- **Replay** — rebuild the views from the log; the result must be identical (INV-14). `bookcase replay <db> --to <fresh db>` does it and diffs.
- **Image store** — the content-addressed directory of originals and working copies under `$BOOKCASE_DATA/images/sha256/` (`docs/ledger.md`).
- **Contract** — a JSON Schema in `contracts/`, the source of truth for a record shape (OC13). Zod validators are checked against it.
- **Helper** — a separate process behind a contract, speaking JSON Lines over stdin/stdout: `detect` (Python) and `ocr-vision` (Swift).
- **JSON Lines** — one JSON object per line, one request or response each.

## Catalog and recommendation

- **Catalog** — the local index of works and editions (ISFDB for the MVP, OC20; broader backend per C-R, OC32). Local search, live APIs only to verify.
- **Fragment** — a piece of a spine's text, as OCR gives it: truncated, split, misread, title and author in either order. Retrieval matches fragments to works; it never needs a whole title.
- **Match evidence** — what `retrieve` returns beside each candidate: per field (title, author, series) the score, the catalog form that matched and each token match with its kind (`exact`, `prefix`, `fuzzy`, …). It is what I-1 turns into `Evidence` records. Not a probability.
- **Readable label** — (C-4) a spine whose readers' text an outside catalog (Open Library, LoC) resolves to one book: a record whose title and one author's surname are both in the reader text (`RESOLVE` in `src/catalog/coverage.ts`). The machine stand-in for a hand label when none exist (OC36). An **unresolved** box is garbled, authorless or in no source; those cannot be told apart without a person.
- **Match miss** — a readable book the catalog holds that F-0 still left `unknown` (`in-isfdb-match-miss`). A matching and retrieval lever (C-3), not a catalog gap.
- **Catalog gap** — a readable book the catalog does not hold (`not-in-isfdb`): the part of `unknown` the catalog causes, as opposed to perception (`no-text`) or matching (OC32).
- **Imprint** — (F-0d) the publisher or imprint a spine shows, as printed text or as a recognised logo (Tor, Ace, DAW, Del Rey, Penguin's penguin). A clue to the edition, never identity on its own: it can choose between catalog candidates the spine's text already supports, never confirm one. ISFDB writes an imprint of a larger house as "Imprint / Publisher"; each segment is a **publisher key**, and the later segments are the earlier one's **parent house**.
- **Imprint read** — (F-0d) a Qwen read that asks only for a spine's imprint and whether it came from text or a logo (`helpers/label/imprint.py`). A separate reader variant from F-0's `qwen` read, in its own file, so F-0's cached reads stay valid.
- **Imprint tie-break** — (F-0d) on a spine F-0 left `unknown`, a reader whose top three passing candidates are split by the read imprint (some have an edition from that house, some not) votes for the best one that does; two readers must still agree. It never touches an accepted spine.
- **Golden fragments** — the hand-written, public query set `evals/golden/fragments.jsonl` that scores retrieval (C-3). Never derived from photos or from the index it scores.
- **Profile** — what we know of the reader: entries marked `read`, `liked`, `cooler`, `not-for-me`, `inferred-interest` or `unknown`, each with provenance, plus taste nodes. Read, liked, inferred and unknown stay separate (INV-18). `docs/profile.md`.
- **Seeds** — `profile/seeds.json`: exactly what the owner stated, public (OC9). A **seed** is one entry in it. Nothing inferred, nothing from a ChatGPT export or SelfCo.
- **Overlay** — the optional private `<data root>/private/profile-overlay.json`, merged with the seeds at run time. It can add only `inferred-interest` and `unknown`; anything else it claims is refused, so it never promotes to `read` or `liked`.
- **Expansion** — turning a compact seed ("read all of William Gibson", `scope: all-works`) into one generated `read` entry per novel in the catalog, marked `expanded: true`. Done at build time, never stored in the seeds.
- **Taste node** — one term on a facet that the reader is pulled toward or pushed from, with a status (hypothesis, asserted, rejected) and an evidence kind (SYNTH from a model, ASSERTED by the owner). An **open question** is the reader-side unknown, with zero weight until answered.
- **Taste** — what animates a reader: ideas, themes, patterns, authors, styles, questions and topoi. Never "people like you also bought" (no collaborative filtering, OC33).
- **Recommendation** — a Work suggested to the reader, located at a spine, with a rank, a band, a lens and a templated rationale (`RecommendationIssued`). A **revision** (`RecommendationRevised`) says what it was, what it is and which events changed it (INV-21).
- **Lens** — *two senses, kept apart.* **Interest lens**: the basis of a recommendation (reading taste, serendipity), named in the recommendation. **Overlay lens**: the live view's highlight mode (Recommended, Read, All, Needs a closer look; OC30). Say which.
- **Identity confidence** vs **discovery temperature** — two separate user settings (OC33). Confidence decides whether we know which book it is; temperature decides how far from the centre of the reader's taste a pick may sit.
- **Dev mode** — the owner's view showing every band, the evidence and score behind each label and pick, and live-tunable parameters.
- **Late-pass discovery** — a spine resolved in a pass after the first. Tracked (INV-16).
- **Wrong-but-confident** — band `verified` or `probable` and wrong. The metric that matters most for identity.

## Live and sweep

- **Track** — one spine followed across video frames (`Track`, T-0). It is `born` when first detected, `stable` once seen for N frames, `lost` when gone; a `lost` track returns to `stable` only if it had been stable, and one lost before that is not resumed (a new track starts). Legal edges: `docs/contracts.md`. Readings of one track that differ only in time are one observation per condition (INV-20).
- **Live session** — one continuous camera run or one guided sweep, named by a `sessionId`. No event opens it: the first `Track` or `FrameSample` that names it does.
- **Frame index** — a frame's position in a live session's capture stream, counted from 0 for every frame the tracker sees. A track's first and last frame are frame indices.
- **Live frame** — the coordinate frame of every polygon in a live event: the frame as the detector receives it, upright as the owner sees it, origin top-left (`FramePixels`). The live twin of working-copy pixels.
- **Frame sample** — a sparse (at most 1 Hz) record of one frame: its hash, capture time and size, never its pixels (`FrameSample`, INV-22). In live mode the frame is not retained; in guided sweep a face-checked keyframe may be kept privately.
- **Bystander region** — a face or person outside every detected book box. Its region is blurred before hashing and storage, and counted in `bystanderRegionsBlurred`. A face inside a book box is published cover art and is kept (INV-22 as amended).
- **Track window** — a per-track summary over a span of frames: the best frame (hash, sharpness, pose) to read from (`TrackWindow`).
- **Condition** — the viewpoint bucket (`left-oblique`, `frontal`, `right-oblique`) and exposure bucket (`under`, `normal`, `over`) a reading was taken under. Readings of one track with equal conditions are one observation; a band may rise only on agreeing readings under different conditions (INV-20).
- **Observation (live)** — the count INV-20 keeps: one per (track, condition), however many `OcrReading`s there are. Not the same word as an *observation* in the batch sense (a spine's polygon plus readings); say "condition observation" where it could be confused.
- **Card lifecycle** — a card is **proposed** (`CardProposed`), may be **revised** (`CardRevised`: what it was, what it is, the exact fields that differ, the events that changed it), **undone** (`CardUndo`: reverses the latest revision, one at a time) or **retracted** (`CardRetracted`, final). None is silent (INV-21).
- **Card (recommendation card)** — one entry in the live card list. *Not* a delivery task card; say "task card" for that.
- **Glass** — what is shown on screen. It changes less often than the ledger: a new label or rank is committed only after a margin held for a dwell time, **hysteresis** (INV-24).
- **Pixels on demand** — a tracked spine marked `needs-pixels` requests a 48 MP still that runs the batch pipeline on that spine.
- **Guided sweep** — hold a button and pan across the case; pace cues shape the capture; the result is a scrub-back replay (OC31). The video is discarded once processed; only sparse keyframes, crops, boxes and events persist (INV-22).
- **Capture coverage** — how well each place on a bookcase has been captured for reading, shown as fill while panning (proposal, Q-0, `docs/capture/coverage.md`). *Not* recognition coverage: a fully captured shelf can still hold `unknown`s whose cause is the catalog.
- **Coverage segment** — the unit capture coverage colours: a piece of one shelf band about two median spine widths long, anchored to working-copy pixels in a still and to stable tracks live (proposal, Q-0).
- **Coverage rung** — a spine's or segment's place on the capture ladder: `not-seen` → `seen` → `spine-found` → `text-present` → `text-read` → `matched` → `confirmed`. Filled from `text-read` up; the top two restate bands (proposal, Q-0).
- **Top seam** — where a detected spine's top edge actually sits against its box's top end, measured from pixels as the strongest colour step across the spine. A box that *overshoots* runs past the top edge onto the top face or the shelf, and a box that *cuts* stops short of it (Q-2, `helpers/coverage/geometry.py`).

## Evidence, fixtures and honesty

- **Fixture** — a set of photos with a manifest and the owner's labels, used to choose defaults and measure. `sf-store-001` is the first controlled one.
- **Dev set** — a fixture used to choose defaults, so its numbers are optimistic and reported as such (OC11). **Held-out** — data never used to choose anything; the first is post-MVP (`sf-store-002`).
- **Real use vs controlled** — *real use*: handheld, angled, whole cases at a distance, whatever lens the camera picks, glare, face-outs, stickers. The primary distribution. *Controlled*: clean, square-on, main-lens per-shelf shots, a reference. Metrics report both separately; gates judge on real use (OC35).
- **Pilot set** — `pilot-000`: the first real-use set (31 edited JPEGs, 2026-10-31); training and evaluation data minus its audit slice (OC34, OC35).
- **Blind audit slice** — about two shelves of each new fixture the owner labels by hand before any machine output is shown. Never prefilled, never trained on. The only scorecard for machine labelling (OC34).
- **Machine-first labelling** — detector boxes plus OCR plus catalog lookup propose labels; the owner reviews a ranked queue of the uncertain ones and the gaps (F-0).
- **PROXY** — a result from a public library-shelf dataset, not the owner's bookcase. Always labelled **PROXY (library shelves)**. Library shelves are not bookstore shelves.
- **Labelling stack** — the open-weight models that label spines with no owner time (OC36): box producers plus readers, chosen in `docs/models/open-weights.md` (H-0).
- **Spine piece** — a detector box holding only part of one spine: cut by a tile edge, or a part-of-spine detection (a label block, a colour band) inside or stacked on the rest. Whole-spine boxes have none (F-0e). Not a *fragment*, which is a piece of OCR text.
- **Yardstick** — something the labelling stack didn't produce, used to score it (OC36): a public labelled spine dataset (PROXY; local only, never committed, never trained on), the catalog, and optional yes/no taps.
- **Machine agreement** — how often independent readers and the catalog agree on a spine. Reported for real-use sets that have no taps; never called accuracy (INV-17).
- **Hypothesis (claim)** — in docs, a number or fact not yet measured is marked *hypothesis* (INV-17). Not to be confused with the identity hypothesis above.
- **Gate** — an owner decision point, `G-*`. The conductor writes a packet; the owner rules; a gate is never closed silently.
- **Task card** — one unit of delivery work in `DELIVERY-PLAN.md`, ending in a PR.

## Compute jobs and shifts

The interim queue in `docs/ops/compute-fleet.md` (cards N-1 to N-3). Core's fleet-runner will take it over; these words name the parts that move with it.

- **Job** — one unit of compute a worker claims: detect one photo, read one batch of crops, render one page, run the test suite at one commit. Not a *run* (a pipeline execution recorded by `RunStarted`); one run can enqueue many jobs. Not a *task card* (delivery work ending in a PR).
- **Job kind** — what a job does (`detect`, `read-vision`, `read-ppocr`, `read-qwen`, `render`, `test-suite`). Each kind has one handler and declares the capabilities a worker needs (MPS, Apple Vision, MLX).
- **Job key** — SHA-256 over the canonical JSON of the kind, input content hashes, parameters, model id and revision, and code commit or helper version. Same key, same work: enqueueing twice is a no-op, and a finished key is a cache hit. The payload (where a host keeps the inputs) is not keyed, so a handler executes the keyed parameters and checks the inputs' hashes, never trusting the payload for anything that changes the output.
- **Host** — one machine that runs workers. Hosts provision themselves (their own model-hub login, lockfiles, a models manifest checked by hash); credentials are never copied between hosts.
- **Worker** — one process on a host that claims and runs one job at a time. A host runs at most one GPU worker.
- **Lease** — a worker's time-limited claim on a job, renewed by heartbeat. When it expires (sleep, crash, lost network), the job returns to the queue.
- **Fencing token** — a per-job counter incremented on every claim. A heartbeat or completion that carries an old token is rejected, and each attempt writes its own output file named by the token. So a worker that wakes after its lease expired can never overwrite a newer attempt's row or bytes.
- **Day shift / night shift** — the day shift is when the owner is present: admitting work, gates, merges, rulings, review. The night shift runs only admitted jobs that have a deterministic success check and no effect outside the owner's machines.
- **Admission** — the day-shift act that puts a job plan into the queue for the night shift.
- **Morning report** — `bookcase jobs report`: aggregates in two labelled scopes, *now* (state per job kind, failures by error code, oldest waiting job) and *period* (attempts per worker by how they ended, and leased machine-hours: valid lease time only, clipped to the period). A query over the job table, never a session's memory.
