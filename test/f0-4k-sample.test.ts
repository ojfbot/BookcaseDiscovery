// F-0 on 4K: a session that holds both stills and frames (sf-store-003) is sampled by kind. `<session>.stills` takes
// only the stills, `<session>.frames.every-<n>` every n-th frame, both in the order of the session's image list, and a
// frame is told from a still by the private frame list, not by size. Neither part is declared, so neither is exported,
// trained on or manifested; `<session>.every-<n>`, pilot-000's and the yardstick's paths are unchanged.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptSet, samplePart, sessionImages, setPaths, STAGES, YARDSTICK, YARDSTICK_B2, type SetPaths, type Stage } from "../src/eval/set-paths.ts";
import { assertManifestable, assertTrainable, SET_REGISTRY, type SetRegistry } from "../src/eval/set-roles.ts";

const ROOT = "/data-root";
const S = "test-store-009";
const reg: SetRegistry = { ...SET_REGISTRY, [S]: "training-source" };
type PathKey = Exclude<keyof SetPaths, "set" | "kind" | "image">;
const pathsOf = (p: SetPaths): Record<PathKey, string> => {
  const { set: _s, kind: _k, image: _i, ...rest } = p;
  return rest;
};
const hashOf = (i: number) => i.toString(16).padStart(4, "0") + "0".repeat(60);

/**
 * A temporary data root and repo holding one session of `n` photos in manifest order, where photo i is a still when
 * `isStill(i)`. Every photo is given the same size, so only the private frame list can tell the kinds apart.
 */
