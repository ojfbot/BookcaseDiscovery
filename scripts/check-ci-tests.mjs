// Guard: every test file in the repo must be run by `pnpm test`, and CI must run `pnpm test`
// (not a hand-written list of files). Fails with the names of anything that falls outside.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
const problems = [];

// 1. Every tracked file that looks like a test is one vitest will collect.
const named = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  .split("\0")
  .filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
const collected = new Set(
  JSON.parse(run("pnpm", ["exec", "vitest", "list", "--filesOnly", "--json"])).map((e) => relative(root, e.file)),
);
for (const f of named) if (!collected.has(f)) problems.push(`test file not collected by vitest: ${f}`);

// 2. CI runs the whole suite through `pnpm test`, and never a fixed list of test files.
const dir = resolve(root, ".github/workflows");
let runsAll = false;
for (const w of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  for (const [i, line] of readFileSync(resolve(dir, w), "utf8").split("\n").entries()) {
    const cmd = line.replace(/^\s*-?\s*(run:)?\s*/, "").trim();
    if (cmd.startsWith("#")) continue;
    if (/^pnpm test\s*$/.test(cmd)) runsAll = true;
    if (/\bvitest\b.*\b(test\/|[\w./-]+\.test\.[cm]?[jt]s)/.test(cmd)) {
      problems.push(`${w}:${i + 1} runs a fixed list of test files; run \`pnpm test\` instead`);
    }
  }
}
if (!runsAll) problems.push("no workflow step runs `pnpm test`");

if (problems.length) {
  console.error(problems.map((p) => `check-ci-tests: ${p}`).join("\n"));
  process.exit(1);
}
console.log(`check-ci-tests: ok, ${named.length} test file(s) all run by CI`);
