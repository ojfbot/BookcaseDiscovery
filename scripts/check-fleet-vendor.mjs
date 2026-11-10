import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const vendor = join(root, "src/run/vendor/fleet-runner");
const revision = readFileSync(join(vendor, "core-revision.txt"), "utf8").trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("invalid core fleet revision");
const core = process.argv[2];

async function source(file) {
  const path = `packages/fleet-runner/src/${file}`;
  if (core) return execFileSync("git", ["-C", core, "show", `${revision}:${path}`], { encoding: "utf8" });
  const url = `https://raw.githubusercontent.com/ojfbot/core/${revision}/${path}`;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`failed to retrieve pinned fleet source for ${file}`);
  return response.text();
}

function check(file, expected) {
  if (readFileSync(join(vendor, file), "utf8") !== expected)
    throw new Error(`vendored ${file} differs from the pinned core revision`);
}

const runtime = ["auth.ts", "client.ts", "worker.ts", "diagnostics.ts", "inputs.ts", "status.ts", "presence.ts"];
await Promise.all(runtime.map(async (file) => {
  const content = await source(file);
  // Node runs the vendored source directly. Keep only this import-extension adaptation.
  check(file, content.replace(/(from "\.\/(?:auth|client|diagnostics|inputs|status|presence))\.js"/g, '$1.ts"'));
}));

const dir = mkdtempSync(join(tmpdir(), "fleet-vendor-"));
try {
  const jobs = join(dir, "jobs.ts");
  writeFileSync(jobs, await source("jobs.ts"));
  writeFileSync(join(dir, "auth.ts"), await source("auth.ts"));
  writeFileSync(join(dir, "status.ts"), await source("status.ts"));
  const config = join(dir, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      declaration: true,
      emitDeclarationOnly: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      types: ["node"],
      typeRoots: [join(root, "node_modules/@types")],
    },
    files: [jobs],
  }));
  execFileSync("pnpm", ["exec", "tsc", "--project", config], { cwd: root, stdio: "inherit" });
  check("jobs.d.ts", readFileSync(join(dir, "jobs.d.ts"), "utf8"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("fleet vendor matches pinned core revision");
