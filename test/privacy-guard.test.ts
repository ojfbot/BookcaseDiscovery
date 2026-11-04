// Planted-leak tests for scripts/privacy-guard.mjs (card Z-1, INV-19).
// Every leak is generated here, at test time, in a throwaway git repo under the OS temp dir. Nothing
// planted is committed to this repo: the images are hand-assembled byte strings, not photographs.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const GUARD = fileURLToPath(new URL("../scripts/privacy-guard.mjs", import.meta.url));
const MiB = 1024 * 1024;
const MARKER = "zzmarker"; // must never appear in the guard's output

type Files = Record<string, string | Buffer>;
type Violation = { rule: string; path: string; detail: string; line?: number; commit?: string };

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8" },
  );
}

function newRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "privacy-guard-"));
  tempDirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  return dir;
}

function commit(dir: string, files: Files, message = "test commit", remove: string[] = []): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  for (const path of remove) rmSync(join(dir, path));
  git(dir, "add", "-A", "-f");
  git(dir, "commit", "-q", "--allow-empty", "-m", message);
}

function repoWith(files: Files): string {
  const dir = newRepo();
  commit(dir, files);
  return dir;
}

function guard(dir: string, ...args: string[]) {
  const res = spawnSync(process.execPath, [GUARD, "--json", ...args], { cwd: dir, encoding: "utf8" });
  const report = res.stdout ? (JSON.parse(res.stdout) as { violations: Violation[] }) : { violations: [] };
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, violations: report.violations };
}

const rulesOf = (dir: string, ...args: string[]) => [...new Set(guard(dir, ...args).violations.map((v) => v.rule))].sort();

// --- hand-assembled image bytes --------------------------------------------------------------

/** Little-endian TIFF with one IFD0 entry: the GPSInfo pointer (and a GPS IFD) or an inline Make tag. */
function tiff(gps: boolean): Buffer {
  const b = Buffer.alloc(64);
  b.write("II*\0", 0, "latin1");
  b.writeUInt32LE(8, 4); // IFD0 offset
  b.writeUInt16LE(1, 8); // one entry
  if (gps) {
    b.writeUInt16LE(0x8825, 10); // GPSInfo
    b.writeUInt16LE(4, 12); // LONG
    b.writeUInt32LE(1, 14);
    b.writeUInt32LE(26, 18); // GPS IFD offset
    b.writeUInt32LE(0, 22);
    b.writeUInt16LE(1, 26); // GPS IFD: one tag (GPSLatitudeRef)
    b.writeUInt16LE(1, 28);
    b.writeUInt16LE(2, 30);
    b.writeUInt32LE(2, 32);
    b.write("N\0", 36, "latin1");
  } else {
    b.writeUInt16LE(0x010f, 10); // Make
    b.writeUInt16LE(2, 12); // ASCII
    b.writeUInt32LE(2, 14);
    b.write("A\0", 18, "latin1");
    b.writeUInt32LE(0, 22);
  }
  return b;
}

function jpeg(gps: boolean | "none"): Buffer {
  if (gps === "none") return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0]), Buffer.alloc(8), Buffer.from([0xff, 0xd9])]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff(gps)]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, payload, Buffer.from([0xff, 0xd9])]);
}

function png(gps: boolean): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = tiff(gps);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([sig, len, Buffer.from("eXIf", "latin1"), data, Buffer.alloc(4)]);
}

function heic(gps: boolean): Buffer {
  const head = Buffer.alloc(32);
  head.writeUInt32BE(24, 0);
  head.write("ftypheic", 4, "latin1");
  return Buffer.concat([head, Buffer.from("Exif\0\0", "latin1"), tiff(gps)]);
}

const mp4 = (): Buffer => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42", "latin1"), Buffer.alloc(32)]);

// --- fixtures for the clean tree -----------------------------------------------------------------

