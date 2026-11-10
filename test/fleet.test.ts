import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageStore, sha256Hex } from "../src/ledger/images.ts";
import { fleetCommand } from "../src/run/fleet-cli.ts";
import { readVisionHandler, readVisionJob } from "../src/run/job-kinds.ts";
import { jobKey } from "../src/run/jobs.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "bookcase-fleet-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("stages a local input and resolves a path-free claim by its keyed hash", async () => {
  const photo = join(root, "fixture.jpg");
  const bytes = Buffer.from("synthetic bytes");
  writeFileSync(photo, bytes);
  const workerRoot = join(root, "worker");
  expect(await fleetCommand(["stage", photo], { BOOKCASE_DATA: workerRoot })).toBe(0);
  const store = new ImageStore(workerRoot);
  expect(store.verify(sha256Hex(bytes))).toBe(true);

  const helperId = "synthetic-helper";
  const spec = readVisionJob(photo, [
    { id: "fixture", polygon: [[0, 0], [9, 0], [9, 9], [0, 9]], rotations: [0] },
  ], helperId, { payload: null });
  const handler = readVisionHandler({
    binary: process.execPath,
    args: [fileURLToPath(new URL("./support/fake-ocr-helper.mjs", import.meta.url)), "echo"],
    helperId,
    resolveImage: (hash) => store.find(hash),
  });
  const ctx = { signal: new AbortController().signal, outDir: join(workerRoot, "attempts") };
  const claim = {
    key: jobKey(spec), fence: 1, leaseExpires: 1,
    kind: spec.kind, inputs: spec.inputs, params: spec.params!, payload: null, code: helperId,
  };
  await expect(handler(claim, ctx)).resolves.toMatchObject({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  await expect(handler({ ...claim, fence: 2, inputs: ["0".repeat(64)] }, ctx))
    .rejects.toMatchObject({ code: "input-missing" });
});

it("keeps the NAS profile read-vision-only at the admission CLI", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await fleetCommand(["nas", "admit", "synthetic-job.json"], { BOOKCASE_DATA: root })).toBe(1);
    expect(error).toHaveBeenCalledWith("NAS profile admits read-vision jobs only");
  } finally {
    error.mockRestore();
  }
});
