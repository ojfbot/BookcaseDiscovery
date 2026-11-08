# BookcaseDiscovery fleet worker service

Run one login-scoped service in the normal macOS user session on each worker.
Yojimbo serves the queue and can run its own worker. Use separate `owner`,
`yojimbo`, and `yuri` credentials. Register only each worker's public key on
the queue server. The owner credential is for admission and reports.

## Configure each worker

Select the supported Node runtime in the shell where you run installation.
Install dependencies with `pnpm install --frozen-lockfile` in the pinned
BookcaseDiscovery checkout. Set these variables using local values:

- `BOOKCASE_DATA` points to the absolute path of this worker's private data root.
- `BOOKCASE_OCR_VISION` points to the absolute path of the executable helper.
  All eligible workers use a byte-identical copy of the helper pinned on admission.
- `FLEET_TOKEN_FILE` points to this worker's owner-only private credential file.
- `FLEET_ENDPOINT` is the LAN URL of the Yojimbo queue server.

Stage each input in every eligible worker's local store before admission.
Run `pnpm exec ./bin/bookcase fleet stage "$PHOTO"` on each worker, using that
host's own copy of the input. Claims use capabilities, and each worker resolves
the input by its hash in its own data root.

```sh
# On Yuri, using the Yuri credential and data root.
pnpm exec ./bin/bookcase fleet service install yuri

# On Yojimbo, using the separate Yojimbo worker credential and data root.
pnpm exec ./bin/bookcase fleet service install yojimbo
```

Install records the running Node executable and the current checkout in a
user LaunchAgent. Start and stop work from the same checkout. Reinstall after
stopping if you change the runtime, checkout location, or worker configuration.

## Control the service

```sh
pnpm exec ./bin/bookcase fleet service start
pnpm exec ./bin/bookcase fleet service status
pnpm exec ./bin/bookcase fleet service stop
```

The worker waits for jobs and processes one attempt at a time. Yuri takes new
claims from 20:00 inclusive to 07:00 exclusive America/Chicago while the system
reports external power. An unavailable or unrecognized power state blocks new
claims. A job already in flight can finish. Stop disables future launches and
drains the current attempt. The service runs in a logged-in GUI session.
The existing `fleet work WORKER` command is available for a manual one-shot
run.

Use the owner credential on Yojimbo for `pnpm exec ./bin/bookcase fleet report`.
The report shows queue state and per-worker outcomes. Local service status
reflects launchd state. The service discards stdout and stderr.

## Admit a read-qwen job

`read-qwen` runs Qwen3-VL-4B-Instruct 8-bit (MLX) through
`helpers/label/read.py --reader qwen --prompt spine`, one batch of spines from
one working copy per job, one job at a time per Mac. The handler is
`src/run/read-qwen.ts`. Admission is the coordinator's act; nothing below runs
until the coordinator decides the GPU is free (no other card holds it).

### Pins

Each job carries three pins. A worker checks all three on every attempt and
rejects a mismatch, without retrying, before `read.py` starts.

| Pin | In the job | What is hashed |
|---|---|---|
| Helper | `code`: `read-qwen@sha256:<tree>` | `read.py`, `pyproject.toml`, `uv.lock` and the venv's Python version. The venv must also hold exactly the locked versions. |
| Model | `params.model`: repo, revision, `sha256` | Every non-hidden file in `$BOOKCASE_DATA/models/qwen3-vl-4b-8bit/` (weights, config, tokenizer, templates) |
| Input | `inputs[0]` | The working copy, found by hash in this host's own store |

Pins measured on Yojimbo on 2026-11-04 for this branch (public code and
weights only):

```json
{
  "code": "read-qwen@sha256:b58670ac6c2d23109f54554800cfc6f743662d865662b4693437e047b209f0f0",
  "model": {
    "repo": "mlx-community/Qwen3-VL-4B-Instruct-8bit",
    "revision": "0943db6e15185b86be368d3cf0704aec740b142b",
    "sha256": "57024e04b7e4b455e5b53dc4a83bcec896c26af41b8ad21cc9a20bc113203865"
  },
  "python": "3.12.16",
  "capability": "read-qwen-b58670ac6c2d-57024e04b7e4"
}
```

A worker offers the `read-qwen-…` capability only when it detects these pins
itself, so a job is claimed only by a host that holds the same ones. The
capability is detected once when the worker starts (about 5 s on Yojimbo:
most of it hashes the 5.1 GB of weights).

