// Guard: CI must run the whole test suite, and every test file must be in it. Fails with the
// name of whatever falls outside: a narrowed `test` script, a fixed file list, a disabled step.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// Pure check, so the bad cases can be tested. `workflows` is [{ name, doc }] (parsed YAML).
export function findProblems({ testScript, named, collected, workflows }) {
  const problems = [];

  // 1. What `pnpm test` runs: exactly `vitest run` (no path, --exclude, --project or other
  //    narrowing), and every test-named file is among the files vitest collects.
  if (testScript !== "vitest run") {
    problems.push(`package.json "test" is ${JSON.stringify(testScript)}; it must be exactly "vitest run"`);
  }
  for (const f of named) if (!collected.has(f)) problems.push(`test file not collected by vitest: ${f}`);

  // 2. A workflow that runs on pull requests and on pushes has a plain `pnpm test` step.
  let runsAll = false;
  for (const { name, doc } of workflows) {
    const on = doc?.on ?? doc?.[true] ?? {};
    const events = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on);
    const trigger = (e) => {
      if (!events.includes(e)) return false;
      const cfg = Array.isArray(on) || typeof on === "string" ? null : on[e];
      return !cfg || !(cfg.paths || cfg["paths-ignore"] || cfg.branches || cfg["branches-ignore"] || cfg.tags);
    };
    const triggered = trigger("pull_request") && trigger("push");
    for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
      const jobOk = !job["continue-on-error"] && job.if === undefined;
      for (const [i, step] of (job.steps ?? []).entries()) {
        const where = `${name}: job ${jobId}, step ${i + 1}`;
        const lines = typeof step.run === "string" ? step.run.split("\n").map((l) => l.trim()) : [];
        for (const line of lines) {
          if (/^pnpm (run )?test\s+\S/.test(line) || /\bvitest\b/.test(line)) {
            problems.push(`${where} narrows or bypasses the suite (\`${line}\`); run plain \`pnpm test\``);
          }
        }
        if (lines.includes("pnpm test")) {
          const stepOk = !step["continue-on-error"] && step.if === undefined;
          if (!triggered) problems.push(`${where}: its workflow is not triggered on every pull_request and push`);
          else if (!jobOk || !stepOk) problems.push(`${where}: \`pnpm test\` has an if: or continue-on-error`);
          else runsAll = true;
        }
      }
    }
  }
  if (!runsAll) problems.push("no enabled workflow step runs plain `pnpm test` on pull_request and push");
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..");
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  const named = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter((f) => TEST_FILE.test(f));
  const collected = new Set(
    JSON.parse(run("pnpm", ["exec", "vitest", "list", "--filesOnly", "--json"])).map((e) => relative(root, e.file)),
  );
  const dir = resolve(root, ".github/workflows");
  const workflows = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ name: f, doc: parse(readFileSync(resolve(dir, f), "utf8")) }));
  const testScript = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts?.test;
  const problems = findProblems({ testScript, named, collected, workflows });
  if (problems.length) {
    console.error(problems.map((p) => `check-ci-tests: ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(
    `check-ci-tests: ok, ${collected.size} test file(s) collected by pnpm test; tests that need local tools skip themselves`,
  );
}
