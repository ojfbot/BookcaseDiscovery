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
