// F-0 on frames: a sample part (`<session>.every-<n>`) runs a fixed, evenly spaced sample of a session's image list
// through the stages under its own cache names, so a pilot never mixes with the whole session's caches; it is never a
// declared set, so it is never exported or trained on. pilot-000's and the whole session's paths and lists are unchanged.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
