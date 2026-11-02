# Delivery plan — BookcaseDiscovery MVP

Planning output, 2026-10-31. Drafted by an Opus 5.5 planning session; **revised the same evening by the Fable 5.1 planning pass** (OC20–OC23; changes in `README.md` § Changelog), and **extended late the same night by the Fable 5.1 gap cycle** for the live experience (segments S9–S10, gates G-SURF, G-LIVE, G-LIC, G-W, OC24–OC29, INV-20–INV-23; `README.md` § Changelog — gap cycle; analysis in `~/selfco/wiki/synthesis/bookcase-discovery-live-experience-gaps.md`). This plan builds on three companion files: `REQUIREMENTS.md` (OC1–OC23, INV-1–INV-19), `OPERATING-MODEL.md` and `ADR-DRAFT-bookcase-discovery-architecture.md`. Each card's Newline unit is in `CURRICULUM-MAP.md` §1b.

The delivery runs over several days, and the owner's time sets its length: the photo shoot and the labelling. Agent time does not. So the plan counts in **dispatch waves and card sizes**, not clock offsets (logged as a deviation from the selfco-inbox format in `implementation-notes.md`).

**Target end state:** the owner runs `ingest → run → report` on one science-fiction bookcase they photographed in a bookstore. They open a local HTML report that:
- boxes every spine with its status and identity band;
- explains each one;
- ranks recommendations against their tastes, with a click-to-locate for each book.

The scorer's numbers against their own labels are recorded alongside the report.

---

## 1. Owner checklist — read this first

These are things only the owner can do or decide. Items 1 and 2 are on the critical path. Start item 1 today, whatever else happens.

