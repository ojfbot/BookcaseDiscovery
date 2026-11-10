import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { generateToken, verifier } from "../src/run/vendor/fleet-runner/auth.ts";
import { fleetClient } from "../src/run/vendor/fleet-runner/client.ts";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "fleet-generation-client-"));
  directories.push(directory);
  const token = join(directory, "private-key");
  generateToken(token);
  copyFileSync(`${token}.pub`, join(directory, "synthetic.pub"));
  const consumed = new Set<string>();
  const verify = verifier(directory, ({ nonce }) => {
    if (consumed.has(nonce)) return false;
    consumed.add(nonce);
    return true;
  });
  return { directory, token, verify };
}

it("generation-binds every signed route while preserving the unset legacy profile", async () => {
  const { token, verify } = fixture();
  const generation = "123e4567-e89b-42d3-a456-426614174000";
  const bytes = Buffer.from("synthetic input bytes");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = "a".repeat(64);
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const target = `${url.pathname}${url.search}`;
    const body = init?.body === undefined ? Buffer.alloc(0) : Buffer.from(init.body as Uint8Array);
    expect(verify(new Headers(init?.headers).get("authorization") ?? undefined, method, target, body)).toBe("synthetic");
    expect(url.searchParams.getAll("generation")).toEqual([generation]);
    requested.push(`${method} ${url.pathname}`);

    if (method === "GET" && url.pathname === `/inputs/${hash}`) {
      return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
    }
    if (url.pathname === "/worker-control" || url.pathname === "/control") {
      return Response.json({ paused: false, revision: 1, intent: "resume" });
    }
    if (url.pathname === "/inputs/" + hash && method === "POST") return Response.json({ received: true });
    if (url.pathname === "/claim") {
      return Response.json({
        key,
        kind: "synthetic",
        inputs: [hash],
        params: {},
        code: null,
        payload: null,
        fence: 1,
        leaseExpires: Date.now() + 60_000,
      });
    }
    if (url.pathname === "/events") return Response.json([]);
    if (url.pathname === "/recovery/release") return Response.json({ released: true });
    if (url.pathname === "/report" && url.searchParams.has("verify")) return Response.json({ verified: true });
    if (url.pathname === "/report") return Response.json({ now: {}, period: {} });
    if (url.pathname === "/status/events") return Response.json({ schemaVersion: 1, cursor: 0, events: [], hasMore: false });
    if (url.pathname === "/status") return Response.json({ schemaVersion: 1 });
    if (url.pathname === "/enqueue") return Response.json({ key, created: true });
    return Response.json(true);
  }));

  const client = fleetClient("https://fleet.synthetic", "synthetic", token, generation);
  await client.status();
  await client.statusEvents(7);
  await client.workerControl();
  await client.control("yuri", "resume");
  await client.presence({ schemaVersion: 1, phase: "idle", eligibility: "eligible", handlers: ["read-vision"], busy: false });
  await client.uploadInput(bytes);
  await expect(client.downloadInput({ key, fence: 1 }, hash)).resolves.toEqual(bytes);
  await client.enqueue({ kind: "synthetic", inputs: [hash], payload: null });
  const claim = await client.claim([], ["synthetic"]);
  expect(claim?.key).toBe(key);
  await client.heartbeat(claim!);
  await client.release(claim!);
  await client.fail(claim!, "SYNTHETIC", true);
  await client.complete(claim!, bytes, hash);
  await client.releaseRecoveryHold("synthetic-recovery-point");
  await client.events();
  await client.report();
  await client.verify(key);

  expect(requested).toEqual(expect.arrayContaining([
    "GET /status", "GET /status/events", "GET /worker-control", "POST /control",
    "POST /worker-status", "POST /inputs/" + hash, "GET /inputs/" + hash,
    "POST /enqueue", "POST /claim", "POST /heartbeat", "POST /release",
    "POST /fail", "POST /complete", "POST /recovery/release", "GET /events", "GET /report",
  ]));
  expect(requested).toHaveLength(17);
  expect(requested.filter((route) => route === "GET /report")).toHaveLength(2);

  const legacyClient = fleetClient("https://fleet.synthetic", "synthetic", token);
  vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input.toString());
    const target = `${url.pathname}${url.search}`;
    const body = init?.body === undefined ? Buffer.alloc(0) : Buffer.from(init.body as Uint8Array);
    expect(verify(new Headers(init?.headers).get("authorization") ?? undefined, init?.method ?? "GET", target, body)).toBe("synthetic");
    expect(url.searchParams.getAll("generation")).toEqual([]);
    return Response.json({ schemaVersion: 1 });
  }));
  await legacyClient.status();
});
