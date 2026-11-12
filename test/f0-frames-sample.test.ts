// F-0 on frames: a sample part (`<session>.every-<n>`) runs a fixed, evenly spaced sample of a session's image list
// through the stages under its own cache names, so a pilot never mixes with the whole session's caches; it is never a
// declared set, so it is never exported or trained on. pilot-000's and the whole session's paths and lists are unchanged.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptSet, samplePart, sessionImages, setPaths, STAGES, type SetPaths, type Stage } from "../src/eval/set-paths.ts";
import { assertManifestable, assertTrainable, SET_REGISTRY, type SetRegistry } from "../src/eval/set-roles.ts";

const ROOT = "/data-root";
const reg: SetRegistry = { ...SET_REGISTRY, "test-store-009": "training-source" };
type PathKey = Exclude<keyof SetPaths, "set" | "kind" | "image">;
const pathsOf = (p: SetPaths): Record<PathKey, string> => {
  const { set: _s, kind: _k, image: _i, ...rest } = p;
  return rest;
};

/** A temporary data root and repo holding one session of `n` photos, in manifest order. */
function store(n: number): { root: string; repo: string; hashes: string[] } {
  const root = mkdtempSync(join(tmpdir(), "f0-frames-root-"));
  const repo = mkdtempSync(join(tmpdir(), "f0-frames-repo-"));
  const hashes = Array.from({ length: n }, (_, i) => i.toString(16).padStart(4, "0") + "0".repeat(60));
  for (const h of hashes) {
    const dir = join(root, "images", "sha256", h.slice(0, 2), h.slice(2, 4));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${h}.jpg`), "x");
  }
  mkdirSync(join(repo, "fixtures", "test-store-009"), { recursive: true });
  const photos = hashes.map((h) => ({ hash: h, workingCopyHash: h, format: "jpeg", width: 1080, height: 1920, setting: "real-use" }));
  writeFileSync(join(repo, "fixtures", "test-store-009", "manifest.json"), JSON.stringify({ schemaVersion: 1, session: "test-store-009", photos, rejected: [] }));
  return { root, repo, hashes };
}

describe("sample part", () => {
  it("names a declared session and a positive step, and nothing else", () => {
    expect(samplePart("test-store-009.every-30", reg)).toEqual({ session: "test-store-009", every: 30 });
    expect(samplePart("sf-store-001.every-30")).toEqual({ session: "sf-store-001", every: 30 });
    for (const name of ["test-store-009", "test-store-011.every-30", "test-store-009.every-0", "test-store-009.every-", "test-store-009.every-3x", "yardstick.every-2", "pilot-000"]) expect(samplePart(name, reg)).toBeNull();
  });

  it("takes every n-th photo of the session's list, in list order (616 photos, every 30th: 20)", () => {
    const { root, repo, hashes } = store(616);
    const all = sessionImages("test-store-009", root, repo, reg);
    const part = sessionImages("test-store-009.every-30", root, repo, reg);
    expect(all.map((x) => x.id)).toEqual(hashes);
    expect(part.length).toBe(20);
    expect(part.map((x) => x.id)).toEqual(hashes.filter((_, i) => (i + 1) % 30 === 0));
    expect(part[0]!.id).toBe(hashes[29]);
    expect(part.at(-1)!.id).toBe(hashes[599]);
    expect(sessionImages("test-store-009.every-1", root, repo, reg)).toEqual(all);
  });

  it("caches beside the session, never inside it, by the same convention", () => {
    const whole = pathsOf(setPaths("test-store-009", ROOT, reg));
    const part = setPaths("test-store-009.every-30", ROOT, reg);
    expect(part.kind).toBe("session");
    for (const [k, v] of Object.entries(pathsOf(part)) as [PathKey, string][]) {
      if (k === "catalog") expect(v).toBe(whole.catalog);
      else {
        expect(v).toBe(whole[k].replaceAll("test-store-009", "test-store-009.every-30"));
        expect(v.startsWith(`${whole[k]}/`)).toBe(false);
        expect(v).not.toBe(whole[k]);
      }
    }
  });

  it.each(Object.keys(STAGES) as Stage[])("%s accepts a declared session's sample part and refuses an undeclared one's", (stage) => {
    expect(acceptSet(stage, "test-store-009.every-30", reg)).toBe("test-store-009.every-30");
    expect(() => acceptSet(stage, "test-store-011.every-30", reg)).toThrow(/not a declared set/);
  });

  it("is never exported, trained on or manifested (it is not declared)", () => {
    expect(() => assertTrainable("sf-store-001.every-30")).toThrow(/no declared set role/);
    expect(() => assertManifestable("sf-store-001.every-30")).toThrow(/no declared set role/);
  });

  it("leaves pilot-000's and the whole session's lists and paths as they were", () => {
    const { root, repo, hashes } = store(5);
    expect(sessionImages("test-store-009", root, repo, reg).map((x) => x.id)).toEqual(hashes);
    expect(setPaths("pilot-000", ROOT).f0).toBe(join(ROOT, "f0", "pilot-000"));
    expect(setPaths("pilot-000", ROOT).q2bImages).toBe(join(ROOT, "private", "q1", "features", "pilot-000.images.jsonl"));
    expect(setPaths("sf-store-001", ROOT).f0).toBe(join(ROOT, "f0", "sf-store-001"));
  });
});

describe("F0-frames aggregates (src/eval/f0-frames-cli.ts)", async () => {
  const { acceptedBoxes, copyGroupSpan, differences, frameCount, mix, quantile, recurrence, sampleScope, spread, timing } = await import("../src/eval/f0-frames-cli.ts");

  it("counts copy groups and those spanning more than one frame", () => {
    const rows = [
      { id: "a:1", group: 1 }, { id: "a:2", group: 1 },
      { id: "a:5", group: 2 }, { id: "b:0", group: 2 }, { id: "c:3", group: 2 },
    ];
    expect(copyGroupSpan(rows)).toEqual({ groups: 2, groupedBoxCount: 5, multiFrameGroups: 1, boxesInMultiFrameGroups: 3, groupsBySize: { "2": { count: 1, share: 0.5 }, "3": { count: 1, share: 0.5 } } });
  });

  it("measures work recurrence across frames, not within one", () => {
    const r = recurrence([{ id: "a:1", workId: "w1" }, { id: "a:2", workId: "w1" }, { id: "b:0", workId: "w2" }, { id: "c:0", workId: "w2" }, { id: "c:1", workId: "w3" }]);
    expect(r).toEqual({ acceptedBoxCount: 5, acceptedWorks: 3, worksInTwoOrMoreFrames: 1, acceptedBoxesRecurring: 2, acceptedBoxesRecurringShare: 0.4 });
  });

  it("takes each accepted box's work from F-0c's accepted work id, so recurrence counts works, not one bucket", () => {
    const ds = [{ id: "a:1", accepted: "w1" }, { id: "a:2", accepted: null }, { id: "b:0", accepted: "w1" }, { id: "c:0", accepted: "w2" }];
    expect(acceptedBoxes(ds)).toEqual([{ id: "a:1", workId: "w1" }, { id: "b:0", workId: "w1" }, { id: "c:0", workId: "w2" }]);
    expect(recurrence(acceptedBoxes(ds))).toMatchObject({ acceptedWorks: 2, worksInTwoOrMoreFrames: 1, acceptedBoxesRecurring: 2 });
  });

  it("summarises lists and mixes", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(spread([2, 4])).toMatchObject({ count: 2, mean: 3, min: 2, max: 4 });
    expect(mix(["x", "y", "x"], (s) => s)).toEqual({ x: { count: 2, share: 0.6667 }, y: { count: 1, share: 0.3333 } });
  });

  it("differences only rates, means and per-frame figures", () => {
    const a = { n: 10, s: { share: 0.5, count: 4 }, r: { vision: { withTextShare: 0.2 } }, m: { "single-reader": { count: 1, share: 0.1 } } };
    const b = { n: 20, s: { share: 0.25, count: 9 }, r: { vision: { withTextShare: 0.5 } }, m: { "single-reader": { count: 3, share: 0.3 } } };
    expect(differences(a, b)).toEqual({ s: { share: -0.25 }, r: { vision: { withTextShare: 0.3 } }, m: { "single-reader": { share: 0.2 } } });
  });

  it("states what part of its session a sample part covers, and nothing for a whole set", () => {
    const frames = (s: string) => (s === "sf-store-001" ? 616 : 205);
    expect(sampleScope("sf-store-001.every-3", frames)).toEqual({ session: "sf-store-001", every: 3, frames: 205, sessionFrames: 616, frameShare: 0.3328 });
    expect(sampleScope("pilot-000", frames)).toBeNull();
    expect(sampleScope("sf-store-001", frames)).toBeNull();
  });

  it("counts a sample part's frames from its session's list, and a set's from its manifest", () => {
    const { root, repo } = store(616);
    // The registry is the shipped one here, so the temporary session is named by a declared session's sample part.
    mkdirSync(join(repo, "fixtures", "sf-store-001"), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(repo, "fixtures", "test-store-009", "manifest.json"), "utf8")) as { session: string };
    writeFileSync(join(repo, "fixtures", "sf-store-001", "manifest.json"), JSON.stringify({ ...manifest, session: "sf-store-001" }));
    expect(frameCount("sf-store-001", root, repo)).toBe(616);
    expect(frameCount("sf-store-001.every-3", root, repo)).toBe(205);
    expect(frameCount("sf-store-001.every-30", root, repo)).toBe(20);
  });

  it("projects the pilot linearly in frames and sets it beside the full run", () => {
    const pilot = [{ step: "1", name: "F-0", seconds: 100, maxRssBytes: 2 ** 21, exit: 0 }];
    const t = timing(pilot, [{ step: "1", name: "F-0", seconds: 3000, maxRssBytes: null, exit: 0 }], 20, 616);
    expect(t.rows[0]).toMatchObject({ pilotSeconds: 100, projectedSeconds: 3080, fullSeconds: 3000, pilotPeakResidentMb: 2 });
    expect(t.totals).toEqual({ pilotSeconds: 100, projectedSeconds: 3080, fullSeconds: 3000 });
    expect(timing(pilot, null, 20, 616).totals.fullSeconds).toBeNull();
  });
});