### Assets per host

- The checkout the service runs from, at this branch's head.
- `helpers/label/.venv` synced from the lockfile:
  `cd helpers/label && UV_OFFLINE=1 uv sync --frozen`. Without cached
  wheels this needs a download, which the owner runs on that host.
  It must use CPython 3.12.16, or the helper pin differs.
- The weights at `$BOOKCASE_DATA/models/qwen3-vl-4b-8bit/`, downloaded by the
  host itself (ruling 3) with `hf download` at revision
  `0943db6e15185b86be368d3cf0704aec740b142b` into that directory.
  `hf download --local-dir` records the revision under `.cache/`; the worker
  reads it there.
- About 5 GB of free GPU memory. Disk: the worker stages a read-only copy of
  the weights under `$BOOKCASE_DATA/fleet/staged/`. On APFS it is a
  copy-on-write clone; elsewhere it takes another 5.1 GB.

### Recipe

1. On each host, print its pins. Both must print the JSON above.

   ```sh
   pnpm exec ./bin/bookcase fleet pins
   ```

   To recheck the model digest without this code:

   ```sh
   cd "$BOOKCASE_DATA/models/qwen3-vl-4b-8bit"
   find . -type f -not -path './.*' | sed 's|^\./||' | LC_ALL=C sort |
     while read -r f; do shasum -a 256 "$f"; done | shasum -a 256
   ```

2. On each host, stage the input from that host's own copy, and note its hash:

   ```sh
   pnpm exec ./bin/bookcase fleet stage "$PHOTO"
   shasum -a 256 "$PHOTO"
   ```

3. Restart each worker service so it detects the capability:
   `fleet service stop`, then `fleet service start`.

4. Write the job spec outside the repo. Values in angle brackets are
   placeholders. Use opaque request ids (`s000`, `s001`, …), never image ids,
   except for Yojimbo's optional cache check below. Polygons are working-copy
   pixels, as for `read-vision`. `crop` is the runner's crop method
   (`cropName`, `src/perceive/crop.ts`); F-0's current method is
   `rect;rot=fixed;clip=frame`, read at 90° and 270°.

   ```json
   {
     "kind": "read-qwen",
     "inputs": ["<sha256 of the working copy>"],
     "params": {
       "requests": [
         { "id": "s000", "polygon": [[10, 20], [60, 20], [60, 900], [10, 900]], "rotations": [90, 270] }
       ],
       "crop": "rect;rot=fixed;clip=frame",
       "prompt": "spine",
       "generation": { "temperature": 0, "maxTokens": 48 },
       "model": {
         "repo": "mlx-community/Qwen3-VL-4B-Instruct-8bit",
         "revision": "0943db6e15185b86be368d3cf0704aec740b142b",
         "sha256": "57024e04b7e4b455e5b53dc4a83bcec896c26af41b8ad21cc9a20bc113203865"
       }
     },
     "model": { "id": "mlx-community/Qwen3-VL-4B-Instruct-8bit", "revision": "0943db6e15185b86be368d3cf0704aec740b142b" },
     "code": "read-qwen@sha256:b58670ac6c2d23109f54554800cfc6f743662d865662b4693437e047b209f0f0",
     "payload": null,
     "requires": ["mlx", "read-qwen-b58670ac6c2d-57024e04b7e4"],
     "maxAttempts": 2
   }
   ```

   `temperature` and `maxTokens` are what `read.py` runs for the spine prompt
   (it takes neither as an argument); any other value is refused. At most 256
   requests and 4 rotations each.

5. On Yojimbo, with the owner credential, admit it. `admit` refuses a spec
   whose pins Yojimbo does not hold itself, and records the job key for
   `verify`:

   ```sh
   pnpm exec ./bin/bookcase fleet admit job.json
   ```

   For one job per Mac, admit two different jobs (different spines or photos,
   so different keys), one at a time. Admit Yojimbo's while Yuri is outside
   its claim window (07:00–20:00 America/Chicago). Admit Yuri's inside the
   window (20:00–07:00, on AC power) with Yojimbo's service stopped. The
   window is enforced by `fleet-worker-policy.ts`; do not use the manual
   `fleet work yuri` to get around it.

### Expected runtime

