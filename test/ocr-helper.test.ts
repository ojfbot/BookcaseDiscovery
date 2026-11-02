import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { helperSchemaErrors } from "../src/ledger/schemas.ts";
import {
  OcrHelperError,
  defaultOcrBinary,
  ocrBinaryAvailable,
  runOcr,
  type OcrRequest,
} from "../src/perceive/ocr.ts";

const fake = fileURLToPath(new URL("./support/fake-ocr-helper.mjs", import.meta.url));
const asFake = (mode: string, timeoutMs?: number) => ({
  binary: process.execPath,
  args: [fake, mode],
  ...(timeoutMs ? { timeoutMs } : {}),
});
const req = (id: string, rotations: OcrRequest["rotations"] = [0, 90]): OcrRequest => ({
  id,
  image: "/synthetic/working-copy.jpg",
  polygon: [
    [10, 10],
    [50, 10],
    [50, 200],
    [10, 200],
  ],
  rotations,
});

// The wrapper against a stand-in helper: runs everywhere, Linux CI included.
describe("runOcr (wrapper, stand-in helper)", () => {
  it("returns responses in request order whatever order the helper answers in", async () => {
    const out = await runOcr([req("a"), req("b"), req("c")], asFake("echo"));
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    const first = out[0]!;
    expect("variants" in first && first.variants.map((v) => `${v.rotation}/${v.langCorrection}`)).toEqual([
      "0/false",
      "0/true",
      "90/false",
      "90/true",
    ]);
  });

  it("keeps a per-spine error as a response and still answers the others", async () => {
    const out = await runOcr([req("a"), req("bad"), req("c")], asFake("error-one"));
    expect(out.map((r) => ("error" in r ? "error" : "ok"))).toEqual(["ok", "error", "ok"]);
    expect("error" in out[1]! && out[1].error.code).toBe("image-unreadable");
  });

  it("answers an empty call without spawning", async () => {
    expect(await runOcr([], { binary: "/does/not/exist" })).toEqual([]);
  });

  it("refuses an invalid or duplicate request before spawning", async () => {
    await expect(runOcr([{ ...req("a"), rotations: [45] as never }], asFake("echo"))).rejects.toThrow();
    await expect(runOcr([req("a"), req("a")], asFake("echo"))).rejects.toThrow(/unique/);
  });

  it.each([
    ["crash", /exited with code 3.*boom/],
    ["garbage", /not JSON/],
    ["wrong-id", /not requested/],
    ["duplicate", /twice/],
    ["silent", /without answering every request/],
  ])("rejects when the helper misbehaves: %s", async (mode, message) => {
    const p = runOcr([req("a")], asFake(mode));
    await expect(p).rejects.toBeInstanceOf(OcrHelperError);
    await expect(runOcr([req("a")], asFake(mode))).rejects.toThrow(message);
  });

  it("rejects a helper that cannot be started", async () => {
    await expect(runOcr([req("a")], { binary: "/no/such/ocr-vision" })).rejects.toThrow(/cannot run helper \(ENOENT\)/);
  });

  it("kills a helper that hangs", async () => {
    await expect(runOcr([req("a")], asFake("hang", 300))).rejects.toThrow(/did not finish within 300 ms/);
  });
});

// The real Swift helper. Needs macOS and `swift build -c release` in helpers/ocr-vision; elsewhere it is
// skipped, and the title says why, so a green `pnpm test` on Linux is not mistaken for a tested helper.
const binary = defaultOcrBinary();
const fixtureTool = join(binary, "..", "ocr-vision-fixture");
const built = ocrBinaryAvailable(binary) && ocrBinaryAvailable(fixtureTool);
const title = built
  ? "ocr-vision helper (real binary, contract)"
  : `ocr-vision helper (SKIPPED: Swift binaries not built at ${binary}; on macOS run "swift build -c release" in helpers/ocr-vision)`;

describe.skipIf(!built)(title, () => {
  const dir = built ? mkdtempSync(join(tmpdir(), "ocr-helper-test-")) : "";
  afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));
  const phrase = "SILVER LANTERN ATLAS";
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const fixture = (name: string, degrees: number): OcrRequest => {
    const line = execFileSync(fixtureTool, [join(dir, `${name}.png`), phrase, String(degrees)], { encoding: "utf8" });
    return { ...(JSON.parse(line) as OcrRequest), id: name };
  };

  it("reads synthetic text at known rotations and answers in the contract's shape", async () => {
    // Drawn 0, 90 and 270 degrees clockwise; the rotation that reads each upright is 0, 270, 90.
    const cases = [
      { name: "upright", drawn: 0, needs: 0 },
      { name: "cw90", drawn: 90, needs: 270 },
      { name: "ccw90", drawn: 270, needs: 90 },
    ];
    const requests = cases.map((c) => fixture(c.name, c.drawn));
    const responses = await runOcr(requests);

    for (const r of responses) expect(helperSchemaErrors("ocr-response", r)).toEqual([]);
    for (const c of cases) {
      const r = responses.find((x) => x.id === c.name)!;
      if ("error" in r) throw new Error(`${c.name}: ${r.error.code}`);
      expect(r.variants).toHaveLength(6);
      expect(r.version.helper).toMatch(/^ocr-vision\//);
      expect(r.version.os).toMatch(/^macOS /);
      for (const langCorrection of [false, true]) {
        const v = r.variants.find((x) => x.rotation === c.needs && x.langCorrection === langCorrection)!;
        expect(squash(v.text), `${c.name} ${langCorrection}`).toBe(squash(phrase));
        expect(v.confidence).toBeGreaterThan(0.5);
      }
    }
  });

  it("answers an unreadable image with an error for that id and keeps going", async () => {
    const good = fixture("good", 0);
    const bad: OcrRequest = { ...good, id: "bad", image: join(dir, "missing.png") };
    const out = await runOcr([bad, good]);
    expect(helperSchemaErrors("ocr-response", out[0])).toEqual([]);
    expect("error" in out[0]! && out[0].error.code).toBe("image-unreadable");
    expect("variants" in out[1]!).toBe(true);
  });
});
