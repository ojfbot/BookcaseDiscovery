// NS-K2: the stages on the critical path to TS-0 and TS-2 take any declared session (src/eval/set-paths.ts), keep
// pilot-000's and the yardstick's paths as they were, and still never export or train on a held-out or yardstick set.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogPaths } from "../src/catalog/cli.ts";
import { dataRoot } from "../src/ledger/images.ts";
import { SETS as F0C_SETS, setCfg } from "../src/eval/f0c-cli.ts";
import { armPath } from "../src/eval/f0e-cli.ts";
import { Q2B_RUN, sessionInputs } from "../src/eval/q2b-cli.ts";
import { acceptSet, isSession, needs, REAL_USE_SCOPE, sessionImages, sessions, setPaths, STAGES, YARDSTICK, YARDSTICK_B2, YARDSTICK_NAMES, type SetPaths, type Stage } from "../src/eval/set-paths.ts";
import { assertTrainable, SET_REGISTRY, type SetRegistry } from "../src/eval/set-roles.ts";
import { build } from "../src/eval/ts0-cli.ts";
import { assertExportable, type LabelRow } from "../src/eval/ts0.ts";
import { trainRows } from "../src/eval/ts2.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const ROOT = "/data-root";
const STAGE_NAMES = Object.keys(STAGES) as Stage[];
type PathKey = Exclude<keyof SetPaths, "set" | "kind" | "image">;

/**
 * Every path each stage used for pilot-000 and the yardstick before NS-K2, read off the literal tables the CLIs had
 * (ts0-cli SOURCES, ts2-cli SETS, f0c-cli SETS, f0e-cli armPath, h2-cli SETS, f0i-cli SETS, q2b-cli Q2B_RUN, rb1 and
 * nb3-cli F0I_SET, f0f/f0g/f0h/nb3 folders), relative to the data root.
 */
const BEFORE: Record<"pilot-000" | "yardstick", Record<PathKey, string>> = {
  "pilot-000": {
    f0: "f0/pilot-000",
    f0e: "f0e/pilot-000",
    base: "f0e/pilot-000/bands+strips",
    f0eImages: "private/f0e/images-pilot-000.jsonl",
    f0c: "f0c/pilot-000",
    f0fImages: "private/f0f/images-pilot-000.jsonl",
    f0fProbe: "private/f0f/probe-pilot-000.jsonl",
    q2bFeatures: "private/q2b/features/pilot-000.jsonl",
    q2bImages: "private/q1/features/pilot-000.images.jsonl",
    q2bQ1Table: "private/q2b/q1table/pilot-000.jsonl",
    q2bGeometry: "private/q2b/geometry/pilot-000.jsonl",
    q2bTable: "private/q2b/table/pilot-000.jsonl",
    outlines: "private/q2b/outlines/pilot-000.jsonl",
    h2: "private/h2/pilot-000",
    f0g: "private/f0g/pilot-000",
    f0h: "private/f0h/pilot-000",
    f0i: "private/f0i/pilot-000",
    nb3: "private/nb3/pilot-000",
    ts2: "private/ts2/pilot-000",
    catalog: "",
  },
  yardstick: {
    f0: "f0/yardstick-library-b2",
    f0e: "f0e/yardstick",
    base: "f0/yardstick-library-b2",
    f0eImages: "private/f0e/images-yardstick.jsonl",
    f0c: "f0c/yardstick",
    f0fImages: "private/f0f/images-yardstick.jsonl",
    f0fProbe: "private/f0f/probe-yardstick.jsonl",
    q2bFeatures: "private/q1/features/yardstick-library-b2.jsonl",
    q2bImages: "private/q1/features/yardstick-library-b2.images.jsonl",
    q2bQ1Table: "private/q1/table/yardstick-library-b2.jsonl",
    q2bGeometry: "private/q2b/geometry/yardstick-library-b2.jsonl",
    q2bTable: "private/q2b/table/yardstick-library-b2.jsonl",
    outlines: "private/f0b/yardstick-library-b2/outline.jsonl",
    h2: "private/h2/yardstick-library-b2",
    f0g: "private/f0g/yardstick",
    f0h: "private/f0h/yardstick",
    f0i: "private/f0i/yardstick-library-b2",
    nb3: "private/nb3/yardstick",
    ts2: "private/ts2/yardstick",
    catalog: "proxy/library-dataset/f0-inventory-catalog.sqlite",
  },
};

const expected = (set: "pilot-000" | "yardstick", root: string): Record<PathKey, string> =>
  Object.fromEntries(Object.entries(BEFORE[set]).map(([k, v]) => [k, k === "catalog" && !v ? catalogPaths().catalog : join(root, v)])) as Record<PathKey, string>;
