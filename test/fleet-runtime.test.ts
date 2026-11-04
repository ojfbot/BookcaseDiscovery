import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { fleetCommand } from "../src/run/fleet-cli.ts";

const { client, report, runWorker, workOnce, mayClaim } = vi.hoisted(() => ({
  client: vi.fn(),
  report: vi.fn(),
  runWorker: vi.fn(),
  workOnce: vi.fn(),
  mayClaim: vi.fn(),
}));
vi.mock("../src/run/vendor/fleet-runner/client.ts", () => ({ fleetClient: client }));
vi.mock("../src/run/vendor/fleet-runner/worker.ts", () => ({ runWorker, workOnce }));
vi.mock("../src/run/fleet-worker-policy.ts", () => ({ mayClaim }));
vi.mock("../src/run/job-kinds.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/run/job-kinds.ts")>(),
  detectCapabilities: () => ["apple-vision"],
}));

const env = {
  BOOKCASE_DATA: "/synthetic/data",
  FLEET_TOKEN_FILE: "/synthetic/credential",
  FLEET_ENDPOINT: "http://fleet.test:8787",
};

beforeEach(() => {
  vi.resetAllMocks();
  client.mockReturnValue({ report });
});

it("drains the resident worker on SIGTERM and removes its signal listeners", async () => {
  mayClaim.mockReturnValue(false);
  const originalListeners = process.listenerCount("SIGTERM");
  runWorker.mockImplementation(async (_, options) => {
    expect(options.canClaim()).toBe(false);
    expect(options.signal.aborted).toBe(false);
    options.onEvent({ type: "request-error", delayMs: 5000 });
    process.emit("SIGTERM", "SIGTERM");
    expect(options.signal.aborted).toBe(true);
  });
  const data = mkdtempSync(join(tmpdir(), "fleet-runtime-"));
  try {
    expect(await fleetCommand(["serve-worker", "yuri"], { ...env, BOOKCASE_DATA: data })).toBe(0);
    expect(readFileSync(join(data, "fleet", "resident-status"), "utf8")).toBe("request-error\n");
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
  expect(mayClaim).toHaveBeenCalledWith("yuri");
  expect(client).toHaveBeenCalledWith(env.FLEET_ENDPOINT, "yuri", env.FLEET_TOKEN_FILE);
  expect(process.listenerCount("SIGTERM")).toBe(originalListeners);
});

it("preserves a manual one-shot and keeps owner credentials separate", async () => {
  const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    workOnce.mockResolvedValue("completed");
    expect(await fleetCommand(["work", "yuri"], env)).toBe(0);
    expect(workOnce).toHaveBeenCalledOnce();
    expect(mayClaim).not.toHaveBeenCalled();
    expect(runWorker).not.toHaveBeenCalled();
  } finally {
    quiet.mockRestore();
  }
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    client.mockClear();
    expect(await fleetCommand(["serve-worker", "owner"], env)).toBe(1);
    expect(client).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});

it("reports both workers' aggregate state using owner authentication", async () => {
  const summary = {
    now: { byKind: { "read-vision": { ready: 1, claimed: 0, done: 2, failed: 0 } } },
    period: { byWorker: { yuri: { completed: 1 }, yojimbo: { completed: 1 } } },
  };
  report.mockResolvedValue(summary);
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await fleetCommand(["report"], env)).toBe(0);
    expect(client).toHaveBeenCalledWith(env.FLEET_ENDPOINT, "owner", env.FLEET_TOKEN_FILE);
    expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual(summary);
  } finally {
    output.mockRestore();
  }
});
