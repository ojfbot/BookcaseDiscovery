import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";
import { scenario } from "./helpers/ledger-fixtures.ts";
import { buildLedgerFixture, canonicalJson, sha256 } from "../src/run/ledger-job.ts";
// The installer verifier is plain Node and deliberately has no signature-check override.
// @ts-expect-error JavaScript installer has no declaration file.
import { verifyLedgerRelease } from "../scripts/install-ledger-job.mjs";

let directory: string, bundle: string, fixtureSha256: string, grant: Record<string, unknown>, input: unknown;
beforeAll(async () => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "ledger-cli-")));
  const app = join(directory, "relocated app");
  mkdirSync(join(app, "src/ledger"), { recursive: true }); cpSync(resolve("contracts"), join(app, "contracts"), { recursive: true });
  const fixture = buildLedgerFixture(scenario(), join(directory, "fixture")); fixtureSha256 = sha256(canonicalJson(fixture));
  bundle = join(app, "src/ledger/ledger-job.mjs");
  await build({ entryPoints: [resolve("src/run/ledger-job-cli.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node24", banner: { js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);' }, define: { __LEDGER_JOB_RELEASE__: JSON.stringify(JSON.stringify({ name: "bookcase-ledger-job", version: "0.1.0", commit: "a".repeat(40), clean: true, fixtureSha256, events: 21, node_floor: "24.22.2" })), __LEDGER_JOB_FIXTURE__: JSON.stringify(JSON.stringify(fixture)) } });
  const outDir = join(directory, "output"); mkdirSync(outDir, { mode: 0o700 });
  grant = { schemaVersion: 1, proofId: "12345678-1234-4234-8234-123456789abc", key: "b".repeat(64), code: "a".repeat(40), fixtureSha256, outDir, expiresAtMs: Date.now() + 120_000 };
  input = { job: { key: grant.key, kind: "bookcase-ledger-replay", inputs: [], params: { fixtureVersion: 1, fixtureSha256, proofId: grant.proofId }, code: grant.code, payload: null, fence: 1, leaseExpires: Date.now() + 60_000 }, outDir };
  writeFileSync(join(directory, "grant.json"), JSON.stringify(grant), { mode: 0o600 });
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it("executes the relocated bundled app with its contracts and real databases, without an author checkout", () => {
  const result = spawnSync(process.execPath, [bundle, "--grant", join(directory, "grant.json")], { cwd: tmpdir(), input: JSON.stringify(input), encoding: "utf8" });
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout);
  const bytes = readFileSync(join(String(grant.outDir), output.file), "utf8");
  expect(bytes).toBe('{"events":21,"identical":true,"differences":[]}\n');
  expect(output.sha256).toBe(sha256(bytes));
});
it("refuses extra arguments, exposed grant permissions and stale grant identity with sanitized stderr", () => {
  const grantFile = join(directory, "bad-grant.json");
  writeFileSync(grantFile, JSON.stringify({ ...grant, key: "c".repeat(64) }), { mode: 0o600 });
  for (const args of [["--grant", grantFile], ["--grant", grantFile, "extra"]]) {
    const result = spawnSync(process.execPath, [bundle, ...args], { cwd: tmpdir(), input: JSON.stringify(input), encoding: "utf8" });
    expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toContain("ledger-job-refused"); expect(result.stderr).not.toContain(directory);
  }
  requireFs.chmodSync(grantFile, 0o644);
  const result = spawnSync(process.execPath, [bundle, "--grant", grantFile], { input: JSON.stringify(input), encoding: "utf8" });
  expect(result.status).toBe(1);
});
import * as requireFs from "node:fs";

it("verifies every release file and refuses changed bytes or unlisted files", () => {
  const app = join(directory, "relocated app");
  const files: Record<string, string> = {};
  const visit = (dir: string) => { for (const e of requireFs.readdirSync(dir, { withFileTypes: true })) { const f = join(dir, e.name); if (e.isDirectory()) visit(f); else files[requirePath.relative(app, f)] = sha256(readFileSync(f)); } };
  visit(app);
  const manifest = { name: "bookcase-ledger-job", version: "0.1.0", commit: "a".repeat(40), clean: true, fixtureSha256, events: 21, node_floor: "24.22.2", files };
  writeFileSync(join(app, "manifest.json"), JSON.stringify(manifest));
  const pin = sha256(readFileSync(join(app, "manifest.json")));
  expect(verifyLedgerRelease(app, pin).commit).toBe(manifest.commit);
  writeFileSync(join(app, "unlisted"), "extra"); expect(() => verifyLedgerRelease(app, pin)).toThrow("ledger-release-file-mismatch"); rmSync(join(app, "unlisted"));
  writeFileSync(bundle, "changed"); expect(() => verifyLedgerRelease(app, pin)).toThrow("ledger-release-hash-mismatch");
  files["src/ledger/ledger-job.mjs"] = sha256(readFileSync(bundle));
  writeFileSync(join(app, "manifest.json"), JSON.stringify({ ...manifest, files }));
  expect(() => verifyLedgerRelease(app, pin)).toThrow("ledger-release-manifest-pin-mismatch");
  expect(() => verifyLedgerRelease(app)).toThrow("ledger-release-manifest-pin-required");
});
import * as requirePath from "node:path";