const pathsOf = (p: SetPaths): Record<PathKey, string> => {
  const { set: _s, kind: _k, image: _i, ...rest } = p;
  return rest;
};

describe("pilot-000 and the yardstick keep their paths", () => {
  it("resolves every path-table entry for pilot-000 as before", () => {
    expect(pathsOf(setPaths("pilot-000", ROOT))).toEqual(expected("pilot-000", ROOT));
  });

  it.each(YARDSTICK_NAMES)("resolves every path-table entry for the yardstick named %s as before", (name) => {
    expect(pathsOf(setPaths(name, ROOT))).toEqual(expected("yardstick", ROOT));
  });

  it("finds a yardstick photo in the Library Dataset's folder, as every stage did", () => {
    expect(setPaths(YARDSTICK, ROOT).image("x")).toBe(join(ROOT, "proxy", "library-dataset", "images", "x.jpg"));
  });

  it("gives the CLIs' own tables the same paths (F-0c's sets, F-0e's arms, Q-2b's pilot-000 inputs)", () => {
    const root = dataRoot();
    expect(F0C_SETS["pilot-000"]).toEqual({ scope: "real use (OC35): machine agreement, never accuracy (INV-17)", base: join(root, "f0e", "pilot-000", "bands+strips"), f0: join(root, "f0", "pilot-000"), catalog: catalogPaths().catalog, qwenCap: 40 });
    expect(F0C_SETS.yardstick).toMatchObject({ base: join(root, "f0", YARDSTICK_B2), f0: join(root, "f0", YARDSTICK_B2), catalog: join(root, "proxy", "library-dataset", "f0-inventory-catalog.sqlite"), qwenCap: 15 });
    expect(armPath("pilot-000", "base")).toBe(join(root, "f0", "pilot-000", "detect.jsonl"));
    expect(armPath("pilot-000", "bands+strips")).toBe(join(root, "f0e", "pilot-000", "bands+strips", "detect.jsonl"));
    expect(armPath(YARDSTICK, "base")).toBe(join(root, "f0", YARDSTICK_B2, "detect.jsonl"));
    expect(armPath(YARDSTICK, "strips")).toBe(join(root, "f0e", YARDSTICK, "strips", "detect.jsonl"));
    const { keep: _k, ...pilot } = Q2B_RUN.sets["pilot-000"]!;
    expect(pilot).toEqual({
      stage: join(root, "f0e", "pilot-000", "bands+strips"),
      decisions: join(root, "f0c", "pilot-000", "base-decisions.jsonl"),
      features: join(root, "private", "q2b", "features", "pilot-000.jsonl"),
      images: join(root, "private", "q1", "features", "pilot-000.images.jsonl"),
      table: join(root, "private", "q2b", "q1table", "pilot-000.jsonl"),
    });
    // Q-2b's yardstick inputs are Q-2's, untouched.
    expect(Q2B_RUN.sets[YARDSTICK_B2]!.stage).toBe(join(root, "f0", YARDSTICK_B2));
  });

  it("still takes, at each stage, the names it took before", () => {
    const before: Record<Stage, string[]> = {
      "F-0": ["pilot-000"],
      "F-0e": ["pilot-000", YARDSTICK],
      "F-0c": ["pilot-000", YARDSTICK],
      "F-0f": ["pilot-000", YARDSTICK],
      "Q-2b": ["pilot-000"],
      "H-2": ["pilot-000", YARDSTICK_B2],
      "F-0g": ["pilot-000", YARDSTICK],
      "F-0h": ["pilot-000"],
      "F-0i": ["pilot-000", YARDSTICK_B2],
      "NB-3": ["pilot-000", YARDSTICK],
      "RB-1": ["pilot-000", YARDSTICK],
      "TS-0": ["pilot-000"],
      "TS-2": ["pilot-000", YARDSTICK],
    };
    for (const stage of STAGE_NAMES) for (const set of before[stage]) expect(acceptSet(stage, set)).toBe(set);
  });
});

