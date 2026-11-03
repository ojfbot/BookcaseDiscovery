# Compute fleet: several Macs working one job queue

> **Status:** proposed, 2026-11-03. Owner rulings of the same day are recorded in §2. The cards in §9 are proposals for the conductor to schedule; nothing here changes `docs/plan/`.
> **Reads:** `docs/plan/OPERATING-MODEL.md` (conductor, heavy-compute slot), `docs/machine-labelling.md` and `evals/F0/` (stage costs), `docs/privacy.md` (OC9, INV-19), `docs/capture/coverage.md` (Q track). Fleet side: core's fleet-runner map (`decisions/wayfinder/control-plane-conductor.md`, core #307), its note of 2026-11-03, and the proposed `decisions/fleet-runner/gate-authority-tiers.md` (core PR #575).

## Answer first

- **The work is already job-shaped.** Every expensive stage (detect, three readers, renders, the test suite) runs per photo or per crop batch from content-addressed inputs, and its output can be checked. What's missing is a shared queue, leases, and a job key that includes the model and code version (§4).
- **The first win is scheduling, not a second machine.** Detection on `pilot-000` took 78 s a photo (median) in F-0 with the GPU to itself, and 200–340 s a photo on 2026-11-03 with three card sessions sharing it. That's 3–4× lost to contention. A queue that runs one GPU job per host recovers most of it before the laptop joins.
- **A second Mac roughly halves a night's photo work** (§8). Pilot rereads, a new detector arm, or a 100-photo set go from "one night, maybe" to "one night, comfortably". API-bound work (C-4's lookups) gains nothing, and must not be split across hosts.
- **BookcaseDiscovery doesn't build a platform.** The authority for fleet work is core's fleet-runner (#307), which has no runnable iteration yet. The owner ruled that this workload must not block on it. So this repo builds a **small interim queue** for compute jobs only (cards N-1, N-2), shaped like fleet-runner's P2 command and evidence contract so the move is a transport swap (card N-3). The interim queue dispatches no coding sessions and holds no authority over development work.
- **Night shift runs only admitted, checkable jobs.** Gates, merges and rulings stay in the day shift (§7). The morning report is a query over the job table, not anyone's memory.

## 1. Words

New terms (added to `CONTEXT.md` in this PR): **job**, **job kind**, **job key**, **worker**, **lease**, **fencing token**, **host**, **day shift / night shift**, **morning report**. A *job* is not a *run*: a run is one pipeline execution recorded in the ledger (`RunStarted`); a job is one unit of compute a worker claims. A run can enqueue many jobs.

## 2. Machines, reach and owner rulings (2026-11-03)

| Host | Hardware | Role | Measured or ruled |
|---|---|---|---|
| **Yojimbo** | M4 Pro, 12 cores, 48 GB | Fixed; holds `$BOOKCASE_DATA` and, for now, the interim job table | Always on. Running conductor and card sessions. |
| **Laptop** | M3 Max, 64 GB | Worker, nights and when idle | On the LAN over Wi-Fi (ping ≈ 14 ms). SSH and file sharing currently **off**. It is the owner's only laptop: presence is unreliable, so interruption must be safe by design. |

Owner rulings:

1. **Photos may live on the laptop.** A persistent copy of the working copies is allowed, encrypted at rest (FileVault), moving over the LAN only and **never to a cloud service**. A NAS/NFS share on the LAN is planned and will become the shared content-addressed store.
2. **Laptop availability: nights, plus whenever it is idle.** The worker must back off on user activity, survive sleep, lid-close and Wi-Fi loss, and never assume the host is plugged in or present. If the owner gets another laptop, this one becomes a fixed host like Yojimbo.
3. **Each host provisions itself.** The laptop gets its own Hugging Face login and downloads models itself. No credentials or tokens are copied between hosts. A host joins by running a recipe (uv lockfiles, a models manifest checked by hash), not by being cloned from Yojimbo.
4. **No single interface or machine is the source of truth.** Yojimbo hosts the interim table because it is always on, not because it is the conductor. The table is reached through one interface (§5), so it can move to the NAS or a fleet-runner deployment without the workers changing.

## 3. Inventory of today's work as job kinds

Numbers are from `evals/F0/metrics.json` (F-0, quiet GPU) and F-0e's logs (contended GPU). "Per unit" is per photo for detection, per crop for readers.

| Job kind | Bound | Peak memory | Per unit | `pilot-000` total (31 photos, 6,894 crops) | Inputs | Output | Host constraint |
|---|---|---|---|---|---|---|---|
| `detect` (B2: Grounding DINO → SAM 2.1) | GPU (MPS) | ≈ 11 GB RSS, 15 GB MPS | 78 s median (99 s max); 200–340 s contended | 37 min | working copy (≈ 10 MB JPEG), arm, tiling | `Detection` record | MPS; one per host |
| `detect` (B1: SAM 3) | GPU | ≈ 12 GB RSS, **37 GB MPS** | ≈ 11 s / yardstick image | not run on pilot | same | same | Needs headroom: comfortable on 64 GB, tight on 48 GB |
| `read-vision` (Apple Vision, P-1) | ANE/GPU, light | small | 0.13 s | 14 min | working copy + polygon | `Reading` | macOS (both hosts qualify) |
| `read-ppocr` (PP-OCRv5) | **CPU** | ≈ 1–2 GB per worker | 1.0 s (2.6 s on B2 yardstick) | 8,277 CPU-s ≈ 46 min with 3 workers | working copy + polygon | `Reading` | any; parallel by core count |
| `read-qwen` (Qwen3-VL 4B, MLX) | GPU | ≈ 5 GB weights | 1.5–2.5 s | 33 min on the 1,240 hard crops | working copy + polygon | `Reading` | MLX on Apple silicon |
| `render` (Q-1/Q-2/F-0e private pages) | CPU | small | seconds per photo | minutes | caches + working copies | private HTML | any |
| `test-suite` (`pnpm test`) | CPU | small | 72 s quiet | — | a commit | pass/fail + log | any; ingest tests time out under load |
| `catalog-lookup` (C-4) | **network rate** | small | ≤ 1 req/s (Open Library), ≤ 10/min (LoC) | ≈ 1 h for 235 boxes | reader text | cached responses | **one host only**: limits are per client and IP |

Findings that shape the design:

- **Today's cache key is incomplete.** Each stage keeps a JSON Lines file per run directory and skips ids already present (`src/eval/f0.ts`). The key is the image (or spine) id within that directory. The model id, code version and parameters (arm, tiling, rotations) are implied by the directory, not recorded in the key. A shared queue needs them in the key, or a rerun after a model change silently reuses old output.
- **Readers cut their own crops** from the working copy plus a polygon (`helpers/label/read.py`). So a reader job's inputs are the working copy's hash plus the polygon, and photos must be present on the worker. That's allowed by ruling 1. Sending crops only remains an option, for hosts that may not hold photos.
- **Everything is a Mac today.** Apple Vision and MLX need Apple silicon, so both hosts qualify for every kind. A Linux worker could take `read-ppocr`, `render` and `test-suite` only.

## 4. Job key and outputs

- **Job key** = SHA-256 over the canonical JSON of `{kind, inputs: [content hashes], params, model: {id, revision}, code: {commit, helper version}}`. Same key means same work, so enqueueing twice is a no-op and a finished key is a cache hit.
- **Outputs are content-addressed and written atomically**: written to a temporary file, then renamed into place by hash. A worker that crashes mid-write leaves nothing a reader could mistake for a result.
- **The job table holds keys, states, hashes and error codes only.** No OCR text, titles or image content. It is private either way (it names photo hashes), and lives under `$BOOKCASE_DATA/jobs/`.

## 5. The interim queue (N-1, N-2)

Smallest design that is correct under interruption, with the parts fleet-runner's P2 contract also needs.

- **State:** one SQLite file (`node:sqlite`, as the ledger uses) on the host that holds the data. Tables: `jobs` (current state) and `job_events` (append-only: enqueued, claimed, heartbeat-lost, completed, rejected-stale, failed, lease-expired, released). SQLite is never opened over a network share: its locking is unreliable there.
- **Claim:** in one immediate transaction, sweep expired leases, then take the highest-priority `ready` job whose required capabilities the worker has. Mark it `claimed` with the worker id, a lease expiry, and a **fencing token** (a per-job counter incremented on every claim).
- **Heartbeat:** extends the lease only if the token still matches. A `false` reply means the worker has lost the job and must stop.
- **Complete:** accepted only if the job is still `claimed` under the same token. A worker that slept past its lease and wakes up gets its result **rejected as stale**, so it can never overwrite a newer attempt. The rejection is recorded.
- **Fail:** retryable errors go back to `ready` until `max_attempts`, then `failed`, with an error code. Interruption (SIGTERM, user activity) **releases** the job explicitly; sleep or a lost network just lets the lease expire.
- **Capacity:** one worker process runs one job at a time. A host runs one GPU worker plus N CPU workers. This replaces OPERATING-MODEL's "one heavy-compute card at a time" convention with an enforced limit per host.
- **Remote workers (N-2):** the laptop reaches the table **through the same CLI over SSH** (`ssh <host> bookcase jobs claim --json …`), authenticated by an SSH key the owner installs. Inputs and outputs move by `rsync` over SSH, by content hash. No new network service, no open port beyond SSH, and no cloud. When the NAS arrives, files move there. When fleet-runner can host compute jobs, the transport becomes its API (N-3); job kinds, keys and handlers stay.

## 6. Privacy (OC9, INV-19)

| Data | Where it may be | Never |
|---|---|---|
| Originals and working copies | Yojimbo; the laptop (FileVault, ruling 1); the NAS when it exists | Any cloud service, the repo, PRs, logs |
| Crops, reader text, caches, renders | Same as above, under `$BOOKCASE_DATA` | Same |
| Job table and job events | Under `$BOOKCASE_DATA/jobs/` | The repo: it names photo hashes |
| Aggregates (counts, timings, shares) | `evals/`, PRs, the morning report summary | Per-photo rows |

The worker logs job keys, kinds, durations and error codes only. A job's payload may name a private path. The Z-1 guard keeps such paths out of the repo, and the CLI never prints payloads.

## 7. Shift policy

| Night shift (unattended, admitted jobs only) | Day shift (owner present) |
|---|---|
| Pre-registered evaluation arms whose go rule is already written (Q-2 rerun after F-0e) | Gates, merges, owner rulings, plan amendments |
| Rereads after a model change; a new detector arm on the yardstick and `pilot-000` | Choosing what enters tonight's queue (admission) |
| Detection and reading for a new photo set | Reviewing private renders |
| The full test suite on a quiet host, at a recorded commit | Anything that needs judgment or crosses the privacy boundary |
| Renders for review in the morning | Paid API calls (checklist #7) |

**Admission** is the day-shift act that puts a job plan into the queue. A plan is admissible at night only if every job has a deterministic success check (output hash, schema, a pre-registered rule) and no job has an effect outside the owner's machines. In the proposed fleet-runner gate tiers, night jobs are I0–I1, R0, V0–V1: deterministic or machine-decided, never agent- or human-decided overnight.

**Morning report** (`bookcase jobs report --since <time>`): per kind, counts done, failed, stale-rejected and still ready; failures with error codes; machine-hours per host; the oldest waiting job; which outputs are ready for review. Aggregates only, so it can be pasted into the conductor log.

**Conductor fit:** the conductor (or any client) admits job plans and reads the report. Cards consume outputs by job key. The conductor stays the reviewer and merger it is today (OPERATING-MODEL §4). It is not the queue's owner, and the queue keeps working if the conductor session ends.

## 8. Scenarios: what a second Mac buys

Single-host times assume a quiet GPU (F-0's figures). Two-host times assume an even split and the laptop as fast as Yojimbo. Its M3 Max has more GPU cores and the same class of CPU, so this is a hypothesis N-2 measures, not a claim.

| Scenario | One host, quiet | Two hosts | Notes |
|---|---|---|---|
| **Q-2 rerun after F-0e** (pilot reread: detect + 3 readers, then the student fit) | ≈ 2.2 h | ≈ 1.1–1.3 h | The student fit is minutes and stays on one host. The larger saving is avoiding contention, which costs 3–4× today. |
| **U-4 renders** (display modes on `pilot-000`) | minutes | same | Not worth distributing. |
| **Open Library import** (if C-4's rule fires) | ≈ 12 GB download + a streaming filter, I/O-bound | same | Run at night on the data host. Splitting gains nothing. |
| **A model swap** (a new detector arm on 4 yardstick sets + `pilot-000`) | ≈ 4.5–6 h | ≈ 2.5–3 h, or two arms in one night | SAM 3's 37 GB MPS peak fits the 64 GB host with room to spare; run B1 there and another arm on Yojimbo. |
| **A new 100-photo set** | ≈ 7 h | ≈ 3.5–4 h | The difference between "starts late, finishes late morning" and "done by breakfast". |
| **Q-6 live clips** | unmeasured (no clips yet) | ≈ 2× expected | Clip windows are independent. Measure when T-1 clips exist. |
| **C-4-style catalog lookups** | ≈ 1 h | **same: do not split** | Rate limits are per client and IP. Both hosts share one public IP. |
| **Full test suite** | 72 s | same | The gain is reliability: run it on an idle host so ingest tests don't time out. |

## 9. Proposed cards

#### N-1 · Interim job queue and local worker
- **goal:** run cache-keyed compute jobs from one queue on one host, with leases and fencing, so overnight batches and concurrent cards stop fighting over the GPU.
- **entry:** this document merged. A thin spike exists in this PR (`src/run/jobs.ts`, `bookcase jobs`).
- **do:**
  - Job key per §4: model id and revision plus code commit, in every kind.
  - Handlers for `detect`, `read-vision`, `read-ppocr`, `read-qwen`, wrapping the existing helpers without changing them.
  - One GPU worker per host; N CPU workers for PP-OCR.
  - `bookcase jobs report` as the morning report.
- **exit:**
  - a `pilot-000` reread through the queue matches F-0's cached outputs for the same model and code (byte-equal records, or a stated tolerance where a reader is nondeterministic);
  - a killed worker's job is re-run after lease expiry with no duplicate output;
  - a stale worker's completion is rejected and recorded;
  - median detect time per photo with two cards running is within 1.3× of the quiet figure.
- **tier:** T2 Sonnet · M · Low · budget 60. Touches `src/run/`, new handler wrappers; never edits the helpers' internals.

#### N-2 · Second host (the laptop) as a worker
- **goal:** the laptop takes jobs at night and when idle, and leaves without losing work.
- **entry:** N-1 merged. Owner steps (§10): Remote Login, an SSH key, FileVault confirmed on, the laptop's own Hugging Face login.
- **do:**
  - A provisioning recipe: uv sync per helper; a models manifest checked by hash, downloaded by the host itself.
  - SSH transport for claim, heartbeat and complete.
  - rsync by content hash for inputs and outputs.
  - Idle and power policy: claim only when idle for a set time or inside the night window; release on user activity; never claim a GPU job on battery below a threshold the owner sets.
- **exit:**
  - one night where the laptop completes its share of a pilot reread;
  - a lid-close mid-job recovered by lease expiry, with no duplicate output and the stale completion rejected;
  - the measured two-host speed-up for §8's first row recorded in `evals/N2/`.
- **tier:** T2 Sonnet · M · Medium (a second machine, private data over the LAN) · budget 60.

#### N-3 · Move onto fleet-runner
- **goal:** retire the interim queue.
- **entry:** a fleet-runner iteration that can admit and lease a compute job (its P2), and accepts BookcaseDiscovery as a receiving workload (core #307 note, 2026-11-03).
- **do:** swap the transport behind `JobStore` for fleet-runner's interface; carry job kinds, keys, handlers and the morning report; replay one night's job events as the migration check.
- **exit:**
  - the same job plan produces the same outputs through fleet-runner;
  - the interim table is read-only, then removed.
- **tier:** T2 · S · Medium · budget 40. The first available card after fleet-runner is ready.

## 10. Open questions for the owner

1. ~~NAS timing~~. **Ruled 2026-11-03:** Yojimbo is the interim control host for N-1 and N-2, pending the NAS.
2. **Idle and power policy for the laptop:** how many minutes idle before it claims work, the night window, and whether GPU jobs may run on battery at all.
3. **Owner setup steps for N-2:** enable Remote Login on the laptop, authorise one SSH key in each direction between the hosts, confirm FileVault, and log in to Hugging Face on the laptop as the owner's own account. Agents don't do these.