| # | When | Action or decision | Recommended answer |
|---|---|---|---|
| 0 | Before GO | **Create the public repo `ojfbot/BookcaseDiscovery`** yourself, empty except for a README. The conductor clones it in Z-0; agents don't create it. **Done 2026-11-02:** created public at https://github.com/ojfbot/BookcaseDiscovery, with an AGPL-3.0 `LICENSE` and a stub README, on branch `main`. Claude created it at the owner's explicit authorisation. Z-0 keeps the GitHub `LICENSE` instead of writing its own. | — |
| 0b | ~~Before GO~~ **Done 2026-10-31** | ~~Pick the repo licence~~ **Owner chose AGPL-3.0 for the whole repo** ("AGPL-3.0 repo"). Z-0 writes `LICENSE` as AGPL-3.0; `helpers/detect` needs no carve-out; owner-trained weights may be published under AGPL-3.0 once G-W rules. | — |
| 1 | **Now** (O-1) ⌨ | **Get the bookcase originals onto Yojimbo.** Try these in order and stop at the first that works.<br>**(a)** On the Mac, open System Settings → your name. Confirm it is the **same Apple ID** as on the iPhone (Settings → your name). Then open Photos → Settings → iCloud, turn **iCloud Photos** on, and choose **Download Originals to this Mac**. Wait for the album to appear, then File → Export → **Export Unmodified Original** into `~/data/bookcase-discovery/inbox/<album>/`.<br>**(b)** AirDrop. On the iPhone, select the album's photos, tap Share, then **Options** at the top, and turn on **All Photos Data**. AirDrop to Yojimbo; the files land in `~/Downloads`. This path is unverified, so card K-2 checks dimensions and EXIF before anything uses the files.<br>**(c)** USB cable and Image Capture on the Mac: import the album's photos as HEIC.<br>Then tell the conductor three things: which path worked, the folder, and how many photos the album holds. | (a) if the Apple IDs match; otherwise (b) |
| 2 | ~~Book now; do after the shoot (O-3a, O-3b)~~ **Withdrawn 2026-11-02 (OC36)** | **No labelling sessions.** Machines label; a public dataset and the catalog score them. Optional: yes/no taps on your phone (V-6) whenever you feel like it, about 10 minutes, no drawing. | — |
| 3 | Before GO | **Confirm the default OCs** in `REQUIREMENTS.md`: OC5–OC8, OC10–OC14 and OC18. OC1–OC4, OC9, OC16, OC17 and OC19 are already confirmed. | Accept all |
| 4 | Before GO | **Say GO** to the conductor, scoped to this plan's Low and Medium cards. | "GO for BookcaseDiscovery DELIVERY-PLAN cards" |
| 5 | Before GO | **Approve downloads** into `$BOOKCASE_DATA` (`~/data/bookcase-discovery/`, about 8 GB of working space now that Open Library is post-MVP (OC20); Yojimbo had 313 GB free on 2026-10-31):<br>• the ISFDB database dump (about 315 MB, a snippet figure);<br>• YOLO-OBB pretrained weights (Ultralytics);<br>• a SAM checkpoint, **only if P-3 is triggered** (OC23).<br>**You download** the public spine datasets that need an account (Roboflow book-spine set, IEEE DataPort shelf-spine set) into `~/data/bookcase-discovery/proxy/`. Agents don't create accounts. | Approve all; download both datasets |
| 6 | Before GO | **Approve installs:** `brew install uv` (missing on Yojimbo); `brew install exiftool` (optional, but it makes K-1/K-2 exact); Label Studio in its own `uv` venv for the V-1a spike (OC21); Python deps inside `helpers/detect/.venv` only (ultralytics, torch; segment-anything only if P-3 runs; several GB). Ultralytics is AGPL-3.0. It is fine for a local spike and is flagged for distribution (ADR §6). | Approve |
| 7 | Before E-3 | **Anthropic API key** in the Yojimbo keychain: `security add-generic-password -s bookcase-discovery -a anthropic -w`. Also give **one spend ceiling** for the whole MVP. A cloud-OCR key for E-3's optional third arm is optional; the default is to skip that arm. | Key plus a ceiling you're comfortable losing to experiments |
| 8 | **As soon as you can — before GO is fine** (O-2) ⌨ | **The fixture shoot.** It does not wait for the repo or for card K-0; the protocol is here so you can shoot this weekend.<br>• Pick one science-fiction bookcase in a bookstore (OC7). Ask the staff if it's OK to photograph. Keep people out of frame.<br>• **Camera:** main 1× lens, no zoom, flash off, **48 MP HEIF** on (the setting's name varies by iPhone; look for "Resolution Control" / "HEIF Max" / "48 MP" in Settings → Camera → Formats).<br>• **Per shelf:** square on, the shelf filling the frame width, one photo per shelf, top to bottom.<br>• **Whole case:** one shot at 48 MP, then switch 48 MP off and take one at 12 MP.<br>• Angle away from lights to avoid glare.<br>• Album name: `sf-store-001`; note the shelf count.<br>Card K-0 commits this same text to `docs/capture-protocol.md` for the next visit. • **Sweep clips (O-6, gap cycle):** at the same visit, per shelf, three short video clips: a slow pan, a normal pan, and a pan with a one-second pause mid-shelf. Video only (mute the microphone), people out of frame, same main camera, 4K if offered. They are the live-mode fixtures (V-5).<br>• **Shoot like a shopper (OC35):** after the protocol shots, take 10–20 photos the way you would while browsing. Hold the phone, stand where you'd stand, take whole cases at an angle, and let the camera pick the lens. Don't fix framing. These are the real-use set, and they matter more than the clean shots. | Shoot before GO if a store visit is coming up; record the clips at the same visit |
| 9 | After R-1 (O-4) ⌨ | **Review the seed profile** (about 15 minutes): the expanded "read all of Gibson" list, Kim Stanley Robinson liked, cooler on Stephenson. The owner-stated profile is **public** in the repo (OC9). Optionally drop a ChatGPT export `conversations.json` into `~/data/bookcase-discovery/private/`; it and anything derived from it stay private. | — |
| 10 | As raised | **Gate rulings.** Each comes as one question with buttons and a packet in `docs/gates/`:<br>• **G-R** reconciliation (needed before I-4);<br>• **G-E1** capture protocol;<br>• **G-M1** M1 demo;<br>• **G-E4** adjudicator scope;<br>• **G-E5** the wall;<br>• **G-MVP**.<br>G-L (licences) is asked only if C-0 finds a blocker for local use. | Rule G-R as soon as the reconciliation is done. If it isn't done when I-3 merges, a provisional "proceed on the Claude proposal" keeps the plan moving |
| 11 | S8 (O-5) ⌨ | **Judge the recommendations** in the MVP report (about 30 minutes): useful / not for me / already known / wrong identity. | — |
| 12 | After G-MVP | Decide whether the core ADR PR (D-2) merges. | Read first, merge later |
| 13 | ~~Before Z-2~~ **Done 2026-10-31** | ~~Approve the northstar and roadmap text~~ Approved as proposed, including P3 → `#P1`, the P2 `strain` verdict and the numeric targets. Z-2 may run as soon as Z-0 lands. | — |
| 14 | At M1 and MVP (your action) | **Build-in-public posts to the Newline community.** Draft text for each is in `CURRICULUM-MAP.md` §3; the conductor refreshes the numbers in it. You post. No agent posts or contacts anyone. | Post at M1 and at MVP |
| 15 | Whenever ready | **Bring in the GPT assessment.** Capture it into the vault as a raw note, using the capture envelope or a paste. The conductor distills it to `wiki/sources/bookcase-discovery-gpt-assessment-<date>.md` and opens the reconciliation page with you (OC18). | — |
| 0c | Before T-6 | **Phone for the live spike.** Say whether the spike app runs under a free Apple personal team on your iPhone (7-day profiles, up to 3 apps, rebuild each week) or you join the Apple Developer Program ($99/year, Apple's stated price 2026-10-31). TestFlight is v2 work either way. | Free provisioning for the spike |
| 0b′ | ~~Before F-2 (**G-LIC**)~~ **Done 2026-10-31** | ~~Licence under the AGPL constraint (OC26).~~ **G-LIC ruled by the owner: the whole repo is AGPL-3.0.** F-2 may train without a licence hold; weights stay private until G-W regardless. The permissive-retrain option moves to the backlog (#6b) in case the owner later wants permissive weights. | — |
| 16 | Before G-LIVE (O-7) ⌨ | **Set the live targets.** The gap analysis proposes ranges, labelled proposals: first box on a new spine ≤100 ms; first text label on a stable track 300 ms–1 s; first cheap-pass card ≤3 s; adjudicated revisions ≤10 s, never blocking; glass-to-glass overlay ≤150 ms; live recall within a margin you choose of still recall; a label change rate you can watch without irritation; k and the INV-24 margin and dwell from U-1's proposals. Pick numbers and a percentile (p50 or p95). | Take the ranges' upper ends at p95 for the first ruling |
| 17 | Each shoot | **Store permission log.** Ask the staff before photographing or filming; note the date, store (private manifest only) and who said yes. No audio recording. | — |

**High-tier steps that need your explicit word:** items 0, 0b, 0b′ (G-LIC), 4, 7 (key and ceiling), 10 (every gate except G-P), 13, 16 (the live targets), anything over the spend ceiling, releasing any photo, crop or label (G-PUB), and releasing any weights (G-W).

**Medium-tier steps the conductor takes without asking:**
- cloning and bootstrapping the repo you created;
- refreshing the vault coordination page, its index line and its log entries (OC17);
- merges to `main`;
- the approved downloads and installs;
- paid calls under the ceiling;
- G-P, the perceive defaults, which follow a pre-registered rule.

---

## 2. Segments and gates

S1–S3 run **in parallel** from GO. S4 is the owner's lane and starts with checklist #1, also from GO. S5 joins the lanes.

| Seg | Goal | Cards | Entry | Exit gate (conductor runs it) | Demo |
|---|---|---|---|---|---|
| **S0** Bootstrap | Scaffold, probe, plan copied in, privacy guard | Z-0, Z-1 | Checklist #0, #0b, #3–#6 | `pnpm test` green on the empty scaffold; `docs/probe.md` committed; `docs/plan/` matches the working copy; **Z-1 guard green in CI and as a pre-commit hook, and red on its planted-leak tests**; vault coordination page created | — |
| **S1** Foundations (no photos) | Contracts, ledger, validator, labels, scorer, report scaffold | L-1, L-2, K-0, K-1, V-1a (V-1b fallback), V-2, W-1 | S0 | Synthetic end to end: a generated image passes through `ingest` (accept and reject cases), fake observations go through the ledger, then through `replay`, the scorer and the report. All in one test script, `pnpm test:e2e-synthetic` | Report on synthetic data |
| **S2** Catalog and profile | Local SF catalog (ISFDB only, OC20) with fragment retrieval; seed profile | C-0, C-1, C-3, R-1, O-4 | S0; checklist #5 | C-3 golden set: ≥90 % top-5 on clean fragments, noisy-fragment rate recorded; profile seeds load; `docs/licences.md` shows no blocker to local use | `bookcase catalog query "GIBS NEUROM"` |
| **S3** Perception spikes (PROXY) | OCR helper, detector helper, perceive wiring on public library-shelf images | P-1, P-2, P-4, (P-3 only if triggered, OC23) | S0; checklist #5–#6 | `perceive` on 3 held-out proxy images writes traceable observations; `replay` is identical; PROXY metrics recorded under `evals/proxy-*` | Report with boxes and OCR on a proxy image, labelled PROXY |
| **S4** Fixture (owner lane) | Labelled, verified originals of `sf-store-001` | O-1, K-2, O-2, K-3, F-0, V-3 (OC36: O-3 and V-4 withdrawn) | GO for O-1; the protocol in checklist #8 for O-2; H-0 for F-0; C-3 for V-3 | `fixtures/sf-store-001/manifest.json` validates; every manifest photo is a verified original; 100 % of readable labels resolved to a catalog ID or `not-in-catalog` | — |
| **S5** M1 — traceable observations | E1, E2 and E3 on the real fixture; perceive defaults chosen | E-1, E-2, E-3 | S1, S3, S4 | Assessment §11 acceptance: every observation traces to image hash, box and versions; re-run reproducible from the ledger; scorer numbers recorded. Packets for G-P (decided), G-E1 and G-M1 (asked) | **M1 demo:** fixture report with boxes and OCR, plus E1–E3 numbers |
| **S6** Identify | Retrieval, joint assignment, bands, adjudicator, scheduler; E4, E5 | I-1, I-2, I-3, **[G-R]**, I-4, I-5, E-4, E-5 | S2, S5 (G-P); **G-R before I-4** | E-4 and E-5 run records; packets G-E4 and G-E5 ruled; INV-1, 2, 5, 6, 13 tests green | Fixture report with bands and candidates |
| **S7** Recommend and corrections | Ranked, explained, located recommendations; corrections reactivate | R-2, R-3, W-2 | S2 (R-1), S6 (I-3; I-5 for R-3) | INV-7 and INV-9 tests; fixture report shows recommendations with click-to-locate and the unresolved queue | Full report |
| **S8** MVP | One clean end-to-end run, owner judgement, handoff | M-1, O-5, D-1, D-2 (D-1 waits for G-LIVE too) | S6 and S7 exits; G-E4 ruled | **G-MVP** (owner) on the M-1 report and `evals/MVP/` | **MVP demo** |
| **S9** Live track (gap cycle, OC24–OC25) | Stage A: the streaming stage graph on a Mac harness. Stage B: the loop on the phone. Live scorer and the live-vs-still experiment | T-0, T-1, T-2, T-3, T-4, T-5 · **[G-SURF]** · T-6, T-8, T-7a, T-7b · V-5, O-6, E-6, O-7 | T-0 after L-1; T-1 needs the owner's iPhone on the Mac; Stage B after F-2 (fixture-trained detector) and G-SURF; E-6 after V-5 labels and T-7b | **G-LIVE** (owner): V-5 metrics on the video fixtures against the owner's targets (O-7) | Stage A: sticky labels and revising cards on the Mac from the Continuity Camera. Stage B: the same on the phone |
| **S10** Flywheel (gap cycle, OC27) | Dataset manifest, grouped splits, training on MPS, registry, prefill-and-correct, held-out harness | F-1, F-2, F-3, F-4 · **[G-LIC]** before F-2 | F-1 after K-3; F-2 after F-0's catalog-confirmed labels, P-2 and G-LIC; F-0 after H-0 (OC36); F-3 for later fixtures; F-4 after V-2 and V-5 | `models/registry/` holds one owner-trained detector with manifest hash, held-out metrics and a model-card stub; F-4 runs it on stills and clips; the Z-1 guard rejects weight and video files | A registry record and the harness output |

### Gates

| Gate | Decides | Who | Evidence | Blocks |
|---|---|---|---|---|
| **G-R** Reconciliation | Whether the Claude proposal's identify and scheduling design stands, or is changed by the GPT assessment. Covers: a bounded adjudicator vs an agentic loop; fixed-share vs information-gain scheduling; one package vs many | Owner | Conductor packet: the GPT assessment's positions against assessment §8, row by row, with the cards each change would touch | I-4, I-5, E-4, E-5 (S6 after I-3). **Not** S1–S5: those cards follow the brief's domain model and phases, which both reviews inherit (ADR §1) |
| **G-P** Perceive defaults | Default detector and OCR | Conductor, by a pre-registered rule (below); owner informed and may override | E-2, E-3 records | I-1 onward use the defaults |
| **G-E1** Capture protocol | Per-shelf 48 MP as the standing protocol, or whole-case | Owner | E-1 record | Future visits (post-MVP); `docs/capture-protocol.md` |
| **G-M1** Milestone 1 | Accept M1 | Owner | M1 demo | S6 dispatch beyond I-1 (I-1 may start before) |
| **G-E4** Adjudicator scope | Adjudicator on or off; which model; whether any multi-step arm exists | Owner | E-4 record | M-1 config |
| **G-E5** The wall | Keep or relax INV-13 | Owner | E-5 record | M-1 config (default: keep) |
| **G-L** Licences | Local indexing allowed (MVP), redistribution (post-MVP) | Owner, only if C-0 flags a problem | `docs/licences.md` | C-1 merge if local use is in doubt; any distribution |
| **G-MVP** | MVP accepted | Owner | M-1 report, `evals/MVP/`, O-5 judgements | D-1 final, D-2, and opening G-V2 and G-PUB |
| **G-PUB** *(post-MVP)* | Which photos, crops or labels may be released as illustrations, and with what model card | Owner | Packet covering: curation criteria; redaction of people, signage and GPS; store consent; cover-art copyright; model-card contents (data, intended use, limits, eval numbers) | Any public image or label. Until it is ruled, only aggregates are public |
| **G-V2** *(post-MVP)* | Whether to start v2, the native iOS app with Python backend helpers, and in what shape: separate repo, v2 branch, or `apps/ios/` package | Owner | Packet: MVP results; the portability seams as they actually landed (ADR §10); the v2 open questions (§8) | All v2 work. It opens only after G-MVP. **Its packet now receives measured inputs from S9**: detector size that runs on the Neural Engine, tracker choice, FTS5-on-iOS (T-8), 2D vs ARKit, catalog delivery |
| **G-SURF** *(gap cycle)* Spike surface | Confirms Stage B (the on-phone loop) proceeds, and records what Stage A could not measure: Continuity Camera video is documented at ≤1080p with 12 MP stills (WWDC22), so pixels and Neural Engine throughput are unanswered on the Mac | Owner (the 2026-10-31 "on-phone loop allowed" answer is the standing default; the gate records the measured gap, and the owner may stop) | T-1 runtime format list and per-stage latencies on a recorded clip; T-6 on-device benchmark | T-7a, T-7b, T-8 |
| **G-LIVE** *(gap cycle)* Live MVP | Whether the live experience on one bookcase meets the owner's targets (O-7), and what the G-V2 packet inherits | Owner | V-5 run record on the video fixtures: time to first annotation, time to first useful card, live vs still recall, ID switches and label change rate, anchor jitter, revision rate and RBO, glass-to-glass histograms, calls and spend; E-6 write-up; a live demo on the phone | D-1 final; "MVP done" (with G-MVP) |
| **G-LIC** *(gap cycle)* Detector licence | ~~Whole repo AGPL-3.0, permissive retrain, or Enterprise licence (OC26)~~ **Ruled 2026-10-31 by the owner: whole repo AGPL-3.0.** Z-0 records it in `docs/gates/G-LIC.md` with the Ultralytics licence quote | Owner | Owner's word, 2026-10-31 ("AGPL-3.0 repo") | Nothing now; F-2 is unblocked |
| **G-W** *(post-MVP, gap cycle)* Weights release | Whether owner-trained weights may be published, under which licence, with which model card | Owner | Packet: faces stripped from training data (counts); boxes-only detector; membership-inference test (loss-threshold attack) near chance on held-out vs training photos; licence chain; model card and datasheet; takedown contact | Any public weight file. Until ruled, only registry JSON (hashes, metrics) is public |

**G-P pre-registered rule** (written before any fixture data is seen):
- **OC36 (2026-11-02):** recall and merges-plus-splits are measured on H-0's public yardstick (PROXY) and, where they exist, on V-6 taps (real use). Without taps, the rule decides on the yardstick and the record says the real-use side is machine agreement only.
- **Detector.** YOLO-OBB (P-2) is the default **if** its spine recall on the shelf-48 photos is ≥0.85 **and** its merge-plus-split rate is ≤10 %. If either fails, dispatch P-3 (SAM) and choose the arm with the higher recall; within 3 points, prefer fewer merges plus splits; still tied, prefer the faster one. If both arms miss the bar, apply F-DETECT (§6) and record it (OC23).
- **OCR.** Apple Vision is the default. VLM transcription becomes the default only if both of these hold:
  - its character error rate (CER) on ground-truth boxes is ≥20 % lower (relative) than Vision's best variant;
  - its invented-text rate is ≤2 %.

  If it doesn't become the default, VLM is used only inside adjudication.

---

## 3. Task cards

**Card format.** Each card lists:
- **goal**
- **entry** (inputs)
- **do**
- **exit** (the conductor runs it)
- **tier / size / risk**
- **⌨** (owner at the keyboard)
- **feeds** (experiment or gate)
- **budget** (turns)

**Rules every card inherits:** `OPERATING-MODEL.md` §6. Each card ends in a PR on `ojfbot/BookcaseDiscovery`, except Z-0, which the conductor pushes as the bootstrap, and the O-* cards, which are owner actions. Data paths are relative to `$BOOKCASE_DATA`. **The repo is public**, so every diff, PR body, commit message and CI log is public (REQUIREMENTS OC9 table).

### S0 — Bootstrap

#### Z-0 · Repo, scaffold, probe
- **goal:** a green, empty scaffold that every card can branch from.
- **entry:** checklist #3–#6.
- **do:**
  - Clone the owner-created public repo `ojfbot/BookcaseDiscovery` to `~/ojfbot/BookcaseDiscovery`. Add `LICENSE` (checklist #0b) and a `NOTICE` stub for catalog attribution.
  - Add `package.json` (pnpm, `engines.node >=22`, TypeScript, vitest, zod, ajv) and `tsconfig.json`.
  - Add `src/{capture,perceive,identify,recommend,ledger,report,eval,run}/index.ts` stubs, plus `bin/bookcase` (CLI router).
  - Add `helpers/ocr-vision/README.md` and `helpers/detect/README.md`.
  - Add a `.gitignore` covering `data/`, `private/`, `*.heic`, `*.HEIC`, `*.jpg`, `*.png` outside `test/fixtures/synthetic/`, `conversations.json`, and `.venv`.
  - Add `implementation-notes.md` with a `## Deviations` heading.
  - Copy `~/ojfbot/bookcase-discovery-plan/*` to `docs/plan/`.
  - Write `docs/probe.md`, covering: `node --version`; `pnpm --version`; `swift --version`; `python3 --version`; `uv --version`; SQLite FTS5 trigram via both the `sqlite3` CLI and `node:sqlite`; `exiftool -ver`; `df -h ~`.
  - Planning-time probe for comparison: node v24.22.1, SQLite 3.54.0 with trigram OK, swift present, uv and exiftool absent, 313 GB free.
- **exit:** `pnpm install && pnpm test` green; `docs/probe.md` lists each probe as PASS/FAIL.
- **tier:** conductor (Opus) · S · Medium · feeds all · budget 15.
- **also:** the conductor creates the vault coordination page if this planning session hasn't already (OPERATING-MODEL §9a).

#### Z-1 · Privacy guard (must merge before K-3, R-1 and any fixture card)
- **goal:** the OC9 boundary is enforced by a machine, not by memory (INV-19).
- **entry:** Z-0.
- **do:** `scripts/privacy-guard.mjs`, run three ways: as a pre-commit hook (`simple-git-hooks` via pnpm), in CI (a GitHub Actions job on every PR and push), and as `pnpm guard --history` for a full-history scan. It fails on any of these:
  - an image or RAW type outside `test/fixtures/synthetic/`;
  - any file with EXIF GPS tags, even under an allowed path;
  - files named `conversations.json` or `chat.html`, or JSON shaped like a ChatGPT export (`mapping` plus `create_time` keys);
  - any committed JSON entry with provenance `chatgpt-export` or `selfco`;
  - strings matching private paths: `~/selfco`, `/selfco/`, `raw/inbox/`, `$BOOKCASE_DATA/private`, `/Users/`;
  - files under `evals/` that are not on the aggregate-only schema allowlist (no per-spine rows, no OCR text);
  - a fixture manifest carrying `capture_time`, GPS or store fields;
  - binaries over 1 MB outside `test/fixtures/synthetic/`.

  Each rule gets a planted-leak test. Add `docs/privacy.md`, the OC9 table in operational form: where each data class lives and how to purge it from a working copy.
- **exit:**
  - `pnpm test` (every planted leak is caught; a clean tree passes);
  - the CI job is visible on the Z-1 PR;
  - `pnpm guard --history` is clean on `main`.
- **tier:** T2 Sonnet · S · Medium (public repo) · feeds INV-19, G-PUB · budget 40.

#### Z-2 · Fleet registration (after checklist #13)
- **goal:** BookcaseDiscovery is a registered fleet citizen that standup and lint can see.
- **entry:** Z-0; the owner has approved `NORTHSTAR-PROPOSAL.md` (checklist #13).
- **do:** (the registry checks below come from a 2026-10-31 read of core's `decisions/northstar/{README,schema,roadmap-schema,roadmap-template}.md`)
  - Write `.claude/northstar.md` from the approved text: the frontmatter **plus the body** the template requires (`# Northstar — BookcaseDiscovery (L1)`, a Vision paragraph, one `## P<n>` section per property).
  - Write `.claude/roadmap.md`: one slice per dispatched card, ids S1… in card order, `autonomy: gate-0`. Every `depends_on` is a typed ref `rm:rm-l1-bookcase-discovery#S<n>` (pairwise, no transitivity — flatten DELIVERY-PLAN §4's chains). Every slice meant for agent dispatch carries a machine-runnable `check:`; slices without one are demoted to `human_only` at compile time, so only O-* cards may lack it. Add the body: `# Roadmap — …`, a `**Route.**` paragraph, one `## PH<n> — <name>` per phase.
  - Open a PR on `ojfbot/core` adding the `registry:` and `roadmaps:` entries to `decisions/northstar/README.md` frontmatter (full-line comments only; path `../BookcaseDiscovery/.claude/…`; `ladders_up_to: l2-ojfbot`). The slug `l1-bookcase-discovery` is immutable once landed.
  - Append to `decisions/northstar/ladder-stress.jsonl` one verdict line per parent property laddered to (`ns:l2-ojfbot#P1`, `#P2`): `{date, app, northstar, parent, verdict, reason, actor}`. The P2 ladder (eval accuracy → "traces to a measurable property") is a likely `strain`; say so with a reason. Absence rejects the land.
  - Write **no** `status.jsonl` row: registration is not movement. Rows come later via `scripts/record-movement.mjs` at merges.
  - Run `node scripts/northstar-lint.mjs` and `node scripts/roadmap-lint.mjs` from core, and paste the output into both PRs.
- **exit:** both lints report 0 ERRORs; both PRs are open. The core PR is merged by the owner or conductor per core's own rules.
- **tier:** T1 Haiku · S · Low · feeds fleet standup · budget 25.

### S1 — Foundations

#### L-1 · Contracts and glossary
- **goal:** the shared vocabulary and record shapes every module writes.
- **entry:** Z-0.
- **do:**
  - **Event schemas**, authored as **JSON Schema in `contracts/`**, the source of truth (OC13). Zod validators in `src/ledger/contracts.ts` are generated from them, or checked against them by a test. Cover:
    - `ScanSessionOpened`, `ImageAssetIngested`, `ImageRejected`;
    - `SpineObserved` (polygon in original-image pixels, shelf, ordinal, photo setting);
    - `TextObserved` (one per variant: rotation, language-correction flag, text, confidence);
    - `HypothesesProposed` (candidates plus the explicit `unknown`, with evidence);
    - `AdjudicationRecorded`, `BandAssigned`, `StatusChanged`;
    - `WorkItemOpened` / `WorkItemClosed`;
    - `IdentityCorrected`, `PreferenceRecorded`;
    - `RecommendationIssued` / `RecommendationRevised`;
    - `RunStarted` / `RunFinished` (code commit, helper versions, model IDs, budget).
  - **Enums:**
    - status `unresolved | resolved | paused | needs-pixels` (no `exhausted`; INV-1);
    - band `verified | probable | candidate | unknown`;
    - unresolved reason `missing-pixels | no-catalog-candidate | conflicting-evidence | strategies-exhausted` (INV-8; "strategies exhausted" is a reason on an observation, never a shelf state).
  - **Ledger interface** (`append`, `events(after)`, view queries) with an in-memory implementation.
  - **Helper contracts** in `contracts/helpers/`: detect request/response and OCR request/response as JSON Lines. These are the same files Swift (Codable) and Python read; there is no second copy.
  - **`CONTEXT.md`**: every domain term from the brief, plus bands, statuses, the wall, cheap pass, expensive pass, fixture, PROXY.
  - **`docs/contracts.md`.**
- **exit:** `pnpm test`, covering:
  - every example in `test/fixtures/contracts/` validates;
  - the status enum has no `exhausted`;
  - every Zod validator agrees with its JSON Schema on the example set (OC13);
  - `IdentityCorrected` and `PreferenceRecorded` share no type (INV-3, INV-7).
- **tier:** T2 Sonnet · S–M · Low · feeds all · budget 45.

#### L-2 · SQLite ledger, status machine, replay
- **goal:** durable, replayable state (INV-14).
- **entry:** L-1 merged; `docs/probe.md` (`node:sqlite` vs `better-sqlite3`: use `node:sqlite` if its bundled SQLite has trigram, and log the choice).
- **do:**
  - `src/ledger/sqlite.ts`, implementing the L-1 interface:
    - WAL mode;
    - `events(seq, ts, run_id, type, payload)`, append-only, with UPDATE and DELETE rejected by trigger;
    - materialized views (observations, current hypotheses, bands, status, work items, recommendations), updated incrementally.
  - A table of legal status transitions:
    - budget exhaustion goes to `paused` (INV-2);
    - `resolved → unresolved` happens only on a trigger event: new image, correction, catalog refresh or model change.
  - `bookcase replay <db> --to <fresh db>` rebuilds the views and diffs them.
  - Content-addressed image store at `images/sha256/<aa>/<bb>/<hash>.<ext>`.
- **exit:** `pnpm test`, covering:
  - replaying a recorded synthetic run gives an identical view dump;
  - an illegal transition is rejected;
  - an UPDATE on `events` fails;
  - budget exhaustion gives `paused`.
- **tier:** T2 Sonnet · M · Low · feeds INV-1, 2, 14 · budget 60.

#### K-0 · Capture protocol sheet
- **goal:** a phone-readable checklist for the fixture shoot.
- **entry:** Z-0.
- **do:** write `docs/capture-protocol.md`, at most one screen per section:
  - **Camera settings:** the 48 MP HEIF format (setting names vary by iPhone model and iOS version; the sheet says "check the name on your phone" and lists the known names); main 1× lens only; no zoom; flash off.
  - **Per-shelf shots:** square on, the shelf filling the frame width, one photo per shelf, top to bottom.
  - **Whole-case shots:** one at 48 MP, then one at 12 MP (switch 48 MP off).
  - **Conditions:** glare (angle away from lights), keep people out of frame, ask the staff first.
  - **Afterwards:** name the album `sf-store-001`; note the shelf count in the album's first photo caption or send it to the conductor.
- **exit:** file committed; the conductor reads it on a phone-width preview.
- **tier:** T1 Haiku · XS · Low · feeds O-2, E1 · budget 10.

#### K-1 · `capture` module and ingest validator
- **goal:** only verified originals enter the ledger; working copies carry no GPS (INV-11, INV-12).
- **entry:** L-1 merged (the in-memory ledger is enough; rebase onto L-2 when it lands).
- **do:** `bookcase ingest <folder> --session <name> [--settings <map.json>]`. For each file:
  1. Hash it (sha256) and copy it read-only into the image store.
  2. Validate it:
     - HEIC or JPEG;
     - pixel dimensions ≥ the session minimum (default 12 MP, either orientation);
     - EXIF `Make`, `Model` and `DateTimeOriginal` present;
     - reject zero-byte files, `.icloud` placeholders and files below the minimum;
     - flag edited derivatives (`IMG_E*` name, a sibling `.AAE`, or a `Software` tag that isn't the camera's).
  3. Make the working copy. With exiftool, use `exiftool -gps:all= -o`. Without it, re-encode with `sips` and **read back** to prove there is no GPS.
  4. Emit `ImageAssetIngested` (dimensions, setting tag, capture time) or `ImageRejected` (reasons).

  Print an accept/reject table at the end. Never modify the source folder.
- **exit:** `pnpm test`, using synthetic fixtures generated in-test:
  - a JPEG with EXIF is accepted;
  - a 1.7 MP image with no EXIF is rejected with `below-min-resolution` and `no-exif`;
  - a GPS-tagged input gives a working copy with no GPS;
  - an `IMG_E` name is flagged.

  If the conductor has the 2026-10-31 chat attachment's path, run it too; it must be rejected.
- **tier:** T2 Sonnet · S · Low · feeds INV-11, INV-12 · budget 40.

#### V-1a · Label format and labelling-tool spike (adopt before build; OC21)
- **goal:** the owner's labelling hours are as efficient as possible, without spending an M card building a tool that may already exist. **This card is on the critical path.**
- **entry:** Z-0 (independent of L-1); checklist #6 (Label Studio install approved).
- **do:**
  - **Schema** in `docs/labels.md` and `src/eval/labels.ts`. A session holds photos (hash, setting, shelf index). A photo holds:
    - shelf bands (whole-case photos);
    - spines, each with: id; 4-point polygon; shelf; ordinal; `kind: spine | face-out | stacked | not-a-book`; `text: {title, author, series?}`; `unreadable`; `catalogId: null`; notes.
  - **Spike Label Studio** locally (`uv tool run label-studio`, bound to `127.0.0.1`): a project with rotated `RectangleLabels` (kinds as labels), `TextArea` fields for title and author, images served from `$BOOKCASE_DATA`. Check, and record in `docs/labelling.md`: 48 MP image load and zoom speed; rotated-box drawing; keyboard flow for title → author → next; export → converter `pnpm labels:import <export.json>` into the schema; no data leaves the machine (no cloud sync, no telemetry).
  - **Decision rule** (pre-registered): adopt if a synthetic 20-spine shelf can be labelled in ≤25 minutes by the agent and the owner's 10-minute trial (checklist #2) raises no blocker. Otherwise dispatch **V-1b**.
- **exit:** `pnpm test` (converter round-trips a Label Studio export into the schema and back); `docs/labelling.md` with the timings; the owner's trial verdict recorded. The tool reads and writes only under `$BOOKCASE_DATA/labels/` (private).
- **tier:** T2 Sonnet · S · Low · ⌨ (10-minute trial) · feeds O-3 · budget 35.
- **Outcome 2026-11-02 (OC36):** Label Studio not adopted. The owner tried it and stopped hand labelling. The label schema and converter (`src/eval/labels.ts`) stay, for importing the public yardstick and machine labels. V-1b is not built.

#### ~~V-1b · Custom labelling tool~~ — withdrawn 2026-11-02 (OC36)
- **goal:** a keyboard-first labeller tuned to spines.
- **entry:** V-1a verdict "build".
- **do:**
  - **Tool:** `pnpm label <session>` starts a `127.0.0.1`-only server for one page that does:
    - pan and zoom over 48 MP images, using tiles or a downscaled view plus a zoomed crop;
    - draw a rotated box with two drags;
    - keyboard flow: type the title, Tab, the author, Enter for the next spine; `U` marks unreadable, `N` marks not-a-book;
    - autosave to `labels/<session>.json`, with rolling backups;
    - progress per shelf;
    - an undo.
  - **No detector prefill** on `sf-store-001` (OC8). The prefill code path may exist, behind a flag that is off.
- **exit:** a Playwright e2e test (in-app browser or `@playwright/test` via pnpm) on a synthetic image: create 3 labels, reload, and confirm they persist and the JSON validates. Then the owner's 10-minute trial (checklist #2), with the feedback filed as issues on the repo. Issues are public, so they carry no screenshots of fixture photos. The tool reads and writes labels only under `$BOOKCASE_DATA/labels/` (private).
- **tier:** T2 Sonnet · M · Low · ⌨ (10-minute trial only) · feeds O-3 · budget 60.

#### V-2 · Scorer
- **goal:** one command that prints every metric the experiments need (INV-16, INV-17).
- **entry:** L-1, V-1a (schema).
- **do:** `bookcase score <session> --run <id>` computes:
  - **Spine positions:** polygon-IoU ≥0.5 one-to-one matching per photo; recall, precision, merges (one detection covers ≥2 labels at ≥30 % each), splits, and `not-a-book` false positives.
  - **Cross-setting (E1):** whole-case detections are assigned to shelves by the owner's shelf bands, then aligned against the label order by left-to-right sequence alignment.
  - **OCR CER:** normalized Levenshtein against `title + author`, for both the best variant and the selected variant.
  - **Identity** (once it exists):
    - top-1 and top-5 over resolvable labels;
    - **wrong-but-confident** = band ∈ {verified, probable} and wrong;
    - unknown-correct on `not-in-catalog` labels.
  - **Late-pass discoveries:** resolved in a pass after the first.
  - **Strata:** spine width in pixels (bins), kind, shelf.

  It writes **aggregates only** to the public `evals/<run-id>/{metrics.json,report.md}`, carrying the commit, helper versions, model IDs and input hashes. It writes **per-spine detail** (OCR text, matches, errors) to the private `$BOOKCASE_DATA/private/evals/<run-id>/`. The aggregate schema is the Z-1 allowlist.
- **exit:** `pnpm test` with synthetic labels and observations of known answers, covering perfect, merged, split, rotated and partial cases.
- **tier:** T2 Sonnet · M · Low · feeds E1–E5 · budget 60.

#### W-1 · Report scaffold
- **goal:** the clickable "where is it in the photo" view.
- **entry:** L-1.
- **do:** `bookcase report <session> [--run <id>]` writes a static site under `reports/<session>/<run>/`, which lives in the data dir because it contains images:
  - display derivatives via `sips` (long edge ≤3000 px), with coordinate scaling;
  - an SVG overlay coloured by status and band, with a second pattern channel for colour-blind reading;
  - a side panel per spine: OCR variants, candidates including `unknown`, evidence, versions, status history;
  - an unresolved list with reasons;
  - a "closer photo" work-item list;
  - a placeholder recommendations panel.

  Build it from an in-memory ledger fixture.
- **exit:**
  - `pnpm test` (structural snapshot of the generated HTML);
  - a screenshot taken with the in-app browser on a **synthetic or proxy image only**, attached to the PR. No fixture photos in a PR, ever.
- **tier:** T2 Sonnet · M · Low · feeds G-M1 · budget 55.

### S2 — Catalog and profile

#### C-R · Catalog backend research (OC32)
- **goal:** a catalog backend that can reach every spine, chosen on evidence.
- **entry:** none (research; can run before GO).
- **do:**
  - Survey the Library of Congress data services (catalog search, bulk MARC and linked-data downloads) and the available bookseller and bibliographic APIs and catalogs: Open Library, Google Books, ISBN databases, and bookseller or distributor feeds.
  - For each, fetch and quote: terms of use and licence (including public-repo and caching rights), coverage of in-print and science-fiction trade titles, bulk download vs per-query access, rate limits, cost, and whether spine-style fragment search is possible.
  - Keep the plan's rule (a local index searches; live APIs verify) unless the evidence argues otherwise, and say so.
  - Measure what share of the fixture's labelled spines each source covers, when the labels exist.
  - **Library venues (owner, 2026-11-02):** the owner wants to prototype at the McKinney and Frisco public libraries. Find out what public catalog each one exposes (OPAC, any API or export, WorldCat holdings) and on what terms. Also find out whether their **spine call-number labels** can serve as a recognition signal: the classification scheme, and the label format as photographed. Note what permission is needed to film there.
- **exit:** `docs/catalog/backend-options.md` with a sourced table, a recommended backend, and a proposed change to OC20 if warranted. Owner ruling as a one-line decision.
- **tier:** T2-J Opus · S · Low · feeds C-1/C-3 follow-ups, OC20 revisit, G-MVP coverage · budget 40.

#### C-0 · Licence check
- **goal:** know what local indexing and later redistribution allow.
- **entry:** Z-0.
- **do:** read these, via web-fetch:
  - the Open Library data licence page;
  - ISFDB licence and attribution terms;
  - Roboflow book-spine dataset licence;
  - IEEE DataPort shelf-spine dataset terms;
  - Ultralytics AGPL-3.0, for a distributable app;
  - the SAM licence;
  - Open Library cover-image terms.

  Write `docs/licences.md` as a table:

  | source | licence | URL | quote (≤15 words) | local indexing OK? | redistribution OK? | attribution text |
  |---|---|---|---|---|---|---|

  Mark anything not fetched as **UNVERIFIED**.
- **exit:** file committed. Any "local indexing not OK" goes to the conductor, which raises G-L.
- **tier:** T1 Haiku · XS · Low · feeds G-L · budget 15.

#### C-1 · ISFDB import
- **goal:** the science-fiction specialist catalog, staged locally.
- **entry:** checklist #5; C-0 shows no local-use blocker.
- **do:**
  - Download the latest dump linked from the ISFDB downloads page into `raw/isfdb/`.
  - Write a **streaming parser for the mysqldump INSERT statements** in TypeScript, with no MySQL server.
  - Stage these tables to `catalog/isfdb-staging.sqlite`: titles, authors, canonical author links, pubs (ISBN, publisher, year), pub contents, series, tags and tag mapping.
  - Write `docs/catalog.md` with the field map and the dump date.
- **exit:**
  - counts printed;
  - spot checks: *Neuromancer* → William Gibson with ISBNs; *Red Mars* → Kim Stanley Robinson; *Snow Crash* → Neal Stephenson;
  - the staging content hash is stable across two parses.
- **tier:** T2 Sonnet · M · Low · feeds C-3 · budget 55.

#### ~~C-2 · Open Library import~~ — moved to the post-MVP backlog (OC20, Fable pass)
The Opus draft carded a science-fiction subset of the Open Library dumps here. The MVP catalog is ISFDB only; the card text is preserved in `README.md` § Changelog for when backlog #4 reopens it.

#### C-3 · Catalog index and retrieval
- **goal:** fragment matching like "GIBS… NEUROM…".
- **entry:** C-1.
- **do:**
  - Build `catalog/catalog.sqlite` from the ISFDB staging:
    - `works` (id, title, subtitle, authors, series, year, tags, sources);
    - `editions` (ISBN, publisher, year, work_id).
  - Normalize: casefold, strip punctuation and diacritics, handle initials and "Surname, Given" variants.
  - Build FTS5 **trigram** indexes over title, authors and series.
  - Expose `retrieve(variants[], k)` → candidates with per-field match evidence, and a CLI `bookcase catalog query`.
  - Write a golden set, `evals/golden/fragments.jsonl`: about 50 queries from known SF titles, plus OCR-noise variants: `0/O`, split words, truncated author names, series set larger than title.
- **exit:**
  - ≥90 % top-5 on the clean golden queries;
  - noisy top-5 and p95 latency **recorded** (no target).
- **tier:** T2 Sonnet · M · Low · feeds I-1, V-3, V-4, R-1 · budget 60.

#### R-0 · Taste model research (OC33) — *J*
- **goal:** a model of a reader's taste in terms of ideas, themes, patterns, authors, styles, questions and topoi, which ranking and explanations can use.
- **entry:** none (research; can run before GO). It reads the public seeds only, never ChatGPT or SelfCo data (OC9).
- **do:**
  - Survey where those features can come from, fetching and quoting sources: ISFDB tags; Library of Congress subject headings and genre/form terms (ties to C-R); publisher descriptions; and LLM extraction of themes and topoi from descriptions, with provenance and cost.
  - Define the feature vocabulary.
  - Define "centre of taste" and "temperature" (distance from the centre along orthogonal axes), and how one pick is explained in those terms.
  - Specify what dev mode shows.
  - Propose how R-1 and R-2 change, and what stays post-MVP.
- **exit:** `docs/recommend/taste-model.md` with the feature sources table, the vocabulary, the temperature definition, three worked examples from the public seeds (Gibson, Robinson, Stephenson), and an owner ruling.
- **tier:** T2-J Opus · S · Low · feeds R-1, R-2, U-1 lens design · budget 40.

#### R-1 · Reading profile and seeds
- **goal:** tastes with provenance, kept apart from identity (INV-18).
- **entry:** C-3 (needed for expansion).
- **do:**
  - **Model** in `src/recommend/profile.ts`. Each entry has:
    - a subject (author / work / series / tag);
    - a relation: `read | liked | cooler | not-for-me | inferred-interest | unknown`;
    - provenance (source, ref, date).
  - **Seeds** in `profile/seeds.json`, **public in the repo** (OC9): owner statements, corrections and preferences, with provenance.
  - **Expansion:** "read all of Gibson" becomes a `read` entry per Gibson novel in the catalog, marked `expanded: true`.
  - **Overlay mechanism only:** at run time the profile is `profile/seeds.json` plus an optional private overlay `$BOOKCASE_DATA/private/profile-overlay.json`. The ChatGPT-export importer that would populate the overlay is **post-MVP** (OC22, backlog #5); the MVP ships the merge and the refusal rule, not the importer.
  - **Review sheet** (`$BOOKCASE_DATA/private/profile-review.html`) for O-4.
- **exit:** `pnpm test`, covering:
  - no entry with provenance `chatgpt-export` or `selfco` can be written to `profile/seeds.json` (the writer refuses it, and the Z-1 guard catches it);
  - the overlay merge never promotes an overlay entry to `read` or `liked`.
- **tier:** T2 Sonnet · S · Low · feeds O-4, R-2 · budget 35.

#### O-4 · Owner reviews the profile ⌨
- **do:** open `profile/review.html`; confirm or strike each expanded entry and seed; optionally add the ChatGPT export.
- **exit:** the owner sends "profile reviewed"; the conductor confirms `profile/seeds.json` is updated.
- About 15 minutes · feeds R-2.

### S3 — Perception spikes (PROXY)

#### P-1 · `ocr-vision` Swift helper
- **goal:** local multi-rotation OCR behind a contract.
- **entry:** L-1 (helper contract).
- **do:**
  - A SwiftPM CLI in `helpers/ocr-vision/` that reads JSON Lines `{id, image, polygon, rotations}`.
  - Perspective-crop the polygon (`CIPerspectiveCorrection`).
  - Rotate 0/90/270°.
  - Run `VNRecognizeTextRequest` at the accurate level, with **language correction off and on as two tagged variants**.
  - Emit `{id, variants[{rotation, langCorrection, text, confidence}], version{helper, macOS, request revision}}`.
  - Add a TS wrapper, `src/perceive/ocr.ts`.
- **exit:**
  - `swift build -c release && swift test`, using text images rendered in-test at known rotations;
  - a TS contract test that spawns the helper;
  - 5 public-dataset crops run and their output saved as PROXY.
- **tier:** T2 Sonnet · M · Low · feeds E3, P-4 · budget 60.

#### P-2 · `detect` helper, YOLO-OBB spike
- **goal:** a spine detector and a PROXY baseline.
- **entry:** checklist #5–#6; proxy datasets present; a heavy-compute slot.
- **do:**
  - Set up `helpers/detect/` with uv.
  - Convert the public set(s) to the Ultralytics OBB format.
  - Fix a photo-level train/val/test split and record it.
  - Fine-tune YOLO-OBB (n or s) on MPS with a fixed seed. Weights go to `models/`.
  - Build the CLI: JSON Lines `{image}` → `{polygons, scores, version{backend, weights sha256}}`.
  - Add a TS wrapper, `src/perceive/detect.ts`.
  - Report precision, recall and mAP on the test split, labelled **PROXY (library shelves)**.
- **exit:**
  - the CLI runs on 3 held-out proxy images;
  - `evals/proxy-P2/` is committed (metrics only, no images);
  - the AGPL note is in `helpers/detect/README.md`.
- **tier:** T2 Sonnet · M · Low · feeds E2, P-4 · budget 70.

#### P-3 · SAM baseline (conditional, OC23)
- **goal:** the challenger arm for E2, run only when YOLO-OBB misses the G-P bar on the real fixture.
- **entry:** E-2's first pass shows YOLO-OBB shelf-48 recall <0.85 or merge-plus-split >10 %; P-2 (contract and split); a heavy-compute slot; the SAM checkpoint download (checklist #5).
- **do:**
  - `--backend sam`: SAM automatic masks, filtered to spine-like regions (aspect ratio, orientation, area), converted to polygons, using the same contract.
  - PROXY metrics on P-2's test split.
- **exit:** `evals/proxy-P3/` committed; both backends run through the same TS wrapper.
- **tier:** T2 Sonnet · M · Low · feeds E2 · budget 50.

#### P-4 · `perceive` wiring
- **goal:** the cheap pass on every spine, traceably (INV-14).
- **entry:** L-2, P-1, P-2 merged.
- **do:** `bookcase perceive <session> [--detector yolo|sam] [--ocr vision]`. For each working copy:
  - detect;
  - assign the shelf: from the manifest for per-shelf photos, or by y-clustering into bands for whole-case photos;
  - set the ordinal by x;
  - crop;
  - OCR;
  - emit `SpineObserved` (polygon in original-image pixels), `TextObserved` per variant, and run versions. Status `unresolved`.

  The command is idempotent on (image hash, versions). Perceive holds no bibliographic knowledge.
- **exit:** on 3 proxy images:
  - the report renders boxes and OCR;
  - `replay` gives identical views;
  - a re-run with the same versions appends no observation events.
- **tier:** T2 Sonnet · M · Low · feeds M1 · budget 55.

### S4 — Fixture (owner lane)

#### O-1 · Photos unblock ⌨
- Checklist #1.
- **exit:** the owner reports which path worked, the folder, and the album photo count.

#### K-2 · Verify the received files are originals
- **goal:** nothing relies on bytes that might be derivatives.
- **entry:** O-1.
- **do:** for each received file, record:
  - format;
  - pixel dimensions (`sips -g pixelWidth -g pixelHeight`);
  - EXIF presence (`Make`, `Model`, `DateTimeOriginal`) via exiftool, or `mdls` without it;
  - GPS present yes/no (**never print the coordinates**);
  - `.AAE` siblings and `IMG_E` names.

  Also:
  - compare the file count with the album count;
  - if two paths delivered the same photo, compare their sha256;
  - give a verdict per file: original / derivative / suspect;
  - say whether the album already holds all three E1 settings of one case (OC7).

  Write `docs/ingest-verification.md`, with no images and no coordinates. It records whether the AirDrop "All Photos Data" path delivers true originals. That answers an open question from the assessment.
- **exit:** report committed. The conductor tells the owner whether O-2 is still needed (expected: yes).
- **tier:** T1 Haiku · XS · Low · feeds K-3, O-2 · budget 15.

#### O-2 · Fixture shoot ⌨
- Checklist #8, following `docs/capture-protocol.md`.
- Then repeat O-1's path for the new album, and K-2 runs again on it. That re-run is part of the K-2 card, budget +10.

#### K-3 · Fixture ingest and manifest
- **goal:** `sf-store-001` in the ledger, with a committed manifest.
- **entry:** K-1 and **Z-1** merged; K-2 verdicts all "original" (or suspects excluded, with a logged deviation).
- **do:**
  - Build the settings map from the owner's shelf order (the protocol's shooting order).
  - Run `bookcase ingest`.
  - Commit the **public** `fixtures/sf-store-001/manifest.json`: hash, dimensions, setting, shelf index. It has **no capture time, no GPS, no store name and no images**. Those live in the private manifest under `$BOOKCASE_DATA/private/fixtures/`. The Z-1 guard must pass.
- **exit:** every photo accepted, or each reject explained; the manifest validates.
- **tier:** T1 Haiku · S · Low · feeds O-3, M1 · budget 20.

#### ~~O-3a · Blind audit slice~~ — withdrawn 2026-11-02 (OC36)
The owner stopped hand labelling. The scorecard is H-0's public yardstick (PROXY) plus optional V-6 taps (real use).

#### ~~O-3b · Review the machine labels~~ — withdrawn 2026-11-02 (OC36)
No review queue. F-0 accepts a label only when readers agree and the catalog confirms; the rest stays `unknown` with a reason.

#### V-3 · Label resolution
- **goal:** the labels carry catalog IDs, so identity can be scored.
- **entry:** F-0 (OC36: machine labels, not O-3), C-3.
- **do:** for each readable label without a `catalogId`:
  - run `retrieve`;
  - auto-accept on a unique exact normalized title-plus-author match;
  - otherwise list the label on `labels/resolve.html` for the owner to pick a candidate or mark `not-in-catalog` (⌨ about 15 minutes).

  Record the count of each outcome.
- **exit:** 100 % of readable labels have an ID or `not-in-catalog`; the counts are in `fixtures/sf-store-001/labels-summary.json` (counts only).
- **tier:** T2 Sonnet · S · Low · ⌨ short · feeds E-1–E-5 · budget 30.

#### V-4 · Catalog autocomplete in the labelling tool (optional)
- **goal:** cut labelling time and make V-3 almost empty.
- **entry:** ~~V-1a (or V-1b) and C-3 merged before O-3 starts~~ **Dropped 2026-11-02 (OC36): there is no hand labelling to autocomplete.**
- **do:**
  - A typed fragment shows catalog suggestions.
  - Free text is always allowed.
  - The label stores both the typed text and the chosen ID.
- **exit:** e2e test; the owner sees it in their first sitting.
- **tier:** T2 Sonnet · S · Low · feeds O-3 · budget 30.

### S5 — M1 experiments

#### E-1 · Pixels vs inference
- **goal:** settle the capture protocol (assessment §5).
- **entry:** P-4, V-2, V-3; a heavy-compute slot.
- **do:**
  - Run the baseline perceive (YOLO plus Vision) on the whole-12, whole-48 and shelf-48 photos.
  - Score them.
  - Measure identity top-5 through **C-3 `retrieve` on the best variant only**, a quick path that doesn't wait for I-1.
  - Stratify by spine pixel width.
  - Write `evals/E1/` and the `docs/gates/G-E1.md` packet.
- **exit:** run record committed; packet written.
- **tier:** T2 Sonnet · M · Low · feeds **E1 → G-E1** · budget 45.

#### E-2 · Which detector
- **entry:** P-4, V-2, V-3; a heavy-compute slot.
- **do:** run YOLO-OBB on the shelf-48 photos. Measure recall of physical positions, merges, splits, `not-a-book` false positives and runtime. Apply the G-P detector rule: if YOLO-OBB passes the bar, record "SAM not run" with the numbers; if not, the conductor dispatches P-3 and E-2 re-runs as a two-arm comparison (budget +20).
- **exit:** `evals/E2/` committed; G-P detector rule applied in `docs/gates/G-P.md`.
- **tier:** T2 Sonnet · M · Low · feeds **E2 → G-P** · budget 40.

#### E-3 · Which OCR
- **entry:** P-1, V-2, V-3; checklist #7.
- **do:**
  - Use the **owner's label boxes** as crops, so the experiment measures OCR, not detection.
  - Arms:
    - Vision 0/90/270 with language correction off and on;
    - VLM transcription with `claude-haiku-5-5` (prompt: transcribe exactly what is printed, `unreadable` allowed, **no catalog or profile hints**);
    - optionally a cloud OCR arm, if the owner supplied a key.
  - Hard cap: one call per labelled spine.
  - Measure CER, **invented-text rate** (an output naming a catalog work different from the label's), tokens and spend.
- **exit:** `evals/E3/` committed; G-P OCR rule applied.
- **tier:** T2 Sonnet · M · Medium (paid) · feeds **E3 → G-P** · budget 45.

The conductor then writes the **M1 demo** (fixture report from the G-P defaults) and asks **G-E1** and **G-M1**.

### S6 — Identify

#### I-1 · Candidate retrieval
- **entry:** C-3, P-4; G-P recorded.
- **do:**
  - Build normalized fragments from all text variants, including the reversed reading direction.
  - `retrieve` top-k (k = 10) per spine, merged across variants.
  - **Always append `unknown`** (INV-5).
  - Emit `HypothesesProposed` with per-candidate evidence.
  - Compute neighbour features (series runs, alphabetical order) but **store them separately**, at weight 0 by default (assessment §3).
- **exit:** `pnpm test`; retrieval-only top-1 and top-5 on the fixture recorded.
- **tier:** T2 Sonnet · S · Low · feeds E4 arm A · budget 35.

#### I-2 · Joint shelf assignment (copies allowed) — *J*
- **goal:** use the whole shelf without collapsing copies (INV-4; ADR §3).
- **entry:** I-1.
- **do:**
  - Design and implement the per-shelf assignment over candidates plus `unknown`:
    - maximize total evidence score;
    - add a duplicate penalty for the same work on **non-adjacent** spines;
    - waive the penalty for adjacent spines with near-identical OCR (likely copies);
    - give `unknown` a fixed threshold score;
    - keep ranked alternatives per spine.
  - Write `docs/design/assignment.md` (the rule, why it is not a one-to-one Hungarian assignment, failure cases).
  - Tests on synthetic shelves: copies, series runs, abbreviated authors, series name set larger than title.
- **exit:** `pnpm test`; fixture top-1 recorded against I-1 alone.
- **tier:** T2-J Opus · M · Low · feeds E4 arm A · budget 50.

#### I-3 · Bands, reasons, work items
- **entry:** I-2.
- **do:** implement the band rules in `src/identify/bands.ts`:
  - **verified** = an ISBN read that matches an edition, or a user correction;
  - **probable** = title and author fragments both match one candidate, with no contradiction and a margin over the runner-up of at least *m*;
  - **candidate** = a partial match with alternatives still alive;
  - **unknown**, with a reason:
    - `missing-pixels`: spine width below *w* px, or OCR empty;
    - `no-catalog-candidate`: top score below *t*;
    - `conflicting-evidence`.

  Adjudication agreements on the same crop count once (INV-6). `missing-pixels` opens a "closer photo" `WorkItem` (shelf plus ordinal).

  Record *m*, *w* and *t* as named config. They are tuned on the fixture, which is a dev set (OC11).
- **exit:** `pnpm test` for each rule; band distribution and pre-adjudicator wrong-but-confident rate on the fixture recorded.
- **tier:** T2 Sonnet · S · Low · feeds E4, G-R packet · budget 40.

#### [G-R] · Reconciliation ruling
- The owner rules on the conductor's packet before I-4 is dispatched.
- If the ruling changes the design, the conductor re-cards I-4, I-5, E-4 and E-5 in a `plan-update` PR before dispatching them.

#### I-4 · Bounded adjudicator
- **entry:** I-3; **G-R**; checklist #7.
- **do:** `src/identify/adjudicate.ts`:
  - **Input:** the crop (from the working copy, downscaled to the model's limit) plus the top-k candidates (id, title, author, year, series) — **and nothing else**.
  - **Output:** structured `{choice: candidateId | "none", readText?}`. A choice outside the candidate set is rejected and retried once.
  - **Cache** keyed on (crop hash, candidate-set hash, model ID).
  - **Budget wrapper:** a session cap, ≤1 retry per crop, tokens recorded per call; exhaustion sets `paused` (INV-2).
  - Only ambiguous spines are sent: band `candidate`, or `unknown(conflicting)`.
  - The model is configurable; the default is `claude-haiku-5-5` until G-E4.
  - **Structural test:**
    - nothing under `src/identify/` imports `src/recommend/` or the profile;
    - a prompt snapshot contains no profile field (INV-13).
- **exit:** `pnpm test` (with a fake model client); one live call on one fixture crop, with tokens recorded.
- **tier:** T2 Sonnet · M · Medium (paid) · feeds E4, E5 · budget 55.

#### I-5 · Expensive-pass scheduler and reactivation
- **entry:** I-4.
- **do:** `src/run/` (the orchestrator; it may import both `identify` and `recommend`):
  - **Cheap pass** on 100 % of spines every run.
  - **Expensive pass** under a fixed share: 30 % of the budget to unresolved spines in shelf order, 70 % in relevance order.
    - Relevance is injected as a function: the max relevance over live candidates, uniform until R-2 lands.
    - Relevance changes only the **order of spending**, never identity scores. Document this as consistent with INV-13.
  - **Triggers** (new image, correction, catalog refresh, model change) requeue the affected observations.
- **exit:** `pnpm test`, covering:
  - the 30 % share is honoured;
  - exhaustion gives `paused`, never closed;
  - a correction trigger requeues its shelf (INV-1, INV-2).
- **tier:** T2 Sonnet · S · Low · feeds R-3, M-1 · budget 40.

#### E-4 · Does the LLM earn its cost? — *J*
- **entry:** I-4, I-5; a heavy-compute slot not needed.
- **do:** run these arms on the fixture:
  - **A:** retrieval plus assignment only;
  - **B:** A plus the adjudicator on Haiku;
  - **C:** A plus the adjudicator on Sonnet;
  - **D (multi-step):** **only if** the residue after the better of B and C is ≥15 % of readable spines **and** a manual read of 20 residue cases finds that at least half could be recovered by more reasoning rather than more pixels. Otherwise record "D not run" and why.

  Measure top-1, wrong-but-confident, tokens per adjudication and spend. Write the `docs/gates/G-E4.md` packet.
- **exit:** `evals/E4/` committed; packet written.
- **tier:** T2-J Opus · M · Medium (paid) · feeds **E4 → G-E4** · budget 50.

#### E-5 · Should context ever touch identity?
- **entry:** I-4; R-1 (profile).
- **do:**
  - An experiment harness in `src/eval/` only. **The flag exists only there; `identify` has no such option.**
  - Adjudicate the same ambiguous set twice: with profile context injected, and without.
  - Measure wrong-but-confident and top-1.
  - Write the `docs/gates/G-E5.md` packet. The default recommendation is to keep the wall, unless top-1 rises with no rise in wrong-but-confident.
- **exit:** `evals/E5/` committed; packet written.
- **tier:** T2 Sonnet · S · Medium (paid) · feeds **E5 → G-E5** · budget 30.

### S7 — Recommend and corrections

#### R-2 · Ranking with rationale and location
- **entry:** R-1, O-4, I-3; R-0 (or the MVP features below if R-0 has not ruled).
- **do:** `src/recommend/rank.ts`:
  - **Eligible:** observations with band ≥ `candidate`. The band is shown beside the rank and is **never multiplied into it**.
  - **Features:**
    - liked author;
    - ISFDB tag overlap with liked works;
    - `cooler` lowers the score but does not exclude;
    - `read` is shown as "you've read this" and is not recommended;
    - novelty (not in profile).
  - **Discovery temperature (OC33):** default "middle of the curve". Higher settings draw picks from orthogonal theme and topos axes. This replaces the fixed 1-in-5 serendipity share. No collaborative filtering.
  - **Templated rationale** built from features, phrased in theme, topos and style terms where R-0 provides them. No LLM.
  - **Lens:** reading taste, plus serendipity (MVP).
  - Emit `RecommendationIssued` / `RecommendationRevised` with a ranking version.
  - Unidentified spines go to a "not yet identified" section and never to zero relevance (INV-9).
- **exit:** `pnpm test`; the fixture run produces a ranked list with a rationale and location for each entry.
- **tier:** T2 Sonnet · M · Low · feeds M-1 · budget 50.

#### R-3 · Corrections and preferences
- **entry:** I-5, R-2.
- **do:**
  - `bookcase correct <obs> --is <workId> | --not <workId> | --unreadable` writes `IdentityCorrected`. The band becomes `verified`, and a reactivation trigger fires for the shelf.
  - `bookcase prefer <workId> --more | --less | --not-for-me | --already-read` writes `PreferenceRecorded`.
  - The report shows copy-able commands per spine.
- **exit:** `pnpm test`, covering INV-7: `--not-for-me` leaves identity unchanged, and a correction leaves the profile unchanged; a correction moves the late-pass counter.
- **tier:** T2 Sonnet · S · Low · feeds M-1 · budget 35.

#### W-2 · Report integration
- **entry:** W-1, R-2, R-3.
- **do:**
  - Bands, candidates and adjudication evidence per spine.
  - A recommendations panel with **click-to-locate** (it highlights and scrolls to the spine).
  - "Revised" marks.
  - The unresolved queue with reasons.
  - Work items.
  - A run summary: scorer metrics when labels exist, spend.
- **exit:** `pnpm test`; a proxy-image screenshot in the PR (no fixture photos).
- **tier:** T2 Sonnet · S · Low · feeds G-MVP · budget 35.

### S8 — MVP

#### M-1 · MVP run
- **entry:** S6 and S7 exits; G-E4 and G-E5 ruled.
- **do:**
  - Start from a fresh DB and run `ingest → run → report` on `sf-store-001` with the ruled config.
  - Then apply 3 simulated corrections taken from the labels, to exercise reactivation, and run again.
  - Score both passes, so the late-pass discoveries are measured.
  - Write `evals/MVP/` and the `docs/gates/G-MVP.md` packet.
- **exit:** run record and packet committed; spend under the ceiling.
- **tier:** T2 Sonnet · M · Medium (paid) · feeds **G-MVP** · budget 40.

#### O-5 · Owner judges recommendations ⌨
- **do:** for each of the top 15:
  - useful / not for me / already known, via `prefer`;
  - or wrong identity, via `correct`.
- **exit:** the conductor records the "recommendations judged useful" count in `evals/MVP/`.
- About 30 minutes.

#### D-1 · Runbook and handoff
- **entry:** G-MVP.
- **do:**
  - `docs/RUNBOOK.md`: the next store visit end to end, statuses and bands, where data lives, how to delete a session's data, spend.
  - `docs/plan/HANDOFF.md`: what is built, the numbers (with links), deviations roll-up, and the post-MVP backlog (§8) in order.
- **exit:** files committed; the owner has read them.
- **tier:** T2 Sonnet · S · Low · budget 25.

#### D-2 · ADR into core
- **entry:** G-MVP.
- **do:**
  - Copy the ADR draft, updated with each gate's ruling, to `core/decisions/adr/draft-bookcase-discovery-architecture.md`.
  - Open a PR on `ojfbot/core`. Do not merge without checklist #12.
- **exit:** PR URL.
- **tier:** T1 Haiku · XS · Low · budget 10.

### S9 — Live track (gap cycle, 2026-10-31 late; OC24–OC25, OC28–OC29)

Newline unit per card: `CURRICULUM-MAP.md` §1b. All S9 cards inherit INV-20 to INV-23. Stage A cards (T-0 to T-5) need no photos; T-1 and T-6 onward need the owner's iPhone.

#### T-0 · Live contracts
- **goal:** the event and record schemas the stream needs, as JSON Schema beside L-1's.
- **entry:** L-1 merged.
- **do:** add `Track` (id, session, first/last frame, state: born/stable/lost), `FrameSample` (sparse, ≤1 Hz, hash + timestamp), `TrackWindow` (per-track summary per window: best-frame hash, sharpness, pose), `OcrReading` scoped to a track with a `condition` key (viewpoint bucket, exposure bucket) for INV-20, `LookupResult`, `AdjudicationRequested/Result/CacheHit`, `CardProposed`, `CardRevised` (`previous`, `reason_event_ids`, `diff`), `CardRetracted`, `CardUndo`. Legal transitions for `Track`. Glossary entries in `CONTEXT.md`.
- **exit:** examples validate; Zod agrees with the schemas; a test proves two `OcrReading`s with the same `condition` count as one observation; `replay` over a recorded event file is byte-identical.
- **tier:** T2 Sonnet · S · Low · feeds T-2–T-5, T-7 · budget 40.

#### T-1 · `capture-live` Mac harness (Continuity Camera) ⌨
- **goal:** frames from the owner's iPhone into the core, timestamped at every stage, with the proxy's limits recorded.
- **entry:** T-0; the owner's iPhone paired as Continuity Camera (iOS 16+, macOS 13+).
- **do:** a SwiftPM CLI in `helpers/capture-live/` that opens the Continuity Camera `AVCaptureDevice`, prints every supported format (resolution, fps), streams frames at the chosen format as JPEG or raw buffers over a local socket with capture timestamps; `alwaysDiscardsLateVideoFrames` on; a TS wrapper with `os_signpost`-style stage timestamps; a "record" mode that writes a clip plus timestamps for replay. **Writes no frames to disk outside record mode (INV-22).**
- **exit:** the runtime format list is committed to `docs/live/continuity-camera-formats.md` (it is expected to top out at 1080p; record what it actually says); a 20-second recorded clip replays through the core with identical events; per-stage timestamp histogram in `evals/live-A/`.
- **tier:** T2 Sonnet · S · Low · ⌨ (phone on the Mac) · feeds G-SURF · budget 40.

#### T-2 · Tracker and debounce
- **goal:** spines keep identity across frames while the camera pans; a track becomes `stable` before anything expensive runs.
- **entry:** T-0, P-2 or P-4 (a detector that emits OBB), T-1 (a recorded clip, or a proxy video of library shelves).
- **do:** run Ultralytics `track` with an OBB model and BoT-SORT with `gmc_method` on; read the Ultralytics code to confirm whether OBB association is rotated-aware and record the finding; add a thin-box association cost (centre distance normalised by box height plus an angle term, or Gaussian-box distance) as a second arm; debounce: a track is `stable` after N frames (N a parameter) and emits `TrackWindow`s; cancel work when a track is lost. Ledger writes per lifecycle edge and per window, never per frame.
- **exit:** on the recorded clip, ID switches and fragmentation per arm in `evals/live-A/tracker.json`; the stable-track count; a test that no per-frame event is written.
- **tier:** T2 Sonnet · M · Low · feeds T-3, T-4, V-5 · budget 60.

#### T-3 · Best-frame selection and OCR fusion
- **goal:** one good reading per track per condition, from many frames.
- **entry:** T-2; P-1 (`ocr-vision`).
- **do:** score frames per track (variance of Laplacian, exposure, glare, apparent spine size and angle); keep best-k; run Vision `.fast` on each stable track's best frame and `.accurate` on the best-k set, both as tagged variants; fuse readings by confidence-weighted string alignment (ROVER-like); collapse readings with the same `condition` into one `OcrReading` (INV-20); emit a `needs-pixels` work item when the fused reading is below a size or confidence floor.
- **exit:** on the recorded clip, CER of fast-single, accurate-single and fused readings against the owner's labels (or proxy labels), in `evals/live-A/ocr-fusion.json`; the INV-20 test from T-0 passes against real readings.
- **tier:** T2 Sonnet · M · Low · feeds E-6, G-P (OCR live arm) · budget 60.

#### T-4 · Streaming identify and cards
- **goal:** lookups and cards while the stream runs; the adjudicator never blocks the loop.
- **entry:** T-3; C-3; I-3 (bands); I-4 if merged, else a stub.
- **do:** one lookup per distinct fused reading; candidate sets with `unknown`; cards proposed from cheap-pass evidence and ranked by R-2's features (or a stub ranking before R-2); adjudication only for stable, ambiguous tracks, debounced, cached by (crop hash, candidate-set hash, model), capped per session with `paused` on the cap (INV-2), queued for Batch-API re-adjudication at session end; `CardRevised` with was/now/why (INV-21); all through one writer actor batching events per transaction in WAL mode.
- **exit:** on the recorded clip, a card timeline in `evals/live-A/cards.json` with revision count and RBO between successive lists; `replay` byte-identical; tests for the cap, the cache and the revision diff.
- **tier:** T2 Sonnet · M · Medium (paid calls under the ceiling) · feeds T-5, E-6 · budget 60.

#### U-1 · Live overlay UX research (forked design sessions) ⌨
- **goal:** a calm overlay: the top-k, minimal, filterable design OC30 asks for, specified tightly enough that T-5 and T-7a implement it rather than invent it.
- **entry:** none to start (it can run before GO); T-0's vocabulary when merged. The owner forks it into dedicated design sessions (Claude Design, GPT Canvas) from `~/selfco/prompts/bookcase-discovery-live-overlay-ux-handoff.md`; GPT output returns via `raw/inbox/` as usual.
- **do:** explore 2–3 overlay directions on real shelf geometry (thin rotated spines, 20–60 per shelf); define the lens set and the default; propose k per lens; define label states (box only → label → highlighted) and what a tap reveals (alternatives, band, why); propose hysteresis parameters (margin, dwell, card-batch interval) as ranges for O-7; the "closer look" affordance; colour-blind and Reduce Motion treatment; one mockup per direction and a recommendation.
- **exit:** `docs/live/overlay-ux.md` with the chosen direction, the lens set, k, label states and proposed INV-24 parameters, plus mockups as private links; the owner rules the direction (a one-line decision in the doc). T-5 and T-7a cite it.
- **tier:** design session (owner-launched) · S · Low · feeds T-5, T-7a, O-7 · no PR from the session itself; the conductor lands the doc.
- **state (2026-11-02): closed.** The design landed in `docs/live/overlay-ux.md`, and the owner ruled all of §9 (see §10 there). T-5 and T-7a turn §8 into tests.

#### T-5 · Mac live overlay and card panel
- **goal:** see it work on the Mac: labels that stick, cards that revise visibly.
- **entry:** T-4; U-1 (or OC30's defaults if U-1 has not ruled).
- **do:** a local web view (or a small Swift window) fed by the core's event stream: frame preview with per-track boxes and labels smoothed per track in screen space, one label per spine, top-k highlight under a lens toggle and INV-24 hysteresis per `docs/live/overlay-ux.md`; a card panel with `revised` badges, the was/now/why line and undo; a "closer look" button that marks a track `needs-pixels`; Reduce Motion honoured.
- **exit:** a screen recording of a recorded clip run is attached to the PR as a private link, not a file; labels persist through a lost detection for the configured grace; every revision shows its badge; a test that a flapping identity below the INV-24 margin never changes the shown label.
- **tier:** T2 Sonnet · S · Low · feeds G-SURF demo · budget 40.

#### T-6 · Core ML export, Swift OBB decode and on-device benchmark ⌨
- **goal:** the fixture-trained detector runs on the owner's iPhone, and we know how fast.
- **entry:** F-2 (an owner-trained OBB model; or P-2's proxy weights if F-2 is late); checklist #0c; G-LIC ruled or the weights stay local.
- **do:** export with `yolo export format=coreml imgsz=640 quantize=16` (and `quantize=8` as a second arm); a Swift package `OBBDecode` that decodes raw OBB outputs and runs rotated NMS (Core ML's embedded NMS does not cover OBB); a benchmark app target that runs the model with `.cpuAndNeuralEngine` on 200 frames of a recorded clip and reports per-frame latency distribution and the Xcode performance report; test nano and small sizes.
- **exit:** `evals/live-B/coreml-bench.json` with p50/p95 per size and quantization on the named iPhone and iOS version; the decode package has tests against the Python decoder's output on the same frames.
- **tier:** T2 Sonnet · M · Low · ⌨ (install on the phone) · feeds G-SURF, T-7a · budget 60.

#### U-2 · Guided sweep UX (forked design session) ⌨
- **goal:** the guided sweep mode (OC31) designed as well as U-1 designed the overlay.
- **entry:** U-1's direction (A "Slabs"). Brief: `~/selfco/prompts/bookcase-discovery-guided-sweep-ux-handoff.md`.
- **do:** the framing guide; pace cues and their thresholds as proposals; the hold-to-record gesture; the thinking overlay; the scrub-back replay (labels, cards and closer-look marks along the pan); how sweep and live modes switch; accessibility.
- **exit:** a section added to `docs/live/overlay-ux.md`, with mockups by private link; an owner ruling.
- **tier:** design session (owner-launched) · S · Low · feeds T-9.
- **state (2026-11-02):** design delivered and landed as `docs/live/guided-sweep-ux.md`: direction B "Ribbon", 37 acceptance checks. **Waiting on the owner's ruling on its §10** (12 questions).

#### U-3 · Chat layer UX: clarify-by-tap and taste tree (forked design session) ⌨
- **goal:** design the two chat experiments the owner chose (U-1 §9 Q8). In **002**, the agent asks and you tap: when identity is unsure, the app letters 2–3 spines A/B/C and asks which one you meant. In **006**, a conversation builds a branching map of your taste (themes → sub-themes → books) and exports it as a file other agents can read.
- **entry:** U-1 ruled; R-0's vocabulary when available (006 uses it). Brief: `~/selfco/prompts/bookcase-discovery-chat-layer-ux-handoff.md`.
- **do:** flows, mockups and states for both; how 002 feeds the evidence bands (a user tap counts as `ASSERTED` evidence and is never shown as a revision against the user); how 006 writes **pending** profile entries for owner review (Q7); the export format, as a proposal.
- **exit:** a section in `docs/live/overlay-ux.md` (002) and in `docs/recommend/taste-model.md` (006), with mockups by private link; an owner ruling.
- **tier:** design session (owner-launched) · S · Low · feeds T-4, T-7b, R-0, R-3.
- **state (2026-11-02):** design delivered. 002 landed as `docs/live/chat-002-ux.md` (35 checks, 7 open questions); 006 as `docs/recommend/taste-tree-ux.md` (23 checks, 8 open questions, sample `taste-tree.md` export). **Waiting on the owner's ruling.** R-0 should adopt or replace 006's provisional node kinds.

#### T-9 · Guided sweep mode ⌨
- **goal:** hold, pan, release, then get results and a scrub-back replay, on the phone.
- **entry:** T-7a (capture, detector, tracker on device); T-4 (cards); U-2.
- **do:**
  - Hold-to-record capture with a framing guide.
  - Pace cues from CoreMotion angular velocity plus a per-frame blur score, with thresholds per U-2.
  - On release: a thinking overlay while the clip runs through the track, fuse and identify path, on device or via the Mac core.
  - A scrub-back replay over sparse keyframes with labels and cards.
  - **The video is discarded once processed (INV-22 as amended)**; keyframes go through the face check; on-device only.
  - The sweep's tracks and crops land in the ledger as flywheel data (F-1).
- **exit:**
  - On the `sf-store-001` shelves, a held sweep returns results.
  - `evals/live-B/sweep.json`: time to result, recognition coverage per shelf (OC32), the share of frames the pace cue flagged, and the recall of cue-compliant vs non-compliant passes.
  - A test that no video file remains after processing.
- **tier:** T2 Sonnet · M · Low · ⌨ · feeds E-6, G-LIVE · budget 60.

#### T-8 · FTS5 on iOS probe ⌨
- **goal:** know whether the catalog index can live on the phone.
- **entry:** C-3 (the catalog DB); checklist #0c.
- **do:** a tiny iOS app target that opens the ISFDB SQLite file from the app container, prints `sqlite_version()` and `sqlite3_compileoption_used('ENABLE_FTS5')`, runs the C-3 golden queries through the trigram index, and times them; if FTS5 or trigram is missing, build and measure the bundled-SQLite fallback (GRDB with a custom build, or SQLite.swift).
- **exit:** `docs/live/fts5-ios.md` with the version, compile options, query timings and the decision: on-device lookup, or lookup over the local link to the Mac core for the spike.
- **tier:** T2 Sonnet · S · Low · ⌨ · feeds T-7b, G-V2 packet · budget 35.

#### T-7a · `apps/live-ios` capture, detect, track, overlay ⌨
- **goal:** boxes and labels that stick, on the phone, at 4K30.
- **entry:** G-SURF; T-6; T-2 (tracker design); U-1; T-0 schemas (Swift Codable from the JSON Schemas, OC13).
- **do:** a minimal SwiftUI app with no product UI: `AVCaptureSession` at 4K30 with `alwaysDiscardsLateVideoFrames`, Core ML detector via `OBBDecode`, a Swift port of the stable-track logic (with `VNTrackRectangleRequest` as a comparison arm), screen-space labels smoothed per track with the U-1 lens toggle, top-k highlight and INV-24 hysteresis, the HIG grace on lost detections, Reduce Motion honoured, and an on-demand 48 MP still through `AVCapturePhotoOutput.maxPhotoDimensions` when a track is marked `needs-pixels` (record whether the still can be taken while the stream runs); events written to a local SQLite ledger with the T-0 schemas and exported to the Mac; **no frame written to disk (INV-22)**; `NSCameraUsageDescription` and a privacy manifest in place.
- **exit:** runs on the owner's phone against the `sf-store-001` shelves or a printed proxy; `evals/live-B/overlay.json` from a recorded clip replayed through the same code path: per-stage latencies, time to first annotation, ID switches, label change rate; the 48 MP-while-streaming finding in `docs/live/closer-look.md`.
- **tier:** T2 Sonnet · M · Low · ⌨ · feeds T-7b, E-6 · budget 70.

#### T-7b · `apps/live-ios` OCR, lookup and cards ⌨
- **goal:** text labels and revising cards on the phone.
- **entry:** T-7a; T-8 (on-device lookup or the local link); T-4 (card semantics); R-1 seeds.
- **do:** Vision `.fast` on stable tracks and `.accurate` on best frames (T-3 rules in Swift); fusion and INV-20 collapsing; lookup on-device or over the link; cards with revision badges, was/now/why and undo (INV-21); adjudication requests sent to the Mac core only (the phone holds no API key); session cap honoured.
- **exit:** on the video fixtures replayed through the device path, `evals/live-B/cards.json` (time to first useful card, revision rate, RBO) and `ocr.json` (CER of fast, accurate, fused); the live demo for G-LIVE.
- **tier:** T2 Sonnet · M · Medium (paid calls via the Mac) · ⌨ · feeds E-6, G-LIVE · budget 70.

#### V-5 · Video fixtures and the live scorer
- **goal:** the sweep clips become labelled fixtures, and the stream has a scorer.
- **entry:** O-6 clips ingested by K-3 (hashes, no audio track); C-3; V-2.
- **do:** CVAT via `uv`/Docker for keyframe labels with rotated boxes and track ids, interpolated between keyframes; a converter to the label schema; ~~the owner labels sparse keyframes (budget: about 1 hour per 3 clips, an estimate)~~ **OC36: keyframes are machine-labelled with F-0's stack and scored with the yardstick and optional V-6 taps; the owner labels nothing;** the scorer: time to first annotation and first useful card, window-based live recall vs still recall on the same shelf, HOTA/IDF1/ID switches via TrackEval, label change rate, anchor jitter (px, against interpolated ground truth), revision rate and RBO, glass-to-glass from a timecode-screen recording method, all as distributions; a `bookcase score --live` command.
- **exit:** labels for ≥3 clips resolved to catalog IDs where readable; `pnpm test` on the scorer with a synthetic clip; `docs/live/metrics.md` defines every metric with its source or marks it a project definition.
- **tier:** T2 Sonnet · M · Low · ⌨ (≈1–3 h labelling) · feeds E-6, G-LIVE · budget 60.

#### O-6 · Owner records sweep clips ⌨
- **goal:** video fixtures of `sf-store-001`. Protocol in checklist #8; no audio; people out of frame.
- **exit:** clips in the same export as the stills; the owner reports the count.

#### E-6 · Live vs still, on the same shelf — *J*
- **goal:** the live experience's numbers against the batch numbers, and the "pixels on demand" question.
- **entry:** T-7b; V-5; E-1–E-3 records.
- **do:** on the video fixtures: live recall (window-based) vs still recall per shelf, paired; CER of fused live OCR vs the batch's accurate-on-48 MP; how often `needs-pixels` fires and whether the 48 MP still resolves those spines; time to first annotation and first useful card; the tracker arms; spend per session. Write-up names what the Mac stage predicted correctly and what it missed.
- **exit:** `evals/E6/` run record and `docs/gates/G-LIVE.md` packet with the owner's targets filled in from O-7 and each metric marked met or missed with the number.
- **tier:** T2-J Opus · M · Medium (paid) · feeds **G-LIVE**, G-V2 packet · budget 50.

#### O-7 · Owner sets the live targets ⌨
- **goal:** the numbers G-LIVE is judged by (checklist #16). Before E-6 is written up, so the bar is not fitted to the result.
- **exit:** `docs/gates/G-LIVE.md` holds the targets and the percentile, dated, before `evals/E6/` exists.

### S10 — Flywheel (gap cycle; OC27)

#### F-0 · Machine labelling (OC34, amended by OC36)
- **goal:** every fixture is labelled by open models with no owner time, and scored against a yardstick the stack didn't produce (OC36).
- **entry:** K-3 (fixture ingested); H-0 (labelling stack and yardstick chosen, downloads approved); P-1 (`ocr-vision`); C-3 (catalog index).
- **pilot first (owner, 2026-11-02):** before `sf-store-001` exists, F-0 does a dry run on **`pilot-000`**: 31 JPEGs shot 2026-10-31, now at `~/Desktop/BDAssets/`. K-3 ingests them into `$BOOKCASE_DATA` like any fixture: private, hashed, never committed. They are edited JPEG exports, mostly ultra-wide shots of angled whole cases across SF, film, software and computing sections. It is **real-use data, the primary distribution (OC35)**, not a dry run to throw away. There is no audit slice (OC36). All of it is machine-labelled; catalog-confirmed labels become F-2 training data; optional V-6 taps score it. Its scores are reported as **real-use**, beside the controlled `sf-store-001` scores, never merged with them.
- **do:**
  - Run the detector on every non-audit shelf.
  - Read each crop with Vision `.accurate`, and with a vision-language model for the hard crops only (the OC10 key; spend capped per run; crops are the only upload).
  - Look up each reading in the catalog.
  - Score agreement per spine: box confidence, OCR vs VLM, catalog match.
  - Find gaps: shelf-band width covered by no box.
  - Accept a label automatically only when the readers agree and ISFDB confirms it (OC36 yardstick 2). Everything else stays `unknown` with its reason; there is no human queue.
  - Run the same pipeline on H-0's yardstick set and score it there (PROXY).
- **exit:** `evals/F0/` (aggregates only in the repo) reports, **on the yardstick (PROXY):** box recall and precision, title and author accuracy, misses by reason; **on `pilot-000` (real use):** catalog-confirmed share, reader agreement, gap share, and V-6 tap accuracy only if taps exist (otherwise labelled machine agreement). Also the spend per spine.
- **tier:** T2-J Opus · M · Medium (paid calls under the ceiling) · feeds V-6, V-3, E-2, E-3, F-2 · budget 60.

#### H-0 · Open-weight models and the public yardstick (OC36) — *J*
- **goal:** label spines by composing existing open models, scored against a yardstick the stack didn't produce.
- **entry:** none (research); `docs/licences.md` (C-0).
- **do:**
  - Survey Hugging Face (and GitHub, Roboflow, papers) for **spine boxes**: SAM 3 prompted with "book spine", oriented-box detectors, Grounding DINO or OWLv2 plus a segmenter; and for **spine reading**: Florence-2 OCR-with-region, Qwen2.5-VL grounded OCR, others. For each, fetch and quote: licence (AGPL-compatible?), whether the weights are gated, size, and whether it runs on Apple silicon (MPS or Core ML).
  - Survey **labelled public book-spine or shelf datasets** (boxes and/or titles): licence, label type, size, capture conditions. Start from C-0's rows (Roboflow `open-shelves` CC BY-NC-SA 4.0; IEEE DataPort subscription-only). Recommend one as the yardstick: local only, never committed, never trained on.
  - Run nothing heavy. List every download the owner must approve, with sizes.
- **exit:** `docs/models/open-weights.md` with sourced tables, a recommended labelling stack, a recommended yardstick and the download list; owner approves the downloads (a checklist #5 addendum).
- **tier:** T2-J Opus · S · Low · feeds F-0, P-2, G-P, E-2, E-3 · budget 40.

#### V-6 · Yes/no tap check (optional; OC36) ⌨
- **goal:** an honest real-use accuracy number for the cost of a few taps.
- **entry:** F-0 has machine labels on `pilot-000`.
- **do:** `bookcase taps --session <id>` serves a phone-friendly page (127.0.0.1 by default; the LAN only with an explicit flag). It shows one random spine crop at a time with the machine's title and author: **yes / no / skip / not a book**. A whole-shelf view lets a tap on an unboxed spine record a miss. No typing, no drawing. It shows a running count, says thanks after 50, and can be closed any time. Answers append to `$BOOKCASE_DATA/private/taps/` as `user-asserted` events; only aggregates go to `evals/`.
- **exit:** `pnpm test` (seeded, uniform sampling; one answer is one event; the aggregate has no per-spine rows); the owner can answer 10 spines on a phone.
- **tier:** T2 Sonnet · S · Low · ⌨ optional · feeds E-2, E-3, G-P, F-0 · budget 40.

#### F-1 · Dataset manifest, grouped splits, near-duplicate flags
- **goal:** every shoot lands in one content-addressed store with a split no model can leak across.
- **entry:** K-3 (fixture manifest); V-2.
- **do:** `$BOOKCASE_DATA/datasets/` with a manifest per dataset version (path, sha256, size, session, store id, bookcase id, shelf, setting, split); groups = store > bookcase > session; `GroupShuffleSplit`-style assignment with frozen held-out groups (`sf-store-002` reserved); perceptual-hash flags for near-duplicates across groups (`imagehash`); the public repo holds only the manifest schema and counts.
- **exit:** `bookcase dataset build` produces a manifest from the fixture; a test proves no group straddles splits; the Z-1 guard rejects image, video and weight files under `datasets/`.
- **tier:** T2 Sonnet · S · Low · feeds F-2, F-4 · budget 40.

#### F-2 · Training pipeline on MPS and the registry (heavy compute)
- **goal:** an owner-trained OBB detector that knows bookstore spines, recorded so it can be judged and, later, released.
- **entry:** F-0 labels that passed the catalog-agreement bar (never the yardstick set; OC36); F-1; P-2 (the recipe); **G-LIC ruled** if the weights may ever leave `$BOOKCASE_DATA`; a heavy-compute slot.
- **do:** fine-tune YOLO-OBB nano and small on the fixture's train split with a fixed seed on MPS (`device=mps`; note the PyTorch float64 limit); evaluate on the held-out groups and on the PROXY set; write `models/registry/<id>.json` (weights sha256, manifest hash, base weights, Ultralytics and torch versions, commit, metrics, licence) and a model-card stub from the Hugging Face template; weights stay under `$BOOKCASE_DATA/models/`.
- **exit:** registry record committed; `evals/F2/` with held-out mAP-OBB and recall per size; the record names the licence path from G-LIC.
- **tier:** T2 Sonnet · M · Low · feeds T-6, E-2 (as an arm, if timing allows), F-4 · budget 60.

#### F-3 · Prefill from the trained detector (fixtures after the first)
- **goal:** later shoots are prefilled by the fixture-trained detector instead of the proxy one, so each shoot needs less review than the last.
- **entry:** F-2; F-0's ML backend; a second fixture exists (OC36: scored by the yardstick and optional taps, no audit slice).
- **OC36 (2026-11-02):** there is no human labelling tool; F-3 feeds the registered detector's boxes into F-0's machine pipeline instead of a Label Studio backend. The text below is kept for history.
- **do:** a Label Studio ML backend that serves the registered detector's boxes as pre-annotations; an own exporter from Label Studio JSON to the label schema and YOLO-OBB (the converter has no OBB export); never prefills an audit slice (OC34).
- **exit:** prefill appears in the owner's trial on a second-fixture photo; export round-trips; the time saved is recorded as an estimate.
- **tier:** T2 Sonnet · S · Low · feeds later shoots · budget 35.

#### F-4 · Held-out harness over stills and clips
- **goal:** every registered model is scored the same way, on stills and on clips.
- **entry:** F-2; V-2; V-5.
- **do:** `bookcase eval --model <registry id>` runs the still scorer and the live scorer on the frozen held-out groups and writes `evals/models/<id>/`; a table in `docs/models.md` regenerated from the registry.
- **exit:** the harness runs on the F-2 model and the P-2 proxy model; the table shows both, labelled dev-set or held-out.
- **tier:** T2 Sonnet · S · Low · feeds G-W packet · budget 35.

**Card count:**

| Kind | Count |
|---|---|
| Dispatched cards, each ending in a PR (including Z-1, the privacy guard, and Z-2, fleet registration) | 39 unconditional (batch, incl. C-R and R-0) + 17 live and flywheel (T-0–T-5, T-6, T-7a, T-7b, T-8, T-9, V-5, E-6, F-1–F-4) + F-0 + H-0 + V-6 (OC36) = **59** |
| Conditional or optional dispatched cards (P-3 challenger, V-4 autocomplete; V-1b withdrawn by OC36) | 2 |
| Owner cards (O-1, O-2, O-4 to O-7; O-3a and O-3b withdrawn by OC36) | 6 |
| Owner-launched design cards (U-1, U-2, U-3, forked design sessions) | 3 |
| Conductor bootstrap (Z-0) | 1 |
| **Total** | **71 on the plan; 69 in the expected path** (69 / 66 before OC36; 67 / 64 after U-3; 66 / 63 after OC33; 65 / 62 after OC31–32; 62 / 59 after OC30; 61 / 58 after the gap cycle; 43 / 40 before it) |

Plus **11 MVP gates** (the 8 before, plus G-SURF, G-LIVE, G-LIC) and **3 post-MVP gates** (G-PUB, G-V2, G-W). The Opus draft had 44; the Fable pass removed C-2 and made V-1b and P-3 conditional (OC20, OC21, OC23); the gap cycle added S9 and S10 (OC24–OC29).

---

## 4. Parallelism map and critical path

```
Conductor : Z-0 ─► Z-1 ─► waves ───────────── packets: G-P, G-E1, G-M1, G-R, G-E4, G-E5, G-MVP ─► merges throughout
Core      : L-1 ─► L-2 ─► P-4 ─► I-1 ─► I-2(J) ─► I-3 ─►[G-R]─► I-4 ─► I-5 ─► R-3 ─┐
Fleet     : Z-2 (after checklist #13; off the critical path)
Tools     : L-1 ─► K-1 ;  V-1a (─► V-1b if "build") ─► V-2 ;  L-1 ─► W-1 ;  K-0   W-2 ─┤
Catalog   : C-0 ; C-1 ─► C-3 ─► R-1 ─► O-4 ─► R-2 (needs I-3) ────────────────────────┤
            C-3 ─► V-4 (optional, only if before O-3)                               │
Perception: P-1 ∥ P-2 ─► P-4 ; P-3 only if E-2 triggers it                          │
Owner     : O-1 ─► K-2 ─► O-2 (may precede GO) ─► K-2' ─► K-3 ─► F-0 ─► V-3 ─► E-1 ∥ E-2 ∥ E-3 ─► [G-P][G-E1][G-M1]
                                                         └─────► E-4(J) ─► [G-E4] ; E-5 ─► [G-E5]
                                                                       └─► M-1 ─► O-5 ─► [G-MVP] ─► D-1, D-2
```

**Dispatch waves** (at most 4 writers at once, at most 1 heavy-compute card at once):

| Wave | Cards | Why this order |
|---|---|---|
| 1 (at GO) | **Z-1, L-1, V-1a, K-0**, plus research **C-R, R-0** | Z-1 is the public-repo guard, so it goes first. L-1 unblocks nearly every build card. V-1a and K-0 are on the owner's critical path. C-R and R-0 need no code or photos, so they run beside the four writers (research only, no slot limit) |
| 2 | L-2, K-1, C-0, P-1 (+ V-1b if V-1a said "build") | As L-1 merges; C-0 is XS |
| 3 | V-2, W-1, C-1, P-2 (heavy) | — |
| 4 | P-4, C-3 | P-3 is not scheduled; E-2 may trigger it later |
| 5 | R-1, V-4 (if O-3 hasn't started), I-1 | — |
| Then | Follow the map | Owner-lane cards are dispatched the moment their owner signal arrives; they jump the queue |
| Live track (gap cycle) | T-0 joins wave 2 (after L-1); T-1 and T-2 wave 3 (T-1 needs the phone on the Mac); T-3, T-4, F-1 wave 4; T-5 wave 5; **F-2 after F-0 and G-LIC** (heavy); T-6 and T-8 after F-2; **[G-SURF]**; then T-7a → T-7b; V-5 as soon as O-6 clips are ingested; E-6 last | Stage A needs no photos and runs beside the batch waves. Stage B waits for a fixture-trained detector. At most one heavy card at a time still holds: F-2 shares the slot with P-2 and P-3 |

**Critical path** — 14 steps, owner-bound:

`O-1 → K-2 → O-2 → K-3 → H-0 → F-0 → V-3 → E-2 ∥ E-3 → G-P → E-4 → G-E4 → M-1 → O-5 → G-MVP → D-1`

*(OC34, 2026-11-02: the 3–6-hour O-3 is replaced by an audit slice of under an hour, then F-0's machine labels, then a review measured in time. **E-2 and E-3 report their headline numbers on the audit slice only.**)*

*(OC36, 2026-11-02: no hand labelling. O-3a and O-3b are gone from both paths; H-0 picks the open-model stack and the public yardstick. E-2 and E-3 report on the yardstick (PROXY) and, for real use, on V-6 taps if any, otherwise as machine agreement. The owner holds no labelling step.)*

- **Owner-held steps (OC36):** five of the 14 (O-1, O-2, G-E4, O-5, G-MVP) and no labelling time; V-6 taps are optional and off the path. ~~six of the 14 (O-1, O-2, O-3, G-E4, O-5, G-MVP), plus the labelling's 3–6 hours of hands-on time.~~ **O-1 and O-2 need no repo and no card** (the protocol is in checklist #8), so the first three path steps can be done before GO; with that, the earliest agent-blocked step was O-3 (withdrawn by OC36).
- **Card time on the path:** about 12–15 hours of session time (estimate: XS ≈0.5 h, S ≈1–2 h, M ≈2–4 h, each including the conductor's review).
- **Calendar length** is set by when the owner can do the shoot and the labelling. Realistically 1–2 weeks part-time. This is an estimate, not a measurement (INV-17).
- **The build chain** runs in parallel and joins the critical path at E-4:

  `L-1 → L-2 → P-4 → I-1 → I-2 → I-3 → [G-R] → I-4`

  That is 7 cards, about 2–3 conductor days. So it only becomes critical in two cases:
  - the owner finishes labelling before I-4 merges;
  - **G-R isn't ruled when I-3 merges.**

  That second case is the plan's one schedule risk that agents can't absorb, hence checklist #10's provisional option.

**Live chain (gap cycle) — 17 steps, now the long pole:**

`O-1 → K-2 → O-2 (+O-6 clips) → K-3 → H-0 → F-0 → V-3 → E-2 ∥ E-3 → G-P → F-2 → T-6 → G-SURF → T-7a → T-7b → E-6 → O-7 → G-LIVE → D-1`

- Shares its first eight steps with the batch chain. From G-P it needs a fixture-trained detector (F-2, heavy), the export and benchmark (T-6), the surface gate, the two phone cards, the experiment and the owner's targets.
- **Owner-held steps (OC36):** seven (O-1, O-2 with O-6, G-LIC before F-2 (ruled), G-SURF, O-7, G-LIVE). V-5's keyframe labelling is done by machines, not the owner.
- **Card time on the live chain beyond the batch chain:** F-2, T-6, T-7a, T-7b, E-6 and V-5, about 14–20 hours of session time by the same size estimates (an estimate, not a measurement, INV-17), plus Stage A (T-0 to T-5, about 10–14 hours) which runs off the path.
- Stage A can start in wave 2 and needs no photos; if the owner's shoot is late, Stage A is done long before Stage B can begin, which is the intended order.
- D-1 now waits for both G-MVP and G-LIVE. If G-LIVE is missed, D-1 still writes the batch runbook and the live gate packet records the miss with its numbers.

---

## 5. Conductor runbook (for the Opus session)

1. **Before GO.**
   - Read `REQUIREMENTS.md`, `OPERATING-MODEL.md`, this file and the ADR draft.
   - Ask the owner for checklist #0, #0b and #3–#6 in one message with buttons.
   - Remind them that #1 (Photos), #2 (labelling time) and #8 (the shoot, which needs no repo) start now.
   - Wait.
2. **At GO.**
   - Run Z-0 yourself.
   - Post the GO helpdesk line (`OPERATING-MODEL.md` §9).
   - Dispatch wave 1: **Z-1** (Sonnet), **L-1** (Sonnet), **V-1a** (Sonnet), **K-0** (Haiku).
3. **Dispatching** follows `OPERATING-MODEL.md` §4: the card text verbatim plus the inherited rules, and the model per the card's tier.
4. **Reading a result:**
   - open the PR;
   - run the card's exit check yourself, from a clean checkout of the branch;
   - check the PR against the review checklist (§5 of the operating model);
   - merge, mark the card done, and dispatch whatever it unblocked;
   - **refresh the vault coordination page**: its card-status row and blocked-on-owner list (OPERATING-MODEL §9a).
5. **Owner signals** (O-1 done, shoot done, labels done, profile reviewed) are dispatched immediately; owner-lane cards jump the queue.
6. **Gates.**
   - **G-P:** apply the pre-registered rule and record it; don't ask.
   - **Every other gate:** write the packet, then ask one question with buttons.
   - **G-R:** prepare its packet as soon as the GPT assessment exists (checklist #15, distilled in the vault). The reconciliation page in the vault holds the row-by-row disagreements; the repo's `docs/gates/G-R.md` links it and records the ruling. If the assessment doesn't exist when I-3 merges, ask the owner for the provisional ruling.
   - **After every ruling:** update the vault page's open-gates table and append a `wiki/log.md` entry.
7. **Segment boundaries.**
   - Run the exit gate.
   - Roll up deviations (operating model §8).
   - Post one helpdesk line.
   - Refresh the numbers in the `CURRICULUM-MAP.md` §3 post draft, and tell the owner a draft is ready if this boundary is M1 or MVP.
   - Run the vault lint (OPERATING-MODEL §9a).
   - After Z-0, the repo's `docs/plan/` is **canonical** (OC3). Edit the plan only by PR there. `~/ojfbot/bookcase-discovery-plan/` is frozen at Z-0 and gets a pointer README.
8. **Ask the owner only for:**
   - checklist items;
   - gates;
   - a critical-path card failing twice;
   - spend at 80 % of the ceiling;
   - anything High tier.
9. **Never:**
   - write in `~/selfco` beyond the coordination page, its index line and `wiki/log.md` (no `raw/` edits, no git in the vault);
   - let a card session open `~/selfco`;
   - commit or upload photos, crops, labels, per-spine evals, ChatGPT-derived or SelfCo data, or bypass the Z-1 guard (`--no-verify` is forbidden);
   - attach fixture screenshots to PRs;
   - put tastes, titles or store names in helpdesk posts;
   - spend above the ceiling;
   - post to the Newline community, or contact anyone (owner only);
   - use `npm`/`npx`.

### First conductor session, step by step

| Step | Who | What |
|---|---|---|
| 1 | Conductor | Asks for checklist #0, #0b and #3–#6. Points at #1 and #2. Dispatches K-2 on `pilot-000` as soon as Z-0 lands (OC35) |
| 2 | Owner | Says GO; confirms OCs; approves downloads and installs; starts the Photos unblock |
| 3 | Conductor | Z-0: clone, scaffold, licence, probe, plan copied in; `pnpm test` green; vault page status set to "S0 running" |
| 4 | Conductor | Posts the GO line; dispatches **Z-1**, **L-1**, **V-1a**, **K-0** |
| 5 | Owner | Reports the O-1 result (any time) → conductor dispatches **K-2** at once |
| 6 | Conductor | K-0 merges → sends the protocol link to the owner for the shoot |
| 7 | Conductor | L-1 merges → dispatches L-2, K-1, C-0, P-1 (wave 2) as slots free |

---

## 6. Risks, kill criteria, fallbacks

| Risk | Signal | Response |
|---|---|---|
| Photos still won't reach Yojimbo | O-1 (a) fails | Path (b) AirDrop, then (c) Image Capture. K-2 decides whether the bytes are originals |
| AirDrop delivers derivatives (JPEG, downscaled, edits baked in) | K-2 verdict `derivative` | Use path (a) or (c). Record the finding in `docs/ingest-verification.md`; it answers an open question from the assessment |
| The 10-31 album lacks the E1 settings | K-2 | Expected. O-2 shoot as planned |
| ~~Labelling takes longer than the time budgeted~~ (withdrawn by OC36: no hand labelling) | O-3 past 6 hours | **F-LABEL:** stop at ≥3 complete shelves and ≥100 spines, chosen across the case's height. Log a deviation. All experiments run on that subset, and the report says so |
| The detector doesn't transfer to bookstore shelves | E-2 recall low for both arms | **F-DETECT:** run identify and recommend on the **owner's label boxes** (oracle detection). The MVP's identify and recommend chain still runs end to end, and detection is reported as the known gap with its measured recall. The detector improves post-MVP with the fixture as training data |
| OCR is poor | E-3 CER high | Per G-P, VLM transcription becomes the default if its invented-text rate passes. Otherwise E-1's per-shelf result shows whether more pixels would help |
| ISFDB alone misses too many shelf books | `no-catalog-candidate` share high on the fixture (resolvable labels marked `not-in-catalog` >15 %) | Expected for new releases. Reported as a reason; the share is the trigger for reopening the Open Library import (backlog #4) post-MVP, not an MVP card |
| ~~Label Studio can't handle 48 MP, rotated boxes or the keyboard flow~~ (moot under OC36) | V-1a decision rule fails, or the owner's trial raises a blocker | Dispatch **V-1b** (the custom tool) in wave 2; O-3 waits on it. About one extra conductor day |
| GPT review late | G-R unruled when I-3 merges | Ask the owner for the provisional ruling. If declined, build lanes idle at I-3; S7's R-1 and W-2 work continues |
| Spend | 80 % of the ceiling | Tell the owner. At 100 %, adjudication pauses (INV-2) |
| Ultralytics AGPL | Distribution later | Local spike only. Swapping the backend is a helper change behind the contract (ADR §6) |
| Private data reaches the public repo (a photo, an overlay entry, a path) | Z-1 guard red, or found after a push | Stop dispatch. The conductor tells the owner at once. Rewriting history on a public repo is High tier and is the owner's call. Rotate anything exposed. Log a deviation and add a guard rule for the miss |
| A card fails twice | — | Drop or re-scope it; log a deviation; tell the owner if it's on the critical path |
| The conductor runs out of context | Turn budget | Write `docs/plan/CONDUCTOR-LOG.md`; start a fresh conductor that reads it |
| Continuity Camera formats are even lower than documented, or pairing fails on Yojimbo | T-1 format list | Stage A continues on a recorded clip from the phone (AirDrop a 4K clip); T-1's format list is still the G-SURF evidence |
| The fixture-trained detector is too slow on the Neural Engine at any size that is accurate enough | T-6 p95 above the owner's first-box target for nano and small | **F-LIVE-DET:** run the detector at a lower frame rate (every k-th frame) with the tracker carrying boxes between detections; report the trade-off at G-SURF |
| iOS system SQLite lacks FTS5 or trigram, and a bundled build is heavy | T-8 | Lookup over the local link to the Mac core for the spike; on-device catalog becomes a G-V2 question with the measurement attached |
| The 48 MP still cannot be captured while the 4K stream runs | T-7a | "Closer look" pauses the stream for the still and resumes; record the pause length; it is still the batch pipeline on demand |
| Vision `.fast` cannot read thin rotated spine text | T-3 CER | Use `.accurate` on best-k frames only, debounced further; report the latency cost; the fused reading is what the card uses |
| Live recall far below still recall on the same shelf | E-6 | Expected to some degree. The design answer is "pixels on demand": the `needs-pixels` work item and the 48 MP still. Report the share of spines that needed it |
| Owner never sets targets | O-7 missing when E-6 is ready | E-6 is written with the proposed ranges' upper ends at p95, marked "provisional targets, not the owner's"; G-LIVE waits |
| AGPL ruling blocks weights release the owner wants | G-LIC | Permissive retrain becomes a post-MVP card; the MVP's live loop still runs on AGPL weights locally |

**Kill criteria:** if a segment misses its exit after two re-cards of its blocking card, apply the matching fallback rather than pushing on.

---

## 7. What "MVP done" looks like

- `bookcase ingest|run|report sf-store-001` works from a fresh DB.
- The report shows:
  - every photo with every spine boxed by status and band;
  - per-spine evidence;
  - ranked recommendations with a rationale and click-to-locate;
  - the unresolved queue with reasons;
  - "closer photo" work items.
- `evals/` holds E1–E5 and MVP run records, each with commit and versions. Fixture numbers are labelled dev-set; library-shelf numbers are labelled PROXY.
- `docs/gates/` holds every ruling in the owner's words.
- `implementation-notes.md` holds the deviations, rolled up per segment.
- `pnpm guard --history` is clean: no photo, label, ChatGPT-derived or SelfCo data anywhere in git.
- The vault coordination page shows every card's state and every gate's ruling.
- `CURRICULUM-MAP.md` is current, and the M1 and MVP post drafts are ready for the owner.
- **Live (gap cycle):** the spike app runs on the owner's phone against the fixture shelves with sticky labels and visibly revising cards; `evals/live-A/`, `evals/live-B/`, `evals/E6/` and `evals/models/` hold the run records; `docs/gates/G-SURF.md`, `G-LIC.md` and `G-LIVE.md` hold the rulings with the owner's targets and each metric's number; `models/registry/` holds one owner-trained detector; no frame, clip or weight file is anywhere in git.

## 8. Post-MVP backlog (not carded; ordered by D-1)

1. `sf-store-002`, a held-out fixture, to get honest numbers (OC11).
2. E6: read-only chat tools behind a tunnel, tested on the owner's iPhone and plan.
3. An iOS Shortcut ingest path (verified with K-2's method).
4. The Open Library science-fiction subset import (the Opus draft's C-2, text in `README.md` § Changelog) and live-API verification for `no-catalog-candidate`. Reopen when the fixture's `not-in-catalog` share says ISFDB is not enough.
5. The ChatGPT-export importer into the private profile overlay (OC22): emits `inferred-interest` only, never `read` or `liked`.
6. ~~A detector fine-tuned on the owner's fixtures.~~ **Moved into the MVP as F-2 by the gap cycle** (the live loop needs a detector that knows bookstore spines).
6b. **Live-experience follow-ons** (gap cycle): ARKit world anchors and LiDAR for labels that survive walking around the shelf; active learning once two or more shoots exist; DVC and MLflow when the manifest and registry JSON stop being enough; catalog delivery to the phone (first-run download with disclosed size, or Background Assets); a permissive detector retrain if G-LIC rules against AGPL; TestFlight for community testers (Apple Developer Program, Beta App Review); App Store privacy labels ("Photos or Videos", third-party AI disclosure under 5.1.2(i)).
6c. **Own fine-tuned spine reader** (OC34): once the reviewed labels pass a size the F-0 and F-2 records justify, fine-tune a recognition model (an OCR head or a small vision-language model) on spine crops, and compare it against Vision plus the adjudicator on the audit slices. The licence chain and G-W apply.
7. Cross-photo deduplication.
8. Visual memory from user-confirmed crops.
9. Calibration, once hundreds of labels exist.
10. A SelfCo context adapter for other lenses (ranking only; INV-13).
11. Distribution, behind G-L.
12. **G-PUB:** a curated, redacted photo and label release with a model card.
13. **G-V2:** v2, the native iOS app (Swift plus Python backend helpers). Open questions for its packet (questions, not answers):
    - **Fork shape:** separate repo, v2 branch, or `apps/ios/` (owner: "decide at the v2 gate").
    - **Ingest via PHPicker or limited-library access.** This needs no library grant and removes today's Photos-sync blocker.
    - **Live camera capture.** Does per-shelf framing guidance replace the K-0 protocol sheet?
    - **On-device vs backend inference**, by cost, latency and privacy. Which pieces need CoreML conversion and which stay server-side (ADR §10).
    - **Distribution:** TestFlight, the App Store, and their review and privacy-label demands.
    - **Whether the ChatGPT/MCP surface (E6) still matters** once there is a native UI.
    - **Ledger sync** between device and backend, if the SQLite ledger lives on the phone.
    - **Inherited from S9 (gap cycle), as measurements rather than questions:** the detector size that runs on the Neural Engine at the owner's target (T-6); FTS5 and trigram availability on iOS (T-8); whether the 48 MP still can be taken mid-stream (T-7a); tracker choice and its ID-switch rate (T-2, E-6); 2D screen-space labels vs ARKit anchors (the spike used 2D; ARKit is the v2 question); live vs still recall on one bookcase (E-6).
