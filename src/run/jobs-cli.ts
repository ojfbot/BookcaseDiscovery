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

Each attempt writes $BOOKCASE_DATA/jobs/out/<job key>.<fence>.<ext>; the job table names the accepted one.
The table and outputs are private: never committed.`;

/** Shape check at admission. Kind-specific checks run in the handler, where the host's inputs are. */
function isJobSpec(v: unknown): v is JobSpec {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  const strings = (a: unknown): boolean => Array.isArray(a) && a.every((x) => typeof x === "string");
  return (
    typeof s.kind === "string" &&
    s.kind.length > 0 &&
    strings(s.inputs) &&
    "payload" in s &&
    (s.params === undefined || (typeof s.params === "object" && s.params !== null && !Array.isArray(s.params))) &&
    (s.code === undefined || typeof s.code === "string") &&
    (s.requires === undefined || strings(s.requires)) &&
    (s.priority === undefined || Number.isInteger(s.priority)) &&
    (s.maxAttempts === undefined || (Number.isInteger(s.maxAttempts) && (s.maxAttempts as number) > 0))
  );
}

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
      // Validate every line before admitting any. Errors name the line and a fixed code, never the line's
      // text: a spec's payload may name a private path.
      const specs: JobSpec[] = [];
      const lines = readFileSync(rest[0]!, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        if (!line.trim()) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          console.error(`bookcase jobs: ${rest[0]} line ${i + 1}: bad-json`);
          return 1;
        }
        if (!isJobSpec(value)) {
          console.error(`bookcase jobs: ${rest[0]} line ${i + 1}: bad-spec`);
          return 1;
        }
        specs.push(value);
      }
      let created = 0;
      let existing = 0;
      for (const spec of specs) {
        if (store.enqueue(spec).created) created += 1;
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
      const { now, period } = r;
      console.log(`now (${new Date(now.at).toISOString()}):`);
      for (const [kind, c] of Object.entries(now.byKind)) console.log(`  ${kind}: ${c.done} done, ${c.failed} failed, ${c.claimed} running, ${c.ready} waiting`);
      for (const f of now.failures) console.log(`  failed ${f.kind} × ${f.count}: ${f.error}`);
      if (now.oldestReadyAgeSeconds !== null) console.log(`  oldest waiting job: ${Math.round(now.oldestReadyAgeSeconds / 60)} min`);
      console.log(`period ${new Date(period.since).toISOString()} to ${new Date(period.until).toISOString()}:`);
      const ev = period.events;
      console.log(`  ${ev.enqueued ?? 0} admitted, ${ev.claimed ?? 0} attempts started, ${ev.completed ?? 0} completed, ${ev["lease-expired"] ?? 0} leases expired`);
      for (const [w, c] of Object.entries(period.byWorker))
        console.log(
          `  worker ${w}: ${c.completed} completed, ${c.failed} failed, ${c.released} released, ${c.leaseExpired} lease-expired, ${c.staleRejected} stale-rejected, ${(c.machineSeconds / 3600).toFixed(2)} leased machine-h`,
        );
      return 0;
    }
    console.error(`bookcase jobs: unknown command "${sub}"\n\n${jobsUsage}`);
    return 1;
  } catch (e) {
    // A code, not the message: SQLite and file errors can quote values, and values can name private paths.
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.name : "error";
    console.error(`bookcase jobs: ${sub} failed (${code})`);
    return 1;
  } finally {
    store.close();
  }
}