From the compute-fleet table (F-0, quiet GPU): 1.5–2.5 s per crop. Per job:
about 5 s of pin checks (the weights are hashed again on every attempt), the
model load (unmeasured; *hypothesis*: under a minute), then the crops. A
16-crop pilot job should take 1–2 minutes. The worker kills `read.py` after
180 s plus 30 s per crop rotation and retries once (`maxAttempts` 2).

### Pass check

A job passes when all three hold:

1. **Digest recorded and verified by Yojimbo.** After the job completes, on
   Yojimbo with the owner credential:

   ```sh
   pnpm exec ./bin/bookcase fleet verify <worker>
   ```

   It must print `worker <worker>: 1 completed` and
   `accepted output SHA-256: matches`. The queue server hashes the accepted
   file in its output directory against the digest it recorded at completion.
2. **Contract, one reading per request.** On Yojimbo, check the accepted file
   (`<OUT_DIR>/<key>.<fence>.jsonl`; the key is in
   `$BOOKCASE_DATA/fleet/job-key`):

   ```sh
   pnpm exec ./bin/bookcase fleet check job.json "<OUT_DIR>/<key>.<fence>.jsonl"
   ```

   It must print `contract and order: pass` and `N readings for N requests`.
   Each line is an `ocr-response` record (`contracts/helpers/`), in request
   order, with the requested rotations and the helper pin as
   `version.helper`. A reader error for one spine is a reading, counted
   separately.
3. **No cross-host byte equality required.** The two hosts' outputs are not
   compared. *Hypothesis:* MLX numerics may differ between the M3 Max and
   the M4 Pro, so the same job can read differently on each; `version.os`
   also differs if their macOS versions do.

Optional, on Yojimbo only: equality with F-0's cached Qwen reading of the same
spines. Build the requests from F-0's own spine ids, polygons, rotations and
crop method, then:

```sh
pnpm exec ./bin/bookcase fleet check job.json "<OUT_DIR>/<key>.<fence>.jsonl" "<F-0 run dir>/qwen.jsonl"
```

It prints `cached readings equal: k of N` and passes only when every reading
equals the cached one (rotation, text and confidence; F-0's timing is not
compared). The cache was written by the same `read.py`; whether the venv was
the same then is unrecorded (*hypothesis*).

Every command above prints counts, pins and codes only, never reader text,
paths or ids.

## Isolated NAS profile: automatic read-vision inputs

This additive profile uses `fleet nas ...` commands and the separate
`org.bookcasediscovery.fleet-worker.nas` LaunchAgent. The original pilot service
is unchanged. Use a new private `BOOKCASE_DATA` root and a credential generated
on this host. Keep the helper at its existing byte-identical local build; no
model/helper build or download occurs as part of installation.

Select the supported Node runtime through the host's runtime manager, check out
the exact application PR commit in a dedicated persistent checkout, and run
`pnpm install --frozen-lockfile`. Do not install Node or packages globally.
Configure local values without pasting private configuration into a public log:

```sh
export BOOKCASE_DATA="$NAS_WORKER_DATA"
export BOOKCASE_OCR_VISION="$LOCAL_PINNED_HELPER"
export FLEET_TOKEN_FILE="$NAS_WORKER_KEY"
export FLEET_ENDPOINT="$ISOLATED_NAS_HTTPS_ENDPOINT"
export NODE_EXTRA_CA_CERTS="$LOCAL_NAS_PUBLIC_CERT"
# Generate locally; register only the .pub sibling with the isolated server.
pnpm exec ./bin/bookcase fleet nas keygen
pnpm exec ./bin/bookcase fleet nas service install "$WORKER"
pnpm exec ./bin/bookcase fleet nas service start
pnpm exec ./bin/bookcase fleet nas service status
```

The certificate is public and obtained through the existing trusted NAS SSH
route. TLS validation stays on. The Node executable and checkout are pinned in
the service file. Installation creates a disabled service; start enables it.
It survives closing agent GUIs within the logged-in user session. It is not a
system daemon and does not promise operation before login.

The NAS profile advertises **read-vision only**, plus its actual helper pin and
host capability. A handler still verifies the full helper hash on every attempt.
It pulls each missing input over the signed API, verifies its hash, and publishes
it into this host's content store before running the unchanged application
handler. A verified cached input avoids another transfer. No photo is manually
copied to the worker and no server filesystem path is used. Models remain local;
Qwen/training participation and full G4 resource qualification remain open.

