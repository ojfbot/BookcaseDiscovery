// Target-machine G4 resource qualifier. The coordinator admits one host-scoped job while paused.
// All input/model execution remains in the supervised service. No credential or job is printed.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dataRoot } from "../src/ledger/images.ts";
import { fleetCommand } from "../src/run/fleet-cli.ts";
const [worker] = process.argv.slice(2);
assert(worker === "yuri" || worker === "yojimbo");
const env = { ...process.env, FLEET_SERVICE_PROFILE: "nas", FLEET_AUTO_INPUTS: "1" };
const dir = join(dataRoot(env), "fleet");
const steps: { phase: string; at: number; passed: boolean }[] = [];
const record = (phase: string) => { steps.push({ phase, at: Date.now(), passed: true }); console.log(JSON.stringify({ phase, passed: true })); };
const call = async (...args: string[]) => assert.equal(await fleetCommand(["nas", ...args], env), 0);
const diagnostic = () => JSON.parse(readFileSync(join(dir, "resident-diagnostic.json"), "utf8")) as { eligibility: string; pid: number };
const waitReason = async (expected: string, previousPid?: number) => {
  for (let i = 0; i < 90; i++) { try { const info = diagnostic(); if (info.eligibility === expected && typeof info.pid === "number" && info.pid !== previousPid) return; } catch { /* Wait for supervised process snapshot. */ } await delay(500); }
  throw Error("eligibility-readback-failed");
};
try {
  await call("pause"); await call("reserve"); await call("service", "start");
  await waitReason("paused"); record("paused"); await delay(12_000);
  const previousPid = diagnostic().pid;
  await call("service", "stop"); await call("service", "start");
  await waitReason("paused", previousPid); record("rejoined-paused"); await delay(12_000);
  let duplicateDenied = false;
  const original = console.error;
  try { console.error = (message: unknown) => { if (message === "fleet command failed (EADDRINUSE)") duplicateDenied = true; };
    assert.equal(await fleetCommand(["nas", "work", worker], env), 1);
  } finally { console.error = original; }
  assert(duplicateDenied);record("duplicate-denied");
  await call("resume"); await waitReason("resource-busy");record("reserved");await delay(12_000);
  record("unreserving");await call("unreserve");
  const output = join(dir, "resource-qualification.json");
  // A bounded aggregate receipt only; does not contain job keys, input IDs, private paths or content.
  mkdirSync(dir, { recursive: true });
  writeFileSync(output, JSON.stringify({ format: "fleet-resource-qualification/1", worker, steps, unreservedAt: Date.now() }) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ phasesPassed: steps.length, unreservedAt: Date.now(), reservationCleared: !existsSync(join(dir, "resource-busy")) }));
} catch {
  // Preserve a failure as paused; the conductor must inspect before any new claim.
  await fleetCommand(["nas", "pause"], env);
  console.error(JSON.stringify({ status: "blocked", code: "resource-qualification-failed" }));process.exitCode = 1;
}
