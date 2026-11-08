import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workerPlist, workerService } from "../src/run/fleet-service.ts";
import { yuriMayClaim } from "../src/run/fleet-worker-policy.ts";

const ac = () => "Now drawing from 'AC Power'\n";
const date = (iso: string) => new Date(iso);

it("uses the Chicago clock with inclusive start, exclusive end, and daylight saving", () => {
  expect(yuriMayClaim(date("2026-01-20T01:59:59Z"), ac)).toBe(false);
  expect(yuriMayClaim(date("2026-01-20T02:00:00Z"), ac)).toBe(true);
  expect(yuriMayClaim(date("2026-01-20T12:59:59Z"), ac)).toBe(true);
  expect(yuriMayClaim(date("2026-01-20T13:00:00Z"), ac)).toBe(false);
  expect(yuriMayClaim(date("2026-07-20T01:00:00Z"), ac)).toBe(true);
  expect(yuriMayClaim(date("2026-07-20T12:00:00Z"), ac)).toBe(false);
});

it("claims only when external power is confirmed and skips the power probe during the day", () => {
  const night = date("2026-01-20T04:00:00Z");
  const battery = "Now drawing from 'Battery Power'\n";
  for (const answer of [battery, "", `${ac()}${battery}`, "unrecognized"]) {
    expect(yuriMayClaim(night, () => answer)).toBe(false);
  }
  expect(yuriMayClaim(night, () => { throw new Error("probe failed"); })).toBe(false);
  const read = vi.fn(ac);
  expect(yuriMayClaim(date("2026-01-20T20:00:00Z"), read)).toBe(false);
  expect(read).not.toHaveBeenCalled();
});

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "bookcase-service-"));
  env = {
    BOOKCASE_DATA: home,
    BOOKCASE_OCR_VISION: process.execPath,
    FLEET_TOKEN_FILE: join(home, "test-key"),
    FLEET_ENDPOINT: "http://fleet.test:8787",
  };
  writeFileSync(env.FLEET_TOKEN_FILE!, "synthetic key placeholder", { mode: 0o600 });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

it("renders escaped absolute paths and leaves unrelated environment out of launchd", () => {
  const plist = workerPlist(process.execPath, "yuri", {
    ...env,
    BOOKCASE_DATA: join(home, "samples & fixtures"),
    UNRELATED: "unused-value",
  });
  expect(plist).toContain("samples &amp; fixtures");
  expect(plist).toContain("<string>serve-worker</string>");
  expect(plist).toContain("<string>yuri</string>");
  expect(plist).toContain("<key>ExitTimeOut</key><integer>240</integer>");
  expect(plist).not.toContain("unused-value");
  expect(() => workerPlist(process.execPath, "owner", env)).toThrow();
  expect(() => workerPlist("node", "yuri", env)).toThrow();
});

it("installs disabled, starts, reports a sanitized status, then disables and drains", () => {
  const domain = "gui/501";
  const target = `${domain}/org.bookcasediscovery.fleet-worker`;
  const file = join(home, "Library", "LaunchAgents", "org.bookcasediscovery.fleet-worker.plist");
  let loaded = false;
  const launch = vi.fn((args: readonly string[]) => {
    if (args[0] === "print" && args[1] === target) return loaded ? "state = running\nignored service details" : undefined;
    if (args[0] === "bootstrap") loaded = true;
    if (args[0] === "bootout") loaded = false;
    return "";
  });
  const local = { launch, home, uid: 501, node: process.execPath, platform: "darwin" as const };
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(workerService(["install", "yojimbo"], env, local)).toBe(0);
    expect(launch).toHaveBeenCalledWith(["disable", target]);
    expect(readFileSync(file, "utf8")).toContain("<string>yojimbo</string>");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(workerService(["start"], {}, local)).toBe(0);
    expect(launch).toHaveBeenCalledWith(["enable", target]);
    expect(launch).toHaveBeenCalledWith(["bootstrap", domain, file]);
    expect(workerService(["status"], {}, local)).toBe(0);
    expect(output).toHaveBeenLastCalledWith("fleet worker service running");
    expect(workerService(["stop"], {}, local)).toBe(0);
    expect(launch.mock.calls.slice(-2)).toEqual([[["disable", target]], [["bootout", target]]]);
    expect(workerService(["status"], {}, local)).toBe(0);
    expect(output).toHaveBeenLastCalledWith("fleet worker service not loaded");
  } finally {
    output.mockRestore();
  }
});

it("isolates the NAS service label and pins TLS trust and automatic inputs", () => {
  const nas = { ...env, FLEET_SERVICE_PROFILE: "nas", FLEET_ENDPOINT: "https://fleet.test:8788", NODE_EXTRA_CA_CERTS: join(home, "ca.crt") };
  const plist = workerPlist(process.execPath, "yuri", nas);
  expect(plist).toContain("org.bookcasediscovery.fleet-worker.nas");
  expect(plist).toContain("<key>FLEET_AUTO_INPUTS</key><string>1</string>");
  expect(plist).toContain("<key>NODE_EXTRA_CA_CERTS</key>");
  expect(() => workerPlist(process.execPath, "yuri", { ...nas, FLEET_ENDPOINT: "http://fleet.test:8788" })).toThrow();
  expect(() => workerPlist(process.execPath, "yuri", { ...nas, NODE_EXTRA_CA_CERTS: "relative" })).toThrow();
});

it("expires the NAS daytime exception at Chicago midnight and still rejects battery/unknown power", async () => {
  const { daytimeMayClaim } = await import("../src/run/fleet-worker-policy.ts");
  const file = join(home, "daytime.json");
  writeFileSync(file, JSON.stringify({ until: "2026-11-09T06:00:00Z" }));
  expect(daytimeMayClaim(file, new Date("2026-11-08T21:00:00Z"), ac)).toBe(true);
  expect(daytimeMayClaim(file, new Date("2026-11-09T06:00:00Z"), ac)).toBe(false);
  expect(daytimeMayClaim(file, new Date("2026-11-08T21:00:00Z"), () => "Now drawing from 'Battery Power'\n")).toBe(false);
  expect(daytimeMayClaim(file, new Date("2026-11-08T21:00:00Z"), () => "unknown")).toBe(false);
  writeFileSync(file, JSON.stringify({ until: "2026-11-10T06:00:00Z" }));
  expect(daytimeMayClaim(file, new Date("2026-11-08T21:00:00Z"), ac)).toBe(false);
});
