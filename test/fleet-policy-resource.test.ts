import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireNasSlot, nasEligibility } from "../src/run/fleet-eligibility.ts";
import { runWorker } from "../src/run/vendor/fleet-runner/worker.ts";
import type { FleetClient } from "../src/run/vendor/fleet-runner/client.ts";
let root: string, helper: string, fleet: string, expected: string;
const ac = () => "Now drawing from 'AC Power'\n";
const at = (iso: string) => () => new Date(iso);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fleet-policy-")); helper = join(root, "helper"); fleet = join(root, "fleet");
  mkdirSync(fleet); writeFileSync(helper, "synthetic helper bytes");
  expected = `ocr-vision@sha256:${createHash("sha256").update(readFileSync(helper)).digest("hex")}`;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const cases = [
  ["day denied", "2026-11-08T21:00:00Z", ac, "outside-window"],
  ["night allowed", "2026-11-09T02:00:00Z", ac, "eligible"],
  ["morning boundary denied", "2026-11-09T13:00:00Z", ac, "outside-window"],
  ["summer night", "2026-07-20T01:00:00Z", ac, "eligible"],
  ["summer morning", "2026-07-20T12:00:00Z", ac, "outside-window"],
  ["DST fall first 1am", "2026-11-01T06:00:00Z", ac, "eligible"],
  ["DST fall second 1am", "2026-11-01T07:00:00Z", ac, "eligible"],
  ["DST spring jump", "2026-03-08T08:00:00Z", ac, "eligible"],
  ["battery denied", "2026-11-09T02:00:00Z", () => "Now drawing from 'Battery Power'\n", "battery"],
  ["unknown power denied", "2026-11-09T02:00:00Z", () => "unrecognized", "power-unknown"],
  ["failed power probe denied", "2026-11-09T02:00:00Z", () => { throw Error("synthetic"); }, "power-unknown"],
] as const;
for (const [name, date, power, reason] of cases) it(`${name}: the worker makes zero forbidden claim requests`, async () => {
  const stop = new AbortController(); const claim = vi.fn(async () => null);
  const gate = () => nasEligibility("yuri", fleet, helper, expected, { now: at(date), power });
  expect(gate().reason).toBe(reason);
  await runWorker({ claim } as unknown as FleetClient, { caps: [], handlers: {}, outDir: root, signal: stop.signal,
    canClaim: () => gate().eligible, onEvent: () => stop.abort() });
  expect(claim).toHaveBeenCalledTimes(reason === "eligible" ? 1 : 0);
});
it("fails closed on pause, resource reservation, helper drift/missing and unsupported identity", () => {
  const local = { now: at("2026-11-09T02:00:00Z"), power: ac };
  writeFileSync(join(fleet, "paused"), "");
  expect(nasEligibility("yuri", fleet, helper, expected, local).reason).toBe("paused");
  rmSync(join(fleet, "paused")); writeFileSync(join(fleet, "resource-busy"), "");
  expect(nasEligibility("yojimbo", fleet, helper, expected, local).reason).toBe("resource-busy");
  rmSync(join(fleet, "resource-busy")); writeFileSync(helper, "changed helper bytes");
  expect(nasEligibility("yuri", fleet, helper, expected, local).reason).toBe("helper-changed");
  rmSync(helper);
  expect(nasEligibility("yojimbo", fleet, helper, expected, local).reason).toBe("helper-unavailable");
  expect(nasEligibility("unknown", fleet, helper, expected, local).reason).toBe("unsupported-worker");
});
it("bounds an owner daytime exception to today's Chicago midnight, never bypassing AC", () => {
  const file = join(fleet, "daytime-exception.json");const now = at("2026-11-08T21:00:00Z");
  writeFileSync(file, JSON.stringify({ until: "2026-11-09T06:00:00Z" }));
  expect(nasEligibility("yuri", fleet, helper, expected, { now, power: ac }).reason).toBe("daytime-exception");
  expect(nasEligibility("yuri", fleet, helper, expected, { now, power: () => "Now drawing from 'Battery Power'" }).eligible).toBe(false);
  for (const until of ["2026-11-08T20:59:59Z", "2026-11-10T06:00:00Z", "invalid"]) {
    writeFileSync(file, JSON.stringify({ until }));
    expect(nasEligibility("yuri", fleet, helper, expected, { now, power: ac }).eligible).toBe(false);
  }
});
it("rejects duplicate resource holders, then admits a new holder after release", async () => {
  // Use a fixed test-only loopback slot; both production entrypoints use the same host slot.
  const release = await acquireNasSlot(48789);
  try { await expect(acquireNasSlot(48789)).rejects.toMatchObject({ code: "EADDRINUSE" }); }
  finally { await release(); }
  await (await acquireNasSlot(48789))();
});
