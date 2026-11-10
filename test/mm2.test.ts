import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertUnchanged, bookKey, countOf, lookalikeKind, MM2, newAccept, ShadowRow, shareOf, stressPairs } from "../src/eval/mm2.ts";

const CLI = fileURLToPath(new URL("../src/eval/mm2-cli.ts", import.meta.url));
const sim = { acceptedId: null, agreeing: [], reason: "single-reader" as const, takers: [] };
const row = (over: Partial<ShadowRow> = {}): ShadowRow => ({
  schemaVersion: MM2.schemaVersion,
  id: "img:0",
  set: "pilot-000",
  split: "val",
  group: "sg:1",
  photo: 0,
  f0: { accepted: null, agreeing: [], reason: "single-reader", readText: { vision: true }, top: { vision: "w" }, confirmed: { vision: "w" }, right: null },
  label: null,
  inGallery: false,
  validStrip: true,
  gallery: { nearest: null, near: 0, nearOnly: [], matches: [], proposal: null, proposalRight: null, simulated: sim, simulatedRight: null },
  free: null,
  stress: { siglip2: [], dinov2: [] },
  ...over,
});

describe("bookKey", () => {
  it("is one book's own title form and primary surname, so two records of one book share it", () => {
    expect(bookKey("T:dune|V:dune 1", ["Frank Herbert"])).toBe(bookKey("T:dune", ["F. Herbert"]));
    expect(bookKey("T:dune", ["Frank Herbert"])).not.toBe(bookKey("T:dune", ["Kevin J. Anderson"]));
    expect(bookKey("T:dune", ["Frank Herbert"])).not.toBe(bookKey("T:dune messiah", ["Frank Herbert"]));
  });
});

describe("lookalikeKind", () => {
  it("names a namesake, a same-author book, or an unrelated one, and unknown with no query book", () => {
    const k = (t: string, s: string) => bookKey(`T:${t}`, [s]);
    expect(lookalikeKind(k("dune", "Frank Herbert"), k("dune", "Kevin Anderson"))).toBe("namesake");
    expect(lookalikeKind(k("dune", "Frank Herbert"), k("dune messiah", "Frank Herbert"))).toBe("same-author");
    expect(lookalikeKind(k("dune", "Frank Herbert"), k("emma", "Jane Austen"))).toBe("unrelated");
    expect(lookalikeKind(null, k("emma", "Jane Austen"))).toBe("unknown");
  });
});

describe("the shadow row", () => {
  it("parses strictly: an unknown field is refused", () => {
    expect(ShadowRow.parse(row())).toBeTruthy();
    expect(() => ShadowRow.parse({ ...row(), decision: "x" })).toThrow();
  });
  it("assertUnchanged refuses a shadow row whose F-0 decision differs from the cached one", () => {
    const r = row();
    expect(() => assertUnchanged({ accepted: null, agreeing: [], reason: "single-reader", confirmed: { vision: "w" } }, r.f0)).not.toThrow();
    expect(() => assertUnchanged({ accepted: "w", agreeing: [], reason: "single-reader", confirmed: { vision: "w" } }, r.f0)).toThrow(/changes none/);
    expect(() => assertUnchanged({ accepted: null, agreeing: [], reason: "single-reader", confirmed: { vision: "v" } }, r.f0)).toThrow();
  });
  it("newAccept counts only boxes F-0 left unknown that the simulation accepts", () => {
    const acc = { ...sim, acceptedId: "w", agreeing: ["vision" as const, "ppocr" as const], reason: null, takers: ["ppocr" as const] };
    expect(newAccept(row({ gallery: { ...row().gallery!, simulated: acc } }), "gallery")).toBe(true);
    expect(newAccept(row({ f0: { ...row().f0, accepted: "w" }, gallery: { ...row().gallery!, simulated: acc } }), "gallery")).toBe(false);
    expect(newAccept(row(), "free")).toBe(false);
  });
});

describe("measures over query photos", () => {
  const rows = [{ photo: 0, x: 1 }, { photo: 0, x: 0 }, { photo: 1, x: 1 }];
  it("weights a row by its photo's draw count", () => {
    expect(shareOf(rows, () => true, (r) => r.x === 1, [1, 1])).toBeCloseTo(2 / 3);
    expect(shareOf(rows, () => true, (r) => r.x === 1, [0, 2])).toBe(1);
    expect(shareOf(rows, () => false, () => true, [1, 1])).toBeNull();
    expect(countOf(rows, (r) => r.x === 1, [2, 3])).toBe(5);
  });
  it("a stress pair is weighted by its query's photo; the gallery is fixed", () => {
    const r = row({ photo: 3, stress: { siglip2: [{ cos: 0.9, text: 0.2, proposed: false, kind: "unrelated" }], dinov2: [{ cos: 0.7, text: 0 }] } });
    expect(stressPairs([r], "siglip2")).toEqual([{ s: 0.9, a: 3, b: 3, text: 0.2, proposed: false }]);
    expect(stressPairs([r], "dinov2")[0]).toMatchObject({ s: 0.7, a: 3, proposed: false });
  });
});

describe("the runner", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, BOOKCASE_DATA: mkdtempSync(join(tmpdir(), "mm2-")) } });
  it("does nothing with the appearance switch off (the default)", () => {
    const r = run("shadow", "pilot-000");
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/appearance is off/);
  });
  it("refuses candidate and vote", () => {
    expect(run("shadow", "pilot-000", "--appearance", "candidate").status).not.toBe(0);
    expect(run("shadow", "pilot-000", "--appearance", "vote").status).not.toBe(0);
  });
});
