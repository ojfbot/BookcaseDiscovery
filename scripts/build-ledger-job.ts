import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildLedgerFixture, canonicalJson, sha256 } from "../src/run/ledger-job.ts";
import { scenario } from "../test/helpers/ledger-fixtures.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? join(root, "dist/ledger-job"));
if (existsSync(output)) throw Error("ledger-release-output-exists");
const scratch = mkdtempSync(join(tmpdir(), "ledger-release-"));
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = join(dir, entry.name);
  return entry.isDirectory() ? files(file) : [file];
}).sort();
try {
  const fixture = buildLedgerFixture(scenario(), scratch);
  const fixtureSha256 = sha256(canonicalJson(fixture));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
  const release = { name: "bookcase-ledger-job", version: "0.1.0", commit, clean: !dirty, fixtureSha256, events: 21, node_floor: "24.22.2" };
  const target = join(output, "src/ledger/ledger-job.mjs");
  mkdirSync(dirname(target), { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: [join(root, "src/run/ledger-job-cli.ts")],
    outfile: target,
    platform: "node", format: "esm", target: "node24", bundle: true,
    banner: { js: 'import { createRequire as ledgerCreateRequire } from "node:module"; const require = ledgerCreateRequire(import.meta.url);' },
    define: { __LEDGER_JOB_RELEASE__: JSON.stringify(JSON.stringify(release)), __LEDGER_JOB_FIXTURE__: JSON.stringify(JSON.stringify(fixture)) },
  });
  cpSync(join(root, "contracts"), join(output, "contracts"), { recursive: true });
  cpSync(join(root, "scripts/install-ledger-job.mjs"), join(output, "install.mjs"));
  const sourceFiles = [join(root, "package.json"), join(root, "pnpm-lock.yaml"), join(root, "pnpm-workspace.yaml"), join(root, "scripts/install-ledger-job.mjs"), join(root, "test/helpers/ledger-fixtures.ts"), ...files(join(root, "test/fixtures/contracts")), ...files(join(root, "contracts")), ...files(join(root, "src/ledger")), join(root, "src/run/ledger-job.ts"), join(root, "src/run/ledger-job-cli.ts"), fileURLToPath(import.meta.url)];
  const hashes = (names: string[], base: string) => Object.fromEntries(names.map((file) => [relative(base, file), sha256(readFileSync(file))]));
  writeFileSync(join(output, "manifest.json"), `${JSON.stringify({ ...release, sourceFiles: hashes(sourceFiles, root), files: hashes(files(output).filter((f) => !f.endsWith("/manifest.json")), output) }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...release, bundleSha256: sha256(readFileSync(target)) })}\n`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
