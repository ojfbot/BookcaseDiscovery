// `bookcase jobs <enqueue|work|sweep|report>`: the interim job queue (card N-1, docs/ops/compute-fleet.md).
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { dataRoot } from "../ledger/index.ts";
import { builtInHandlers, detectCapabilities } from "./job-kinds.ts";
import { JobStore, runWorker } from "./jobs.ts";
import type { JobSpec } from "./jobs.ts";

export const jobsUsage = `usage: bookcase jobs <command> [options]

commands:
  enqueue <specs.jsonl>   admit one job per line (JobSpec); an existing job key is left alone
  work                    claim and run jobs until none is runnable here (Ctrl-C releases the current job)
  sweep                   return expired leases to the queue
  report                  the morning report: aggregates per job kind and worker (no payloads)

options:
  --db <path>       the job table (default: $BOOKCASE_DATA/jobs/jobs.sqlite)
  --worker <id>     worker id for work (default: <hostname>:<pid>)
  --caps <a,b>      extra capabilities for work, beyond those detected on this host
  --max <n>         work: stop after n jobs
  --since <iso>     report: count events from this time (default: last 24 h)
  --json            report: print JSON

Outputs go to $BOOKCASE_DATA/jobs/out/<job key>.<ext>. The table and outputs are private: never committed.`;

export async function jobsCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        db: { type: "string" },
        worker: { type: "string" },
        caps: { type: "string" },
        max: { type: "string" },
        since: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    console.error(`bookcase jobs: ${e instanceof Error ? e.message : e}\n\n${jobsUsage}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const [sub, ...rest] = positionals;
  if (values.help || !sub) {
    console.log(jobsUsage);
    return values.help ? 0 : 1;
  }
  const root = dataRoot(env);
  const store = new JobStore(values.db ?? join(root, "jobs", "jobs.sqlite"));
  try {
    if (sub === "enqueue") {
      if (rest.length !== 1) {
        console.error(jobsUsage);
        return 1;
      }
      let created = 0;
      let existing = 0;
      for (const line of readFileSync(rest[0]!, "utf8").split("\n")) {
        if (!line.trim()) continue;
        if (store.enqueue(JSON.parse(line) as JobSpec).created) created += 1;
        else existing += 1;
      }
      console.log(`${created} job${created === 1 ? "" : "s"} admitted, ${existing} already known`);
      return 0;
    }
    if (sub === "work") {
      const ac = new AbortController();
      const stop = (): void => ac.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      const caps = [...detectCapabilities(env), ...(values.caps ? values.caps.split(",").map((c) => c.trim()).filter(Boolean) : [])];
      const s = await runWorker(store, {
        worker: values.worker ?? `${hostname()}:${process.pid}`,
        caps,
        handlers: builtInHandlers(),
        outDir: join(root, "jobs", "out"),
        maxJobs: values.max ? Number(values.max) : undefined,
        signal: ac.signal,
        log: (l) => console.error(l),
      });
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      console.log(`completed ${s.completed}, failed ${s.failed}, stale-rejected ${s.staleRejected}, released ${s.released}`);
      return 0;
    }
    if (sub === "sweep") {
      console.log(`${store.sweep()} expired lease(s) returned`);
      return 0;
    }
    if (sub === "report") {
      const since = values.since ? Date.parse(values.since) : Date.now() - 24 * 3_600_000;
      if (Number.isNaN(since)) {
        console.error(`bookcase jobs: --since is not a date: ${values.since}`);
        return 1;
      }
      const r = store.report(since);
      if (values.json) {
        console.log(JSON.stringify(r, null, 2));
        return 0;
      }
      console.log(`since ${new Date(r.since).toISOString()}`);
      for (const [kind, c] of Object.entries(r.byKind)) console.log(`  ${kind}: ${c.done} done, ${c.failed} failed, ${c.claimed} running, ${c.ready} waiting`);
      for (const [w, c] of Object.entries(r.byWorker))
        console.log(`  worker ${w}: ${c.completed} completed, ${c.failed} failed, ${c.staleRejected} stale-rejected, ${(c.machineSeconds / 3600).toFixed(2)} machine-h`);
      for (const f of r.failures) console.log(`  failed ${f.kind} × ${f.count}: ${f.error}`);
      if (r.oldestReadyAgeSeconds !== null) console.log(`  oldest waiting job: ${Math.round(r.oldestReadyAgeSeconds / 60)} min`);
      return 0;
    }
    console.error(`bookcase jobs: unknown command "${sub}"\n\n${jobsUsage}`);
    return 1;
  } catch (e) {
    console.error(`bookcase jobs: ${e instanceof Error ? e.message : e}`);
    return 1;
  } finally {
    store.close();
  }
}
