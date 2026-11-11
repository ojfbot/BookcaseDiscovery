# G6 physical interruption packet — current HTTPS NAS candidate

This packet targets the reviewed current app main, not the historical HTTP-only BCD #37 rehearsal. It adds a one-shot proof-fixture adapter and does not change resident handlers, their advertised capabilities, or profile admission. Each physical trial creates one synthetic `proof-fixture` job that requires a random per-trial capability. Normal resident read-vision workers neither advertise that capability nor handle that kind.

## Immutable pins and boundary

The packet refuses to run unless these source/runtime pins match:

| Item | Required pin |
|---|---|
| BookcaseDiscovery current app main parent | `699a1a8c9730ab038199d03ecddc447b0e1cf9e3` |
| Drill source | one clean commit whose first parent is the app-main pin above; its full SHA is recorded in each local packet and the new commit receipt |
| Current app vendored FleetRunner client/worker | `dad1d204bb2e01c691aa69de3ce3f0b218f7de21` (`src/run/vendor/fleet-runner/core-revision.txt`) |
| Refreshed HTTPS NAS service source pin | `78c71e9a7f085c092425fdbe99193a06c06e9e3f` |
| Signed status build label | `78c71e9` |
| Refreshed NAS image ID | `sha256:704a311810e999f7cfc24f26a8c22a6cd8090cc63017fc66dc13706fa9865066` |
| Application runtime | Node `24.22.2`, BookcaseDiscovery source `699a1a8c9730ab038199d03ecddc447b0e1cf9e3` plus the frozen drill commit |
| Synthetic output fixture | `fleet-runner packaging fixture v1\n`, SHA-256 `f04565eea01f62eeb7149c8609c8a901ca0af5ffb74c37a181ca0955479e7890` |

The NAS image ID is the intended refreshed candidate pin, not a live assertion. Before each admission, the owner rechecks the running service through the existing approved operator channel and signed HTTPS status. Stop if the image, source manifest, build label, certificate identity, queue baseline, or readiness differs. The script performs no Docker inspection and never prints the endpoint, CA path, token path, worker data root, or service-local paths.

Preserve the 14 historical accepted outputs as they exist: 10 completed `proof-fixture` jobs and 4 completed `read-vision` jobs. `prepare` requires exactly those counts plus one newly completed fixture for each earlier passed G6 trial, with no ready/claimed/failed jobs. Each new job has a distinct key and attempt filename. The trial uses only the isolated candidate queue; it does not change the old Yojimbo pilot authority.

No model, GPU, model download, NAS filesystem path, production token, or new signing credential is used. The adapter requires the existing local owner/worker signing token and existing public CA certificate; TLS certificate and hostname verification stay enabled. Although app main contains generation-bound client support, this refreshed schema-4 service does not use generation binding; the adapter rejects any defined `FLEET_GENERATION` because the refresh plan does not assign or assert generation semantics. Never copy an owner or worker signing token, TLS private key, or CA private key. The one random capability and job key printed by `prepare` are per-trial queue selectors, not authentication credentials; pass only those two values to the two designated workers through the existing owner-approved channel.

## Yuri eligibility

The Yuri `hold` command rechecks the current app's NAS eligibility, including pause, resource-busy marker, helper pin and power policy. Yuri runs only on AC between 20:00 and 07:00 America/Chicago. A daytime run is allowed only if an owner has already created the existing `fleet/daytime-exception.json` through the approved owner process and its `until` is within 15 minutes and the current Chicago day. The adapter reads that file; it never creates, extends, or rolls it forward. If no such explicit bounded owner grant exists, wait for the night window. Battery or unknown power always blocks. The Yojimbo reclaimer also checks the existing NAS eligibility and remote worker-control gate before every claim.

## Local setup

Use the clean drill checkout on the owner host and both designated Macs. It must be the single-child commit of the reviewed app main described above. Build/configure nothing else and do not replace the resident LaunchAgents. Each host uses its own pre-existing identity and local token. The environment below must be populated from that host’s existing private configuration; do not put credentials or endpoint values in shell history or this artifact. Leave `FLEET_GENERATION` unset for this v4 candidate.