describe("a new session resolves at every stage on the path", () => {
  const reg: SetRegistry = { ...SET_REGISTRY, "test-store-009": "training-source", "test-store-010": "held-out" };

  it.each(STAGE_NAMES)("%s accepts a declared training source and a declared held-out session", (stage) => {
    expect(acceptSet(stage, "test-store-009", reg)).toBe("test-store-009");
    expect(acceptSet(stage, "test-store-010", reg)).toBe("test-store-010");
  });

  it("names every cache by the convention pilot-000 used, with only the session name changed", () => {
    for (const set of ["test-store-009", "test-store-010"]) {
      const p = setPaths(set, ROOT, reg);
      expect(p.kind).toBe("session");
      for (const [k, v] of Object.entries(expected("pilot-000", ROOT)) as [PathKey, string][]) {
        // pilot-000's Q-2b list is Q-1's (the one literal kept); a new session writes its own beside its features.
        const want = k === "q2bImages" ? join(ROOT, "private", "q2b", "features", `${set}.images.jsonl`) : k === "catalog" ? v : v.replaceAll("pilot-000", set);
        expect(pathsOf(p)[k]).toBe(want);
      }
    }
  });

  it("gives the declared sessions today: pilot-000 and both store visits", () => {
    expect(sessions()).toEqual(["pilot-000", "sf-store-001", "sf-store-002"]);
    expect(isSession("sf-store-002")).toBe(true);
    for (const y of YARDSTICK_NAMES) expect(isSession(y)).toBe(false);
  });

  it("lists a session's photos from its manifest and the image store, with no pixel size or EXIF assumed", () => {
    const root = mkdtempSync(join(tmpdir(), "ns-k2-root-"));
    const repo = mkdtempSync(join(tmpdir(), "ns-k2-repo-"));
    const hashes = ["a1", "b2"].map((p) => p + "0".repeat(62));
    for (const [i, h] of hashes.entries()) {
      const dir = join(root, "images", "sha256", h.slice(0, 2), h.slice(2, 4));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${h}.${i ? "heic" : "jpg"}`), "x");
    }
    mkdirSync(join(repo, "fixtures", "test-store-009"), { recursive: true });
    const photo = (h: string) => ({ hash: h, workingCopyHash: h, format: "jpeg", width: 1080, height: 1920, setting: "real-use" });
    writeFileSync(join(repo, "fixtures", "test-store-009", "manifest.json"), JSON.stringify({ schemaVersion: 1, session: "test-store-009", photos: hashes.map(photo), rejected: [] }));
    const list = sessionImages("test-store-009", root, repo, reg);
    expect(list.map((x) => x.id)).toEqual(hashes);
    expect(list[0]!.image).toBe(join(root, "images", "sha256", "a1", "00", `${hashes[0]}.jpg`));
    expect(list[1]!.image.endsWith(".heic")).toBe(true);
    expect(setPaths("test-store-009", root, reg).image(hashes[0]!)).toBe(list[0]!.image);
    // A working copy missing from the store is an error, not a silent gap.
    writeFileSync(join(repo, "fixtures", "test-store-009", "manifest.json"), JSON.stringify({ schemaVersion: 1, session: "test-store-009", photos: [photo("c3" + "0".repeat(62))], rejected: [] }));
    expect(() => sessionImages("test-store-009", root, repo, reg)).toThrow(/missing from the image store/);
    expect(() => sessionImages("test-store-011", root, repo, reg)).toThrow(/not a declared session/);
  });

  it("reads both store visits' public manifests in the repo (counts only)", () => {
    for (const [s, n] of [["sf-store-001", 616], ["sf-store-002", 485]] as const) {
      const m = JSON.parse(readFileSync(join(REPO, "fixtures", s, "manifest.json"), "utf8")) as { session: string; photos: unknown[] };
      expect(m.session).toBe(s);
      expect(m.photos.length).toBe(n);
    }
  });

  it("writes the real-use scope for every session, not only pilot-000", () => {
    expect(setCfg("sf-store-001").scope).toBe(REAL_USE_SCOPE);
    expect(setCfg("sf-store-002").scope).toBe(REAL_USE_SCOPE);
    expect(setCfg("pilot-000").scope).toBe(REAL_USE_SCOPE);
    expect(setCfg(YARDSTICK).scope).toMatch(/^PROXY/);
  });

  it("derives Q-2b's inputs for a session by the same rule as pilot-000's", () => {
    const { keep: _k, ...s } = sessionInputs("sf-store-001");
    const root = dataRoot();
    expect(s).toEqual({
      stage: join(root, "f0e", "sf-store-001", "bands+strips"),
      decisions: join(root, "f0c", "sf-store-001", "base-decisions.jsonl"),
      features: join(root, "private", "q2b", "features", "sf-store-001.jsonl"),
      images: join(root, "private", "q2b", "features", "sf-store-001.images.jsonl"),
      table: join(root, "private", "q2b", "q1table", "sf-store-001.jsonl"),
    });
  });
});

describe("fail closed on what is not a session", () => {
  it.each(STAGE_NAMES)("%s refuses an undeclared name with what it takes", (stage) => {
    expect(() => acceptSet(stage, "sf-store-999")).toThrow(new RegExp(`^${stage}: "sf-store-999" is not a declared set; it takes a session declared in src/eval/set-roles.ts`));
    expect(() => acceptSet(stage, undefined)).toThrow(new RegExp(`^${stage}: name a set`));
  });

  it.each(STAGE_NAMES)("%s refuses a PROXY set and a yardstick name it never took", (stage) => {
    expect(() => acceptSet(stage, "library-dataset")).toThrow(/is a proxy set/);
    for (const y of YARDSTICK_NAMES.filter((n) => !(STAGES[stage] as readonly string[]).includes(n))) expect(() => acceptSet(stage, y)).toThrow(/a yardstick name this stage does not take/);
  });

  it("has no paths for an undeclared name or a PROXY set", () => {
    expect(() => setPaths("sf-store-999", ROOT)).toThrow(/not declared/);
    expect(() => setPaths("library-dataset", ROOT)).toThrow(/a proxy set, not a session/);
  });

  it("every critical-path CLI goes through the one check, under its own stage name", () => {
    const files: Record<Stage, string> = {
      "F-0": "f0-cli.ts", "F-0e": "f0e-cli.ts", "F-0c": "f0c-cli.ts", "F-0f": "f0f-cli.ts", "Q-2b": "q2b-cli.ts", "H-2": "h2-cli.ts",
      "F-0g": "f0g-cli.ts", "F-0h": "f0h-cli.ts", "F-0i": "f0i-cli.ts", "NB-3": "nb3-cli.ts", "RB-1": "rb1.ts", "TS-0": "ts0-cli.ts", "TS-2": "ts2-cli.ts",
    };
    for (const [stage, file] of Object.entries(files) as [Stage, string][]) {
      const src = readFileSync(join(REPO, "src", "eval", file), "utf8");
      // TS-0 gates on assertTrainable (OC35) before it resolves a set's paths.
      if (stage === "TS-0") expect(src).toMatch(/assertTrainable\(set\);\n\s+const src = sourceOf\(set, root\);/);
      else expect(src).toContain(`acceptSet("${stage}"`);
    }
  });
});

describe("OC35 stays closed: a held-out session and the yardstick are run through, never trained on", () => {
  const unexportable = ["sf-store-002", ...Object.entries(SET_REGISTRY).filter(([, r]) => r === "yardstick").map(([s]) => s)];

  it("lets the F-0 stages run the held-out session (it is measured later)", () => {
    for (const stage of ["F-0", "F-0e", "F-0c", "H-2", "F-0i", "NB-3"] as Stage[]) expect(acceptSet(stage, "sf-store-002")).toBe("sf-store-002");
  });

  it.each(unexportable)("TS-0's build refuses %s before it reads anything", (set) => {
    const empty = mkdtempSync(join(tmpdir(), "ns-k2-"));
    expect(() => build([set], empty)).toThrow(/^TS-0: .* never exported for training \(OC35\)/);
    expect(() => assertTrainable(set)).toThrow(/OC35/);
  });

  it.each(unexportable)("TS-0's export guard throws on a row from %s", (set) => {
    const row = { set, split: "train", basis: "readers-agree" } as unknown as LabelRow;
    expect(() => assertExportable([row], { photos: [] } as never)).toThrow(/OC35/);
  });

  it.each(unexportable)("TS-2's training rows throw on %s rather than filtering it out", (set) => {
    const row = { set, basis: "readers-agree", split: "train", readers: ["vision", "ppocr"], strong: true } as unknown as LabelRow;
    expect(() => trainRows([row])).toThrow(new RegExp(`^TS-2: "${set.replace(/[+]/g, "\\+")}" is a (held-out|yardstick) set and is never exported for training \\(OC35\\)`));
  });

  it("still exports the new training source (its caches are what is missing, not its role)", () => {
    const empty = mkdtempSync(join(tmpdir(), "ns-k2-"));
    expect(() => assertTrainable("sf-store-001")).not.toThrow();
    expect(() => build(["sf-store-001"], empty)).toThrow(/no F-0i partition/);
  });
});

describe("a step run before its input exists stops and names the step to run first", () => {
  it("throws with the stage, the set, what is missing and the step, never a path", () => {
    const dir = mkdtempSync(join(tmpdir(), "ns-k2-needs-"));
    expect(() => needs("F-0c", "sf-store-001", "default boxes", join(dir, "detect.jsonl"), "f0e-cli.ts detect --set sf-store-001 --label bands+strips")).toThrow(
      'F-0c: sf-store-001 has no default boxes yet; run `f0e-cli.ts detect --set sf-store-001 --label bands+strips` first (docs/ingest.md, "Stage order")',
    );
    writeFileSync(join(dir, "detect.jsonl"), "");
    expect(() => needs("F-0c", "sf-store-001", "default boxes", join(dir, "detect.jsonl"), "x")).not.toThrow();
  });
});
