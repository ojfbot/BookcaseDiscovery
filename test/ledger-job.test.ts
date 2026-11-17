import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLedgerFixture, canonicalJson, runLedgerJob, sha256 } from "../src/run/ledger-job.ts";
import { scenario } from "./helpers/ledger-fixtures.ts";
import { SqliteLedger } from "../src/ledger/sqlite.ts";

const dirs: string[] = [];
const temporary = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), "ledger-job-"))); dirs.push(d); return d; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const root = temporary();
  const outDir = join(root, "output"); mkdirSync(outDir, { mode: 0o700 });
  const fixture = buildLedgerFixture(scenario(), join(root, "fixture"));
  const grant = { schemaVersion: 1, proofId: "1a226eba-dc2c-45b8-b647-315c8afc42a2", key: "1".repeat(64), code: "2".repeat(40), fixtureSha256: sha256(canonicalJson(fixture)), outDir, expiresAtMs: 2_000 };
  const input = { job: { key: grant.key, kind: "bookcase-ledger-replay", inputs: [], params: { fixtureVersion: 1, proofId: grant.proofId, fixtureSha256: grant.fixtureSha256 }, code: grant.code, payload: null, fence: 1, leaseExpires: 1_900 }, outDir };
  return { fixture, grant, input, outDir };
}

describe("claimed Bookcase ledger job", () => {
  it("executes real append and replay, retains both databases, and returns computed output", () => {
    const { fixture, grant, input, outDir } = setup();
    const output = runLedgerJob(input, grant, fixture, () => 1_000);
    const bytes = readFileSync(join(outDir, output.file));
    expect(bytes.toString()).toBe('{"events":21,"identical":true,"differences":[]}\n');
    expect(output.sha256).toBe(sha256(bytes));
    const scratch = readdirSync(outDir).find((n) => n.startsWith("ledger-"))!;
    const source = new SqliteLedger(join(outDir, scratch, "source.sqlite"), { readOnly: true });
    const target = new SqliteLedger(join(outDir, scratch, "replayed.sqlite"), { readOnly: true });
    try { expect([...source.events()]).toHaveLength(21); expect([...target.events()]).toEqual([...source.events()]); expect(target.viewDump()).toEqual(source.viewDump()); } finally { source.close(); target.close(); }
    expect(() => runLedgerJob(input, grant, fixture, () => 1_000)).toThrow();
  });
  it("refuses an altered fixture and a corrupted expected view", () => {
    const { fixture, grant, input } = setup();
    expect(() => runLedgerJob(input, grant, { ...fixture, events: fixture.events.slice(1) }, () => 1_000)).toThrow();
    const corrupt = { ...fixture, viewsSha256: "0".repeat(64) };
    const matching = { ...grant, fixtureSha256: sha256(canonicalJson(corrupt)) };
    const corruptInput = { ...input, job: { ...input.job, params: { ...input.job.params, fixtureSha256: matching.fixtureSha256 } } };
    expect(() => runLedgerJob(corruptInput, matching, corrupt, () => 1_000)).toThrow("ledger-oracle-mismatch");
  });
  it("refuses a wrong key, code, capability-shaped extra field and output path before executing", () => {
    const { fixture, grant, input, outDir } = setup();
    for (const job of [{ ...input.job, key: "3".repeat(64) }, { ...input.job, code: "4".repeat(40) }, { ...input.job, command: "anything" }]) expect(() => runLedgerJob({ ...input, job }, grant, fixture, () => 1_000)).toThrow();
    expect(() => runLedgerJob({ ...input, outDir: temporary() }, grant, fixture, () => 1_000)).toThrow("ledger-job-mismatch");
    expect(readdirSync(outDir)).toEqual([]);
  });
  it("checks absolute grant/lease deadlines before and after replay", () => {
    const { fixture, grant, input, outDir } = setup();
    expect(() => runLedgerJob(input, grant, fixture, () => 2_001)).toThrow("ledger-grant-expired");
    expect(readdirSync(outDir)).toEqual([]);
    let calls = 0;
    expect(() => runLedgerJob(input, grant, fixture, () => ++calls > 2 ? 2_001 : 1_000)).toThrow("ledger-grant-expired");
    expect(readdirSync(outDir).some((f) => f.endsWith(".jsonl"))).toBe(false);
  });
});
