import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageStore, sha256Hex } from "../src/ledger/images.ts";
import { withFleetInputs } from "../src/run/fleet-inputs.ts";
import { readVisionHandler } from "../src/run/job-kinds.ts";
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "fleet-auto-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const bytes = Buffer.from("synthetic input");
const claim = { key: "a".repeat(64), fence: 1, leaseExpires: 100, kind: "read-vision", inputs: [sha256Hex(bytes)], params: { requests: [{ id: "fixture", polygon: [[0,0],[9,0],[9,9],[0,9]], rotations: [0] }] }, payload: null, code: "synthetic-helper" };
const context = (root: string) => ({ signal: new AbortController().signal, outDir: join(root, "attempts") });
it("downloads to an empty host store, executes the Bookcase handler, then reuses verified cache", async () => {
  const images = new ImageStore(root);
  const downloadInput = vi.fn(async () => bytes);
  const handler = withFleetInputs({ downloadInput }, images, readVisionHandler({
    binary: process.execPath, args: [fileURLToPath(new URL("./support/fake-ocr-helper.mjs", import.meta.url)), "echo"],
    helperId: "synthetic-helper", resolveImage: hash => images.find(hash),
  }));
  await expect(handler(claim, context(root))).resolves.toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(images.verify(claim.inputs[0]!)).toBe(true);
  await handler({ ...claim, fence: 2 }, context(root));
  expect(downloadInput).toHaveBeenCalledTimes(1);
});
it("never invokes a handler after a corrupt or interrupted transfer; repairs a corrupt cache", async () => {
  const images = new ImageStore(root);
  const run = vi.fn();
  const failure = withFleetInputs({ downloadInput: async () => { throw new Error("input-mismatch"); } }, images, run);
  await expect(failure(claim, context(root))).rejects.toThrow("input-mismatch");
  expect(images.has(claim.inputs[0]!)).toBe(false);
  expect(run).not.toHaveBeenCalled();
  const stored = images.put(bytes, "blob");
  const { chmodSync } = await import("node:fs");
  chmodSync(stored.path, 0o600); writeFileSync(stored.path, "corrupt");
  const repaired = withFleetInputs({ downloadInput: async () => bytes }, images, run);
  await repaired(claim, context(root));
  expect(images.verify(stored.hash)).toBe(true);
  const abort = new AbortController(); abort.abort();
  const fresh = new ImageStore(join(root, "fresh"));
  await expect(withFleetInputs({ downloadInput: async () => bytes }, fresh, run)(claim, { ...context(root), signal: abort.signal })).rejects.toMatchObject({ code: "interrupted" });
  expect(fresh.has(stored.hash)).toBe(false);
});

it("rejects a real mid-stream disconnect without committing cache bytes, then retries verified content", async () => {
  const { createServer } = await import("node:http");
  const { generateToken } = await import("../src/run/vendor/fleet-runner/auth.ts");
  const { fleetClient } = await import("../src/run/vendor/fleet-runner/client.ts");
  const key = join(root, "synthetic-credential"); generateToken(key);
  let interrupt = true;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-length": bytes.length, connection: "close" });
    if (interrupt) { response.write(bytes.subarray(0, 3)); setImmediate(() => response.destroy()); }
    else response.end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = fleetClient(`http://127.0.0.1:${(server.address() as { port: number }).port}`, "synthetic", key);
  const images = new ImageStore(root);const handler = vi.fn(async () => ({ file: "synthetic", sha256: "synthetic" }));
  const wrapped = withFleetInputs(client, images, handler);
  try {
    await expect(wrapped(claim, context(root))).rejects.toThrow();
    expect(images.has(claim.inputs[0]!)).toBe(false);expect(handler).not.toHaveBeenCalled();
    interrupt = false; await wrapped(claim, context(root));
    expect(images.verify(claim.inputs[0]!)).toBe(true);expect(handler).toHaveBeenCalledOnce();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