const CLEAN: Files = {
  "README.md": "# Project\nNothing private here.\n",
  "src/index.ts": "export const x = 1;\n",
  "docs/plan/notes.md": "Private data lives under the vault (see the OC9 table).\n",
  "test/fixtures/synthetic/spine.jpg": jpeg("none"),
  "test/fixtures/synthetic/exif-no-gps.jpg": jpeg(false),
  "evals/E1/metrics.json": JSON.stringify({ commit: "abc", recall: 0.9, band_distribution: { verified: 3, probable: 2 } }),
  "evals/E1/report.md": "Recall 0.9 (see metrics.json).\n",
  "evals/golden/fragments.jsonl": '{"query":"neuromancer","expect":"work-1"}\n',
  "fixtures/sf-store-001/manifest.json": JSON.stringify({ photos: [{ sha256: "ab", width: 4032, height: 3024, setting: "whole-case", shelf: 2 }] }),
  "profile/seeds.json": JSON.stringify({ entries: [{ title: "Neuromancer", status: "read", provenance: { source: "owner-statement", date: "2026-10-31" } }] }),
};

describe("privacy-guard: clean tree", () => {
  it("passes a tree that follows the OC9 boundary", () => {
    const dir = repoWith(CLEAN);
    const r = guard(dir);
    expect(r.violations).toEqual([]);
    expect(r.status).toBe(0);
    expect(guard(dir, "--history").status).toBe(0);
  });

  it("passes the repo it ships in", () => {
    const root = join(dirname(GUARD), "..");
    const r = spawnSync(process.execPath, [GUARD], { cwd: root, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("rejects an unknown argument with exit code 2", () => {
    const r = spawnSync(process.execPath, [GUARD, "--nope"], { cwd: repoWith(CLEAN), encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});

describe("rule: image, RAW, video and weight types outside test/fixtures/synthetic/", () => {
  const images: [string, Buffer][] = [
    ["photos/shelf.jpg", jpeg("none")],
    ["photos/shelf.JPEG", jpeg("none")],
    ["docs/shelf.png", png(false)],
    ["img/IMG_0001.heic", heic(false)],
    ["raw/IMG_0001.dng", tiff(false)],
    ["raw/shot.cr3", Buffer.from("x")],
  ];
  it.each(images)("rejects %s", (path, content) => {
    expect(rulesOf(repoWith({ [path]: content }))).toContain("image-type");
  });

  it("rejects an image renamed to a text extension (content sniffing)", () => {
    expect(rulesOf(repoWith({ "notes/shelf.txt": jpeg("none") }))).toContain("image-type");
  });

  const videos: [string, Buffer][] = [
    ["clips/sweep.mov", mp4()],
    ["clips/sweep.mp4", mp4()],
    ["clips/sweep.m4v", mp4()],
    ["clips/renamed.dat", mp4()],
  ];
  it.each(videos)("rejects video %s", (path, content) => {
    expect(rulesOf(repoWith({ [path]: content }))).toContain("video-type");
  });

  const weights = ["models/a.pt", "models/a.onnx", "models/a.mlmodel", "models/a.safetensors", "models/a.mlpackage/Data/w.bin", "models/b.mlmodelc/model.mil", "models/C.MLPackage/Data/w.bin"];
  it.each(weights)("rejects weight file %s", (path) => {
    expect(rulesOf(repoWith({ [path]: "w" }))).toContain("weight-type");
  });

  it("allows images under test/fixtures/synthetic/", () => {
    expect(guard(repoWith({ "test/fixtures/synthetic/a.jpg": jpeg("none"), "test/fixtures/synthetic/b.png": png(false) })).violations).toEqual([]);
  });

  it("does not treat a lookalike directory as the synthetic one", () => {
    expect(rulesOf(repoWith({ "test/fixtures/synthetic-extra/a.jpg": jpeg("none") }))).toContain("image-type");
  });
});

describe("rule: EXIF GPS tags, even under an allowed path", () => {
  const withGps: [string, string, Buffer][] = [
    ["jpeg APP1", "test/fixtures/synthetic/gps.jpg", jpeg(true)],
    ["png eXIf", "test/fixtures/synthetic/gps.png", png(true)],
    ["heic Exif item", "test/fixtures/synthetic/gps.heic", heic(true)],
    ["bare tiff", "test/fixtures/synthetic/gps.tif", tiff(true)],
    ["xmp gps property", "test/fixtures/synthetic/xmp.jpg", Buffer.concat([jpeg("none"), Buffer.from('<x exif:GPSLatitude="1"/>')])],
  ];
  it.each(withGps)("rejects %s", (_name, path, content) => {
    const r = guard(repoWith({ [path]: content }));
    expect(r.violations.map((v) => v.rule)).toEqual(["exif-gps"]);
    expect(r.status).toBe(1);
  });

  it("allows an image with Exif but no GPS", () => {
    expect(guard(repoWith({ "test/fixtures/synthetic/a.jpg": jpeg(false) })).violations).toEqual([]);
  });
});

describe("rule: ChatGPT exports", () => {
  it.each(["conversations.json", "data/Conversations.JSON", "a/b/chat.html"])("rejects a file named %s", (path) => {
    expect(rulesOf(repoWith({ [path]: "[]" }))).toContain("chatgpt-export-file");
  });

  it("rejects JSON shaped like an export (mapping + create_time), array or object, any file name", () => {
    const convo = { title: "t", create_time: 1, mapping: {} };
    expect(rulesOf(repoWith({ "data/dump.json": JSON.stringify([convo]) }))).toContain("chatgpt-export-shape");
    expect(rulesOf(repoWith({ "data/dump2.json": JSON.stringify({ wrap: { convo } }) }))).toContain("chatgpt-export-shape");
    expect(rulesOf(repoWith({ "data/dump.jsonl": JSON.stringify(convo) + "\n" }))).toContain("chatgpt-export-shape");
  });

  it("allows JSON that only has one of the two keys", () => {
    expect(guard(repoWith({ "data/a.json": JSON.stringify({ mapping: { a: 1 } }), "data/b.json": JSON.stringify({ create_time: 1 }) })).violations).toEqual([]);
  });
});

describe("rule: public seeds hold owner statements only", () => {
  const owner = { source: "owner-statement", ref: "r", date: "2026-10-31" };
  const cases: [string, unknown][] = [
    ["taste-tree provenance", { entries: [{ id: "a", relation: "liked", provenance: { source: "taste-tree", ref: "r" } }] }],
    ["an expanded entry", { entries: [{ id: "a", relation: "read", expanded: true, provenance: owner }] }],
    ["a SYNTH node", { entries: [], nodes: [{ id: "n", evidence: "SYNTH", provenance: owner }] }],
  ];
  it.each(cases)("rejects %s", (_n, doc) => {
    expect(rulesOf(repoWith({ "profile/seeds.json": JSON.stringify(doc) }))).toContain("public-seeds");
  });

  it("allows owner statements and ASSERTED nodes", () => {
    const doc = { entries: [{ id: "a", relation: "liked", provenance: owner }], nodes: [{ id: "n", evidence: "ASSERTED", provenance: owner }] };
    expect(guard(repoWith({ "profile/seeds.json": JSON.stringify(doc) })).violations).toEqual([]);
  });
});

describe("rule: provenance chatgpt-export or selfco", () => {
  const entries: [string, string, string][] = [
    ["string provenance", "profile/seeds.json", JSON.stringify({ entries: [{ title: "x", provenance: "chatgpt-export" }] })],
    ["object provenance", "profile/seeds.json", JSON.stringify([{ title: "x", provenance: { source: "selfco", ref: "r" } }])],
    ["selfco in jsonl", "data/extra.jsonl", '{"a":1}\n{"deep":{"provenance":{"source":"SelfCo"}}}\n'],
    ["provenance_source", "data/e.json", JSON.stringify({ provenance_source: "chatgpt-export" })],
  ];
  it.each(entries)("rejects %s", (_n, path, content) => {
    expect(rulesOf(repoWith({ [path]: content }))).toContain("banned-provenance");
  });

  it("allows owner-stated provenance", () => {
    expect(guard(repoWith({ "profile/seeds.json": CLEAN["profile/seeds.json"] })).violations).toEqual([]);
  });
});

describe("rule: private-path strings", () => {
  const strings: [string, string][] = [
    ["vault home", "~/" + "selfco/wiki"],
    ["vault dir", "see /" + "selfco/ notes"],
    ["raw inbox", "raw/" + "inbox/export"],
    ["private data dir", "$BOOKCASE_DATA/" + "private/evals"],
    ["user home", "/" + "Users/" + MARKER + "/Desktop"],
  ];
  it.each(strings)("rejects %s, and the report never echoes the match", (_n, text) => {
    const r = guard(repoWith({ "src/leak.ts": `// ${text}\n` }));
    expect(new Set(r.violations.map((v) => v.rule))).toEqual(new Set(["private-path"]));
    expect(r.violations[0]?.line).toBe(1);
    expect(r.stdout).not.toContain(MARKER);
    const human = spawnSync(process.execPath, [GUARD], { cwd: repoWith({ "src/leak.ts": `// ${text}\n` }), encoding: "utf8" });
    expect(human.status).toBe(1);
    expect(human.stderr).not.toContain(MARKER);
    expect(human.stderr).toContain("[private-path] src/leak.ts:1");
  });

  it("rejects the strings in a binary file too", () => {
    const blob = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from("/" + "Users/x")]);
    expect(rulesOf(repoWith({ "data/blob.dat": blob }))).toContain("private-path");
  });

  const exempt = ["docs/plan/anything.md", "docs/privacy.md", "test/privacy-guard.test.ts", "test/fixtures/privacy-guard/sample.txt", "implementation-notes.md"];
  it.each(exempt)("exempts %s from this rule", (path) => {
    expect(guard(repoWith({ [path]: "rule text: ~/" + "selfco and raw/" + "inbox/\n" })).violations).toEqual([]);
  });

  it("exempts only the private-path rule: every other rule still applies in an exempt path", () => {
    const dir = repoWith({
      "docs/plan/conversations.json": "[]",
      "docs/plan/shot.jpg": jpeg("none"),
      "docs/plan/profile.json": JSON.stringify({ provenance: "selfco" }),
    });
    expect(rulesOf(dir)).toEqual(["banned-provenance", "chatgpt-export-file", "image-type"]);
  });

  it("does not exempt a lookalike path", () => {
    expect(rulesOf(repoWith({ "docs/planning/a.md": "~/" + "selfco\n", "docs/privacy.md.bak": "~/" + "selfco\n" }))).toEqual(["private-path"]);
  });
});

describe("rule: evals/ aggregate-only allowlist", () => {
  const metrics = (extra: object = {}) => JSON.stringify({ recall: 0.9, ...extra });

  it("allows evals/<run-id>/metrics.json and report.md, and proxy runs", () => {
    expect(guard(repoWith({ "evals/proxy-P2/metrics.json": metrics(), "evals/proxy-P2/report.md": "ok\n", "evals/proxy-P2/prereg.md": "ok\n", "evals/README.md": "ok\n" })).violations).toEqual([]);
  });

  it.each([
    ["per-spine rows file", "evals/E1/per-spine.jsonl", '{"spine":1,"text":"x"}\n'],
    ["csv detail", "evals/E1/detail.csv", "a,b\n"],
    ["nested detail dir", "evals/E1/detail/spines.json", "{}"],
    ["file directly in evals/", "evals/metrics.json", metrics()],
    ["private evals committed", "private/evals/E1/metrics.json", metrics()],
    ["evals deeper in the tree", "x/evals/E1/metrics.json", metrics()],
    ["golden dir, other file", "evals/golden/rows.jsonl", "{}\n"],
    ["differently-cased evals dir", "Evals/E1/metrics.json", metrics({ spines: [] })],
    ["differently-cased evals dir, detail file", "EVALS/E1/rows.jsonl", "{}\n"],
  ])("rejects %s", (_n, path, content) => {
    expect(rulesOf(repoWith({ [path]: content }))).toContain("evals-allowlist");
  });

  it.each([
    ["spines array", { spines: [{ id: 1 }] }],
    ["ocr text, nested", { strata: { a: { ocr_text: "NEUROMANCER" } } }],
    ["per-spine key, odd casing", { "Per-Spine": [] }],
    ["observations", { observations: [] }],
  ])("rejects metrics.json carrying %s", (_n, extra) => {
    expect(rulesOf(repoWith({ "evals/E1/metrics.json": metrics(extra) }))).toContain("evals-allowlist");
  });

  it("rejects metrics.json that is not valid JSON, and oversized aggregates", () => {
    expect(rulesOf(repoWith({ "evals/E1/metrics.json": "not json" }))).toContain("evals-allowlist");
    expect(rulesOf(repoWith({ "evals/E1/report.md": "x".repeat(300 * 1024) }))).toContain("evals-allowlist");
  });

  it("rejects OCR fields in the golden set", () => {
    expect(rulesOf(repoWith({ "evals/golden/fragments.jsonl": '{"query":"q","ocr_text":"x"}\n' }))).toContain("evals-allowlist");
  });
});

describe("rule: fixture manifest carries no capture time, GPS or store fields", () => {
  it.each([
    ["capture_time", { capture_time: "2026-11-01T10:00:00Z" }],
    ["captureTime nested", { photos: [{ sha256: "a", captureTime: "x" }] }],
    ["gps", { photos: [{ gps: { lat: 1, lon: 2 } }] }],
    ["latitude", { latitude: 1 }],
    ["store_name", { store_name: "x" }],
    ["store", { store: "x" }],
    ["DateTimeOriginal", { photos: [{ DateTimeOriginal: "x" }] }],
  ])("rejects %s", (_n, body) => {
    expect(rulesOf(repoWith({ "fixtures/sf-store-001/manifest.json": JSON.stringify(body) }))).toContain("fixture-manifest");
  });

  it("applies under test/fixtures too, and to manifest variants", () => {
    expect(rulesOf(repoWith({ "test/fixtures/synthetic/manifest.json": JSON.stringify({ capture_time: "x" }) }))).toContain("fixture-manifest");
    expect(rulesOf(repoWith({ "fixtures/a/manifest.private.json": JSON.stringify({ gps: 1 }) }))).toContain("fixture-manifest");
  });

  it("matches the fixtures directory case-insensitively", () => {
    expect(rulesOf(repoWith({ "Fixtures/a/manifest.json": JSON.stringify({ capture_time: "x" }) }))).toContain("fixture-manifest");
  });

  it("does not police manifest.json files outside fixtures/", () => {
    expect(guard(repoWith({ "models/manifest.json": JSON.stringify({ location: "eu" }) })).violations).toEqual([]);
  });
});

describe("rule: binaries over 1 MB outside test/fixtures/synthetic/", () => {
  const big = (): Buffer => Buffer.concat([Buffer.from([0]), Buffer.alloc(2 * MiB, 7)]);

  it("rejects a 2 MB binary", () => {
    expect(rulesOf(repoWith({ "data/blob.bin": big() }))).toEqual(["large-binary"]);
  });

  it("allows a small binary, a large text file, and a large binary under synthetic", () => {
    expect(
      guard(repoWith({ "data/small.bin": Buffer.from([0, 1, 2]), "data/big.txt": "line\n".repeat(400_000), "test/fixtures/synthetic/big.bin": big() })).violations,
    ).toEqual([]);
  });
});

describe("history scan (pnpm guard --history)", () => {
  it("finds a leak that a later commit removed; the tree scan stays clean", () => {
    const dir = repoWith(CLEAN);
    commit(dir, { "src/oops.ts": "// ~/" + "selfco\n", "photos/a.jpg": jpeg("none") }, "add by mistake");
    commit(dir, {}, "remove it again", ["src/oops.ts", "photos/a.jpg"]);
    expect(guard(dir).violations).toEqual([]);
    const h = guard(dir, "--history");
    expect(h.status).toBe(1);
    expect(h.violations.map((v) => v.rule).sort()).toEqual(["image-type", "private-path"]);
    expect(h.violations.every((v) => /^[0-9a-f]{40}$/.test(v.commit ?? ""))).toBe(true);
  });

  it("finds a leak on a branch that is not checked out", () => {
    const dir = repoWith(CLEAN);
    git(dir, "checkout", "-q", "-b", "side");
    commit(dir, { "conversations.json": "[]" });
    git(dir, "checkout", "-q", "main");
    expect(guard(dir).violations).toEqual([]);
    expect(rulesOf(dir, "--history")).toEqual(["chatgpt-export-file"]);
    expect(guard(dir, "--history", "--rev", "main").violations).toEqual([]);
  });

  it("scans commit messages for private paths", () => {
    const dir = repoWith(CLEAN);
    commit(dir, {}, "fix thing\n\nfound it in /" + "Users/" + MARKER + "/x");
    const h = guard(dir, "--history");
    expect(h.violations.map((v) => [v.rule, v.path])).toEqual([["private-path", "(commit message)"]]);
    expect(h.stdout).not.toContain(MARKER);
  });

  it("handles a merge commit and an empty commit", () => {
    const dir = repoWith(CLEAN);
    git(dir, "checkout", "-q", "-b", "side");
    commit(dir, { "src/side.ts": "export {};\n" });
    git(dir, "checkout", "-q", "main");
    commit(dir, { "src/main.ts": "export {};\n" });
    git(dir, "merge", "-q", "--no-ff", "-m", "merge side", "side");
    commit(dir, {}, "empty");
    expect(guard(dir, "--history").status).toBe(0);
  });
});