function store(n: number, isStill: (i: number) => boolean, opts: { frameList?: boolean; listSession?: string } = {}): { root: string; repo: string; hashes: string[]; stills: string[]; frames: string[] } {
  const root = mkdtempSync(join(tmpdir(), "f0-4k-root-"));
  const repo = mkdtempSync(join(tmpdir(), "f0-4k-repo-"));
  const hashes = Array.from({ length: n }, (_, i) => hashOf(i));
  for (const h of hashes) {
    const dir = join(root, "images", "sha256", h.slice(0, 2), h.slice(2, 4));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${h}.jpg`), "x");
  }
  mkdirSync(join(repo, "fixtures", S), { recursive: true });
  const photos = hashes.map((h) => ({ hash: h, workingCopyHash: h, format: "jpeg", width: 2160, height: 3840, setting: "real-use" }));
  writeFileSync(join(repo, "fixtures", S, "manifest.json"), JSON.stringify({ schemaVersion: 1, session: S, photos, rejected: [] }));
  const stills = hashes.filter((_, i) => isStill(i));
  const frames = hashes.filter((_, i) => !isStill(i));
  if (opts.frameList ?? true) {
    mkdirSync(join(root, "private", "fixtures", S), { recursive: true });
    // Two clips, so the list is read across clips; the frame order inside the list does not set the sample's order.
    const half = Math.ceil(frames.length / 2);
    const clip = (fs: string[]) => ({ clipHash: "c", frames: [...fs].reverse().map((frameHash) => ({ frameHash })) });
    writeFileSync(join(root, "private", "fixtures", S, "frames.json"), JSON.stringify({ schemaVersion: 1, session: opts.listSession ?? S, clips: [clip(frames.slice(0, half)), clip(frames.slice(half))] }));
  }
  return { root, repo, hashes, stills, frames };
}

/** sf-store-003's shape: 839 photos, 16 of them stills, spread through the hash-sorted list. */
const STILL_AT = new Set([3, 70, 120, 199, 250, 301, 377, 420, 488, 512, 599, 640, 701, 755, 802, 838]);

describe("sample parts by kind", () => {
  it("names a declared session's stills and every n-th frame, and nothing else", () => {
    expect(samplePart(`${S}.stills`, reg)).toEqual({ session: S, every: 1, kind: "stills" });
    expect(samplePart(`${S}.frames.every-41`, reg)).toEqual({ session: S, every: 41, kind: "frames" });
    expect(samplePart("sf-store-003.stills")).toEqual({ session: "sf-store-003", every: 1, kind: "stills" });
    expect(samplePart("sf-store-003.frames.every-41")).toEqual({ session: "sf-store-003", every: 41, kind: "frames" });
    for (const name of [
      "test-store-011.stills", "test-store-011.frames.every-41", `${S}.frames.every-0`, `${S}.frames.every-`, `${S}.frames`,
      `${S}.stills.every-2`, `${S}.frames.every-3x`, `${S}.stills.frames.every-2`, "yardstick.stills", "pilot-000",
    ]) expect(samplePart(name, reg)).toBeNull();
  });

  it("keeps `<session>.every-<n>` as it was: every n-th photo of either kind", () => {
    expect(samplePart(`${S}.every-30`, reg)).toEqual({ session: S, every: 30 });
    expect(samplePart("sf-store-001.every-3")).toEqual({ session: "sf-store-001", every: 3 });
    const { root, repo, hashes } = store(839, (i) => STILL_AT.has(i));
    expect(sessionImages(`${S}.every-3`, root, repo, reg).map((x) => x.id)).toEqual(hashes.filter((_, i) => (i + 1) % 3 === 0));
    // It does not need the frame list.
    const bare = store(10, () => false, { frameList: false });
    expect(sessionImages(`${S}.every-2`, bare.root, bare.repo, reg)).toHaveLength(5);
  });

  it("takes only the stills, in list order (sf-store-003's shape: 16 of 839)", () => {
    const { root, repo, stills } = store(839, (i) => STILL_AT.has(i));
    const part = sessionImages(`${S}.stills`, root, repo, reg).map((x) => x.id);
    expect(part).toEqual(stills);
    expect(part).toHaveLength(16);
  });

  it("takes every n-th frame, in list order, never a still (823 frames, every 41st: 20)", () => {
    const { root, repo, frames, stills } = store(839, (i) => STILL_AT.has(i));
    expect(frames).toHaveLength(823);
    const part = sessionImages(`${S}.frames.every-41`, root, repo, reg).map((x) => x.id);
    expect(part).toEqual(frames.filter((_, i) => (i + 1) % 41 === 0));
    expect(part).toHaveLength(20);
    expect(part[0]).toBe(frames[40]);
    expect(part.some((id) => stills.includes(id))).toBe(false);
    expect(sessionImages(`${S}.frames.every-1`, root, repo, reg).map((x) => x.id)).toEqual(frames);
    // The stills and the frames partition the session.
    expect(new Set([...sessionImages(`${S}.stills`, root, repo, reg).map((x) => x.id), ...frames]).size).toBe(839);
  });

  it("tells the kinds apart by the frame list, not by size", () => {
    // Every photo here has the frame size, so a size rule would call all of them frames.
    const { root, repo } = store(12, (i) => i % 4 === 0);
    expect(sessionImages(`${S}.stills`, root, repo, reg)).toHaveLength(3);
    expect(sessionImages(`${S}.frames.every-1`, root, repo, reg)).toHaveLength(9);
  });

  it("fails closed without the session's own frame list", () => {
    const none = store(6, () => false, { frameList: false });
    expect(() => sessionImages(`${S}.stills`, none.root, none.repo, reg)).toThrow(/no private frame list/);
    expect(() => sessionImages(`${S}.frames.every-2`, none.root, none.repo, reg)).toThrow(/no private frame list/);
    const other = store(6, () => false, { listSession: "test-store-010" });
    expect(() => sessionImages(`${S}.stills`, other.root, other.repo, reg)).toThrow(/names another session/);
  });

  it("caches beside the session, never inside it, by the same convention", () => {
    const whole = pathsOf(setPaths(S, ROOT, reg));
    for (const name of [`${S}.stills`, `${S}.frames.every-41`]) {
      const part = setPaths(name, ROOT, reg);
      expect(part.kind).toBe("session");
      for (const [k, v] of Object.entries(pathsOf(part)) as [PathKey, string][]) {
        if (k === "catalog") expect(v).toBe(whole.catalog);
        else {
          expect(v).toBe(whole[k].replaceAll(S, name));
          expect(v.startsWith(`${whole[k]}/`)).toBe(false);
          expect(v).not.toBe(whole[k]);
        }
      }
    }
  });

  it.each(Object.keys(STAGES) as Stage[])("%s accepts a declared session's parts by kind and refuses an undeclared one's", (stage) => {
    expect(acceptSet(stage, `${S}.stills`, reg)).toBe(`${S}.stills`);
    expect(acceptSet(stage, `${S}.frames.every-41`, reg)).toBe(`${S}.frames.every-41`);
    expect(() => acceptSet(stage, "test-store-011.stills", reg)).toThrow(/not a declared set/);
    expect(() => acceptSet(stage, "test-store-011.frames.every-41", reg)).toThrow(/not a declared set/);
  });

  it("is never exported, trained on or manifested (it is not declared)", () => {
    for (const name of ["sf-store-003.stills", "sf-store-003.frames.every-41"]) {
      expect(() => assertTrainable(name)).toThrow(/no declared set role/);
      expect(() => assertManifestable(name)).toThrow(/no declared set role/);
    }
  });

  it("leaves pilot-000's, the yardstick's and the whole session's paths as they were", () => {
    expect(setPaths("pilot-000", ROOT).f0).toBe(join(ROOT, "f0", "pilot-000"));
    expect(setPaths("pilot-000", ROOT).q2bImages).toBe(join(ROOT, "private", "q1", "features", "pilot-000.images.jsonl"));
    expect(setPaths("sf-store-003", ROOT).f0).toBe(join(ROOT, "f0", "sf-store-003"));
    expect(setPaths(YARDSTICK, ROOT).f0).toBe(join(ROOT, "f0", YARDSTICK_B2));
    expect(setPaths(YARDSTICK_B2, ROOT).outlines).toBe(join(ROOT, "private", "f0b", YARDSTICK_B2, "outline.jsonl"));
    const { root, repo, hashes } = store(7, (i) => i === 2);
    expect(sessionImages(S, root, repo, reg).map((x) => x.id)).toEqual(hashes);
  });
});
