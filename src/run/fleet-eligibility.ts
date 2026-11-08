import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { daytimeMayClaim, yuriMayClaim } from "./fleet-worker-policy.ts";

export type EligibilityReason = "eligible" | "daytime-exception" | "paused" | "resource-busy" | "outside-window" | "battery" | "power-unknown" | "helper-unavailable" | "helper-changed" | "unsupported-worker";
export interface Eligibility { eligible: boolean; reason: EligibilityReason }
const decision = (reason: EligibilityReason): Eligibility => ({ eligible: reason === "eligible" || reason === "daytime-exception", reason });
const power = () => execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 });
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Checked before every NAS claim, including one-shot commands. Probe failure denies a claim. */
export function nasEligibility(worker: string, fleetDir: string, binary: string, expectedHelper: string,
  local: { now?: () => Date; power?: () => string } = {}): Eligibility {
  if (worker !== "yuri" && worker !== "yojimbo") return decision("unsupported-worker");
  if (existsSync(join(fleetDir, "paused"))) return decision("paused");
  if (existsSync(join(fleetDir, "resource-busy"))) return decision("resource-busy");
  try {
    if (`ocr-vision@sha256:${digest(binary)}` !== expectedHelper) return decision("helper-changed");
  } catch { return decision("helper-unavailable"); }
  if (worker === "yojimbo") return decision("eligible");
  const now = (local.now ?? (() => new Date()))();
  let source: string;
  try { source = (local.power ?? power)(); } catch { return decision("power-unknown"); }
  const sources = source.split(/\r?\n/).filter(line => line.startsWith("Now drawing from "));
  if (sources.length !== 1) return decision("power-unknown");
  if (sources[0] === "Now drawing from 'Battery Power'") return decision("battery");
  if (sources[0] !== "Now drawing from 'AC Power'") return decision("power-unknown");
  if (yuriMayClaim(now, () => source)) return decision("eligible");
  if (daytimeMayClaim(join(fleetDir, "daytime-exception.json"), now, () => source)) return decision("daytime-exception");
  return decision("outside-window");
}

/** One host resource slot across all NAS client invocations; released by the OS on process exit. */
export async function acquireNasSlot(port = 48788): Promise<() => Promise<void>> {
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
