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
- **Original** — the file exactly as exported from the phone ("Export Unmodified Original"). Hashed first, never written to (INV-12). Edited derivatives (`IMG_E*`, `.AAE` sidecar) are flagged.
- **Working copy** — the GPS-stripped copy every later stage reads (INV-12). Same pixels as the original.
- **Image asset** — an original that passed validation, identified by its SHA-256 (`ImageAssetIngested`). A file that fails is **rejected** (`ImageRejected`) with reasons and never processed.
- **Photo setting** — how a photo was taken: `whole-12` (whole case, 12 MP), `whole-48` (whole case, 48 MP), `shelf-48` (one shelf, 48 MP), `overview`. E1 compares them (OC6).
- **Original-image pixels** — the coordinate frame of a polygon: the pixel grid of the image it was found in, origin top-left. The report scales from it to display size.
- **Content-addressed** — stored under its own hash, so the path never matters (ADR §10).

## Observation, hypothesis, work (INV-3)

These are kept apart on purpose: raw evidence is stored separately from interpretation.

- **Observation** — what the system saw in a photo: a spine's polygon plus the OCR readings from it (`SpineObserved`, `TextObserved`). Carries the detector and OCR versions that produced it, so a re-run is reproducible (INV-14).
- **Text variant** — one OCR reading of one spine at one rotation with language correction off or on (`TextObserved`; 0/90/270° x two flags).
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
- **Profile** — what we know of the reader: entries marked `read`, `liked`, `cooler`, `not-for-me`, `inferred` or `unknown`, each with provenance. Read, liked, inferred and unknown stay separate (INV-18).
- **Taste** — what animates a reader: ideas, themes, patterns, authors, styles, questions and topoi. Never "people like you also bought" (no collaborative filtering, OC33).
- **Recommendation** — a Work suggested to the reader, located at a spine, with a rank, a band, a lens and a templated rationale (`RecommendationIssued`). A **revision** (`RecommendationRevised`) says what it was, what it is and which events changed it (INV-21).
- **Lens** — *two senses, kept apart.* **Interest lens**: the basis of a recommendation (reading taste, serendipity), named in the recommendation. **Overlay lens**: the live view's highlight mode (Recommended, Read, All, Needs a closer look; OC30). Say which.
- **Identity confidence** vs **discovery temperature** — two separate user settings (OC33). Confidence decides whether we know which book it is; temperature decides how far from the centre of the reader's taste a pick may sit.
- **Dev mode** — the owner's view showing every band, the evidence and score behind each label and pick, and live-tunable parameters.
- **Late-pass discovery** — a spine resolved in a pass after the first. Tracked (INV-16).
- **Wrong-but-confident** — band `verified` or `probable` and wrong. The metric that matters most for identity.

## Live and sweep

- **Track** — one spine followed across video frames (T-0). Readings of one track that differ only in time are one observation per condition (INV-20).
- **Card (recommendation card)** — one entry in the live card list. *Not* a delivery task card; say "task card" for that.
- **Glass** — what is shown on screen. It changes less often than the ledger: a new label or rank is committed only after a margin held for a dwell time, **hysteresis** (INV-24).
- **Pixels on demand** — a tracked spine marked `needs-pixels` requests a 48 MP still that runs the batch pipeline on that spine.
- **Guided sweep** — hold a button and pan across the case; pace cues shape the capture; the result is a scrub-back replay (OC31). The video is discarded once processed; only sparse keyframes, crops, boxes and events persist (INV-22).

## Evidence, fixtures and honesty

- **Fixture** — a set of photos with a manifest and the owner's labels, used to choose defaults and measure. `sf-store-001` is the first controlled one.
- **Dev set** — a fixture used to choose defaults, so its numbers are optimistic and reported as such (OC11). **Held-out** — data never used to choose anything; the first is post-MVP (`sf-store-002`).
- **Real use vs controlled** — *real use*: handheld, angled, whole cases at a distance, whatever lens the camera picks, glare, face-outs, stickers. The primary distribution. *Controlled*: clean, square-on, main-lens per-shelf shots, a reference. Metrics report both separately; gates judge on real use (OC35).
- **Pilot set** — `pilot-000`: the first real-use set (31 edited JPEGs, 2026-10-31); training and evaluation data minus its audit slice (OC34, OC35).
- **Blind audit slice** — about two shelves of each new fixture the owner labels by hand before any machine output is shown. Never prefilled, never trained on. The only scorecard for machine labelling (OC34).
- **Machine-first labelling** — detector boxes plus OCR plus catalog lookup propose labels; the owner reviews a ranked queue of the uncertain ones and the gaps (F-0).
- **PROXY** — a result from a public library-shelf dataset, not the owner's bookcase. Always labelled **PROXY (library shelves)**. Library shelves are not bookstore shelves.
- **Hypothesis (claim)** — in docs, a number or fact not yet measured is marked *hypothesis* (INV-17). Not to be confused with the identity hypothesis above.
- **Gate** — an owner decision point, `G-*`. The conductor writes a packet; the owner rules; a gate is never closed silently.
- **Task card** — one unit of delivery work in `DELIVERY-PLAN.md`, ending in a PR.