On the admission host, use the owner credential and the same NAS endpoint/trust.
`fleet nas enqueue "$PHOTO"` uploads the bytes before admission. Application
jobs prepared through other means must also upload their inputs before enqueue;
the NAS rejects missing or corrupt input references.

```sh
pnpm exec ./bin/bookcase fleet nas pause   # stop claims; current attempt drains
pnpm exec ./bin/bookcase fleet nas resume
pnpm exec ./bin/bookcase fleet nas service stop  # drain with bounded shutdown
```

A host-wide loopback mutex prevents duplicate NAS profile processes. Each worker
runs one sequential attempt. A local `fleet/resource-busy` marker blocks claims;
this is an explicit reservation gate, not automatic detection of every external
GPU consumer. The original pilot does not share this mutex: the isolated proof
must not overlap application work there. Automatic cross-application resource
arbitration remains unqualified.

Yuri requires AC and 20:00–07:00 America/Chicago by default. Only an explicit owner
exception may create `fleet/daytime-exception.json` in this profile's private data
root, containing `{"until":"<ISO timestamp>"}`. It must expire within the current
Chicago day and within 24 hours; malformed, expired, future-day and battery states
fail closed. The November 8 proof exception expires at Chicago midnight; do not
roll it forward. An active attempt may drain after eligibility changes.

Operator-only setup remains the firewall rule and, on Yuri, any missing runtime
installation, clone, helper binary copy or new photo transfer. This profile
requires no worker-side photo transfer. Never send private credentials; public
verifier registration is the only cross-host credential material.

After registration, the coordinator checks the public verifier is readable by
the actual NAS service UID. Copying a mode-0600 public file owned by another UID
causes HTTP 401. Set ownership for the service or use 0644 for that public file
inside the dedicated registry; private credentials remain unchanged.

November 8 isolated proof: application runtime `9a7584c`, core client/server
runtime `4e4cd6d`. Each actual Mac LaunchAgent completed one host-scoped
read-vision job from a fresh input store. Both accepted NAS checksums and
response contract/order checks passed, with one claim per host and zero failed
or stale attempts. Synthetic CI passes; these aggregate receipts contain no
photo, reader text, input ID, private path or credential. This proves the bounded
Mac/input milestone, not the full G4 policy/resource matrix or a live cutover.

## G4 policy/resource qualification

The NAS resident and one-shot clients now acquire the same host-wide slot.
Before each claim, the worker rechecks pause/reservation, its original full
helper pin, and the Chicago/AC policy. A changed or missing helper stops new
claims instead of burning a job against stale advertised capabilities. Only
read-vision is advertised in this release profile; Qwen/training stay unavailable.

```sh
pnpm exec ./bin/bookcase fleet nas eligibility "$WORKER"
pnpm exec ./bin/bookcase fleet nas reserve    # external model owner reserves host slot
pnpm exec ./bin/bookcase fleet nas unreserve  # releases that reservation
```

Eligibility reports only a fixed reason: eligible, daytime-exception, paused,
resource-busy, outside-window, battery, power-unknown, helper-unavailable,
helper-changed, or unsupported-worker. Pause/reserve allow an already-running
attempt to drain. Missing/unknown power and malformed/expired exceptions deny
new Yuri claims. A reservation is an explicit operator/application contract;
it does not infer arbitrary GPU occupancy from process names.

The synthetic matrix covers Chicago start/end and both DST transitions,
battery/unknown/failed power probes, same-day/expired/future exceptions,
pause/reservation/helper drift and duplicate slot acquisition. Mid-stream
input disconnects publish no cache bytes and never invoke a handler; a later
verified retry succeeds. Existing job/read-qwen tests retain capability/kind
and helper/model mismatch cases.

On each Mac, after updating to the exact reviewed candidate and reinstalling
only the NAS profile: pause and start it, reserve the resource, and confirm
eligibility reports the appropriate gate. The conductor offers one host-scoped
read-vision job; it must remain unclaimed through pause, service rejoin and
reservation. The one-shot command must reject the occupied slot. Resume while
still reserved must not claim; unreserve then permits the resident to complete.
Report only phase/count/eligibility booleans through HelpDesk. The conductor
checks accepted output hashes and contract; no photo, text, key or path goes
into public evidence. Leave both profiles running under their normal policy.
