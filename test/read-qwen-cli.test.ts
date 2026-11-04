// `bookcase fleet pins | admit | check` for read-qwen, with the queue client and pin detection mocked.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fleetCommand } from "../src/run/fleet-cli.ts";
import { readQwenCapability, readQwenJob } from "../src/run/read-qwen.ts";
import type { ReadQwenPins } from "../src/run/read-qwen.ts";

const { client, enqueue, detect } = vi.hoisted(() => ({ client: vi.fn(), enqueue: vi.fn(), detect: vi.fn() }));
vi.mock("../src/run/vendor/fleet-runner/client.ts", () => ({ fleetClient: client }));
vi.mock("../src/run/read-qwen.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/run/read-qwen.ts")>()),
  detectReadQwen: detect,
}));

const code = `read-qwen@sha256:${"1".repeat(64)}`;
const model = { repo: "mlx-community/Qwen3-VL-4B-Instruct-8bit" as const, revision: "2".repeat(40), sha256: "3".repeat(64) };
const pins: ReadQwenPins = { code, model, python: "3.12.99", capability: readQwenCapability(code, model.sha256) };
const spec = readQwenJob("4".repeat(64), [{ id: "s0", polygon: [[0, 0], [9, 0], [9, 9], [0, 9]], rotations: [90, 270] }], "rect;rot=fixed;clip=frame", pins);

let dir: string;
let env: NodeJS.ProcessEnv;
let printed: string[];

beforeEach(() => {
  vi.resetAllMocks();
  dir = mkdtempSync(join(tmpdir(), "bcd-read-qwen-cli-"));
  env = { BOOKCASE_DATA: dir, FLEET_TOKEN_FILE: join(dir, "credential"), FLEET_ENDPOINT: "http://fleet.test:8787" };
  client.mockReturnValue({ enqueue });
  detect.mockReturnValue({ ok: true, pins });
  printed = [];
  vi.spyOn(console, "log").mockImplementation((s: string) => void printed.push(s));
  vi.spyOn(console, "error").mockImplementation((s: string) => void printed.push(s));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const file = (name: string, content: string): string => {
  writeFileSync(join(dir, name), content);
  return join(dir, name);
};

it("prints this host's pins, or why read-qwen is unavailable", async () => {
  expect(await fleetCommand(["pins"], env)).toBe(0);
  expect(JSON.parse(printed[0]!)).toEqual(pins);
  expect(detect).toHaveBeenCalledWith({ modelDir: join(dir, "models", "qwen3-vl-4b-8bit") });
  detect.mockReturnValue({ ok: false, reason: "helper-env" });
  expect(await fleetCommand(["pins"], env)).toBe(1);
  expect(printed.at(-1)).toBe("read-qwen unavailable: helper-env");
});

it("admits a read-qwen spec whose pins this host holds, and records its key for verify", async () => {
  enqueue.mockResolvedValue({ key: "5".repeat(64), created: true });
  expect(await fleetCommand(["admit", file("job.json", JSON.stringify(spec))], env)).toBe(0);
  expect(enqueue).toHaveBeenCalledWith(spec);
  expect(client).toHaveBeenCalledWith(env.FLEET_ENDPOINT, "owner", env.FLEET_TOKEN_FILE);
  expect(readFileSync(join(dir, "fleet", "job-key"), "utf8")).toBe("5".repeat(64));
  expect(printed).toEqual(["fleet job enqueued"]);
});

it("refuses a spec that is malformed or pinned to anything this host does not hold", async () => {
  detect.mockReturnValue({ ok: true, pins: { ...pins, model: { ...model, sha256: "6".repeat(64) } } });
  expect(await fleetCommand(["admit", file("job.json", JSON.stringify(spec))], env)).toBe(1);
  detect.mockReturnValue({ ok: false, reason: "model-missing" });
  expect(await fleetCommand(["admit", file("job.json", JSON.stringify(spec))], env)).toBe(1);
  detect.mockReturnValue({ ok: true, pins });
  expect(await fleetCommand(["admit", file("bad.json", JSON.stringify({ ...spec, payload: { image: "/x.jpg" } }))], env)).toBe(1);
  expect(enqueue).not.toHaveBeenCalled();
  expect(printed).toEqual(["fleet job pins do not match this host", "fleet job pins do not match this host", "fleet job is not a valid read-qwen spec"]);
});

it("checks an accepted output against the spec and, optionally, F-0's cache, printing counts only", async () => {
  const variants = [90, 270].map((rotation) => ({ rotation, langCorrection: false, text: "SYNTHETIC", confidence: 1 }));
  const output = file("out.jsonl", JSON.stringify({ id: "s0", variants, version: { helper: code, os: "macOS 0.0.0", requestRevision: 0 } }) + "\n");
  const cache = file("qwen.jsonl", JSON.stringify({ id: "s0", reader: "qwen3-vl-4b-instruct-8bit", crop: "rect;rot=fixed;clip=frame", variants: variants.map(({ langCorrection: _, ...v }) => v), seconds: 1 }) + "\n");
  const job = file("job.json", JSON.stringify(spec));
  expect(await fleetCommand(["check", job, output, cache], env)).toBe(0);
  expect(printed).toEqual(["read-qwen output: 1 readings for 1 requests, 0 reader errors", "contract and order: pass", "cached readings equal: 1 of 1 (0 differ, 0 not cached)"]);
  expect(await fleetCommand(["check", job, file("empty.jsonl", "")], env)).toBe(1);
  expect(printed.join("\n")).not.toContain("SYNTHETIC");
});