```sh
export FLEET_ENDPOINT='https://<existing-approved-nas-endpoint>/'
export NODE_EXTRA_CA_CERTS='<existing-public-CA-certificate-path>'
export FLEET_TOKEN_FILE='<existing-local-token-path>'
export G6_EVIDENCE_DIR='<new-private-local-evidence-directory>'
umask 077
mkdir -p "$G6_EVIDENCE_DIR"
chmod 700 "$G6_EVIDENCE_DIR"
node --version                         # require v24.22.2
git rev-parse HEAD                     # record the full drill commit
git status --porcelain=v1              # require empty
cat src/run/vendor/fleet-runner/core-revision.txt # require the pin above
```

On the owner coordinator, set `FLEET_ID=owner`. On Yuri set `FLEET_ID=yuri`; on Yojimbo set `FLEET_ID=yojimbo`. Do not copy key files. The adapter checks that the endpoint is HTTPS, the existing CA path is readable, the signing token is local and mode 0600, the app checkout is clean and pinned, the vendored core revision matches, and signed service status has the expected build and queue baseline.

Before a daytime exception, the owner must decide and create the existing same-day exception under the app's established private-data procedure. The adapter will reject a grant longer than 15 minutes and will never write the exception. Do not interpret this packet as standing approval for daytime work.

## One serialized trial

Run trial IDs exactly once and in this order: `lid-1`, `lid-2`, `lid-3`, `wifi-1`, `wifi-2`, `wifi-3`. `prepare` accepts `prior-passed-trial-count` from 0 through 5 only. The status baseline is always 4 historical read-vision jobs plus 10 historical proof fixtures plus that many new passed trial fixtures. Final verification of `wifi-3` accepts the completed count of 6; there is no seventh trial or admission. Only one `.g6-physical-active.json` lock may exist. A crash or failed check leaves the lock and packet for reconciliation; do not delete or reuse them by hand.

1. **Owner admit and baseline.** On the coordinator, with `FLEET_ID=owner`, recheck the approved image/source receipt and run the following. The command first validates TLS configuration, reads signed status, and checks the historical category counts and idle queue; only then does it create the active lock, private checkpoint packet and one synthetic fixture admission.

   ```sh
   node src/run/g6-physical-drill.ts prepare lid-1 0
   ```

   Copy the returned `jobKey` and `capability` to Yuri and Yojimbo over the existing approved channel. Do not send authentication keys. The packet is stored mode 0600 and records the start event cursor, source pins and fixed fixture hash. The evidence directory must be absolute and exactly private mode 0700; the adapter rejects relative paths, symlinks, and group/world access. TLS and signed status/baseline validation happen before the active lock is created, so an early preflight failure does not leave a lock without a packet.

2. **Yuri arm and bounded hold.** On Yuri, with its existing worker identity and existing TLS trust, start the one-shot worker. It runs only `proof-fixture`, records its claim/heartbeat times privately, and holds the deterministic output for exactly 12 minutes. It performs no OCR or GPU work.

   ```sh
   export FLEET_ID=yuri
   node src/run/g6-physical-drill.ts hold lid-1 '<jobKey>' '<capability>'
   ```

   While it is held, the owner arms the checkpoint by observing the signed claim event. This command waits at most 120 seconds and requires the claim to belong to Yuri.

   ```sh
   export FLEET_ID=owner
   node src/run/g6-physical-drill.ts observe lid-1 yuri 120000
   ```

3. **Perform the single manual interruption.** After the owner observes Yuri’s first claim, wait for and locally confirm at least one `heartbeat` receipt with `accepted: true` (the one-shot worker’s heartbeat interval is 60 seconds). If that receipt is absent, do not interrupt. For a `lid-*` trial, verify Yuri is on AC and perform an actual macOS lid sleep; retain local `pmset -g log` entries covering sleep and wake. For a `wifi-*` trial, retain before/after route and associated-network evidence, physically disconnect Wi-Fi, and leave it down across lease expiry and reclaim. No simulated worker pause or fetch stub counts. Do not close the lid or toggle Wi-Fi until the first claim and one accepted heartbeat are confirmed.

4. **Eligible other-host reclaim.** Once the physical interruption begins, on Yojimbo start its bounded, one-job reclaimer. It polls every five seconds for at most 320 seconds, checks the local NAS eligibility and remote pause gate each time, and can claim only the unique trial capability with the `proof-fixture` handler.

   ```sh
   export FLEET_ID=yojimbo
   node src/run/g6-physical-drill.ts reclaim lid-1 '<jobKey>' '<capability>'
   ```

   The owner records the reclaim claim; timeout or a wrong worker/fence leaves the packet locked for reconciliation.

   ```sh
   export FLEET_ID=owner
   node src/run/g6-physical-drill.ts observe lid-1 yojimbo 320000
   ```

5. **Wake/rejoin and readback.** For lid trials, open the lid after Yojimbo reports its accepted fixture. For Wi-Fi trials, rejoin after Yojimbo reports acceptance. Let Yuri's bounded one-shot finish; it must report `lease-lost` and its deliberate old-fence completion must return `false`. Do not kill or restart the resident worker. Copy only the two local worker receipt files and the private OS/network evidence references to the owner's evidence directory using the established approved channel; never copy credentials.

   ```sh
   # On the owner after receipt files are present:
   export FLEET_ID=owner
   node src/run/g6-physical-drill.ts verify lid-1
   ```

   `verify` checks the signed event sequence (Yuri claim → lease expiry → increasing Yojimbo fence → one Yojimbo completion → rejected stale Yuri completion), the fixed fixture receipts, the server's accepted-output verification, all 10 historical proof fixtures, all 4 historical read-vision jobs, the new passed-trial count, and the observed successful-renewal/reclaim schedule. It records a `passed` packet and releases the lock only after every check passes. Retain the `lid-1.packet.json`, both worker receipts, OS receipt reference and accepted-output SHA-256 privately.

6. **Invalid/incomplete trial.** Stop and reconcile the exact queue event, active lease and both local receipts before marking invalid. `finish-invalid` only records one of the bounded review reason codes and releases the lock; it does not rerun or delete the job. Do not reuse the ID.

   ```sh
   node src/run/g6-physical-drill.ts finish-invalid lid-1 lid-not-slept
   ```

Use the same sequence for each unique ID, changing only trial ID and prior passed count. The adapter requires Yojimbo's claim to follow the lease-expiry event, fences to increase, an exactly single accepted proof-fixture output, and Yuri's stale upload to be rejected. The reclaim receipt measures the last accepted heartbeat request window, lease `L=300,000 ms`, five-second poll `P=5,000 ms`, and the `L+2P=310,000 ms` bound with the measured HTTP request duration recorded as timing uncertainty. Compare worker/server clock evidence before interpreting the timestamps; if the hosts are not time-synchronized, mark the trial invalid.

## Trial packet ledger

| Trial | Physical action | Status |
|---|---|---|
| `lid-1` | Actual lid sleep/wake | `UNTESTED` |
| `lid-2` | Actual lid sleep/wake | `UNTESTED` |
| `lid-3` | Actual lid sleep/wake | `UNTESTED` |
| `wifi-1` | Actual Wi-Fi disconnect/rejoin | `UNTESTED` |
| `wifi-2` | Actual Wi-Fi disconnect/rejoin | `UNTESTED` |
| `wifi-3` | Actual Wi-Fi disconnect/rejoin | `UNTESTED` |

No physical action, service probe, NAS write, key transfer, resident-worker replacement, or queue mutation has been performed while preparing this packet. All six actions still require the designated owner to run the commands above manually. HelpDesk and FleetRunner failure-isolation checks remain separate and `PENDING`.
