// R-1: the reading profile, the public seeds and the private overlay (INV-18, OC9, OC22, OC33).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SEED_WEIGHTS,
  NODE_WEIGHTS,
  OVERLAY_RELATIONS,
  PROVENANCE_SOURCES,
  ProfileFileSchema,
  PUBLIC_SOURCES,
  RELATIONS,
  SEEDS_PATH,
  SeedsRefusal,
  centreSeeds,
  checkProfileFile,
  coolerAuthors,
  loadProfile,
  mergeOverlay,
  nodeWeight,
  publishProblems,
  readProfileFile,
  seedWeight,
  writeSeeds,
} from "../src/recommend/profile.ts";
import type { Entry, Node, ProfileFile, ResolvedProfile } from "../src/recommend/profile.ts";
import { profileSchemaErrors } from "../src/recommend/schemas.ts";
import { loadVocabulary } from "../src/recommend/vocabulary.ts";
import { disagreements } from "./support/mutants.ts";

const FIXTURES = new URL("./fixtures/profile/", import.meta.url);
const GUARD = fileURLToPath(new URL("../scripts/privacy-guard.mjs", import.meta.url));
const readJson = (url: URL | string): any => JSON.parse(readFileSync(url, "utf8"));
const jsonFiles = (dir: URL) => readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

const seedsJson = readJson(SEEDS_PATH) as ProfileFile;
const nodesExample = readJson(new URL("nodes.example.json", FIXTURES)) as ProfileFile;
const overlayExample = readJson(new URL("overlay.example.json", FIXTURES)) as ProfileFile;
const vocabulary = loadVocabulary();

const tempDirs: string[] = [];
const tmp = (prefix = "profile-") => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

const prov = (source: (typeof PROVENANCE_SOURCES)[number], ref = "test"): Entry["provenance"] => ({ source, ref, date: "2026-01-01" });
const entry = (id: string, relation: Entry["relation"], over: Partial<Entry> = {}): Entry => ({
  id,
  subject: { kind: "author", name: id },
  relation,
  scope: "all-works",
  provenance: prov("owner-statement"),
  ...over,
});
const file = (entries: Entry[] = [], nodes: Node[] = []): ProfileFile => ({ schemaVersion: 1, entries, nodes });
const resolved = (f: ProfileFile): ResolvedProfile => mergeOverlay(f, null);

describe("profile/seeds.json is exactly the owner's stated profile (OC9)", () => {
  it("has the three statements from the 2026-10-31 brief and nothing else", () => {
    expect(seedsJson.nodes).toEqual([]);
    expect(seedsJson.entries.map((e) => [e.subject.kind, e.subject.name, e.relation, e.scope])).toEqual([
      ["author", "William Gibson", "read", "all-works"],
      ["author", "Kim Stanley Robinson", "liked", "all-works"],
      ["author", "Neal Stephenson", "cooler", "all-works"],
    ]);
    for (const e of seedsJson.entries) {
      expect(e.provenance).toEqual({ source: "owner-statement", ref: "owner statement, project brief 2026-10-31", date: "2026-10-31" });
      expect(e.expanded).toBeUndefined();
    }
  });

  it("is valid, sound and publishable, and the writer would produce these exact bytes", () => {
    expect(profileSchemaErrors(seedsJson)).toEqual([]);
    expect(checkProfileFile(readProfileFile(SEEDS_PATH), { vocabulary })).toEqual([]);
    expect(publishProblems(readProfileFile(SEEDS_PATH), { vocabulary })).toEqual([]);
    const out = join(tmp(), "seeds.json");
    writeSeeds(readProfileFile(SEEDS_PATH), out, { vocabulary });
    expect(readFileSync(out, "utf8")).toBe(readFileSync(SEEDS_PATH, "utf8"));
  });
});

describe("contract: contracts/profile.schema.json and Zod agree (OC13)", () => {
  const valid = [
    { name: "profile/seeds.json", value: seedsJson },
    { name: "nodes.example.json", value: nodesExample },
    { name: "overlay.example.json", value: overlayExample },
  ];
  const invalid = jsonFiles(new URL("invalid/", FIXTURES)).map((f) => ({ name: f, value: readJson(new URL(`invalid/${f}`, FIXTURES)) }));

  it.each(valid.map((v) => [v.name, v.value] as const))("%s validates against both", (_n, value) => {
    expect(profileSchemaErrors(value)).toEqual([]);
    expect(ProfileFileSchema.safeParse(value).error?.issues ?? []).toEqual([]);
  });

  it.each(invalid.map((v) => [v.name, v.value] as const))("invalid/%s is rejected by both", (_n, value) => {
    expect(profileSchemaErrors(value).length).toBeGreaterThan(0);
    expect(ProfileFileSchema.safeParse(value).success).toBe(false);
  });

  it("the examples between them use every relation, node shape and expansion field", () => {
    const entries = valid.flatMap((v) => (v.value as ProfileFile).entries);
    expect(new Set(entries.map((e) => e.relation))).toEqual(new Set(["read", "liked", "cooler", "inferred-interest", "unknown"]));
    expect(entries.some((e) => e.expanded)).toBe(true);
    const kinds = new Set(valid.flatMap((v) => (v.value as ProfileFile).nodes.map((n) => n.kind)));
    expect(kinds).toEqual(new Set(["topos", "style", "open-question", "subtheme"]));
  });

  it("the enums in code are the enums in the schema", () => {
    const defs = readJson(new URL("../contracts/profile.schema.json", import.meta.url)).definitions;
    expect([...RELATIONS]).toEqual(defs.Relation.enum);
    expect([...PROVENANCE_SOURCES]).toEqual(defs.Origin.properties.source.enum);
  });

  it("agree on every mutation of every example", () => {
    const { checked, found } = disagreements(valid, (v) => profileSchemaErrors(v).length === 0, (v) => ProfileFileSchema.safeParse(v).success);
    expect(checked).toBeGreaterThan(1000);
    expect(found.slice(0, 10)).toEqual([]);
  });
});

describe("weights: what each relation adds to the centre of taste (taste-model.md §3)", () => {
  it("liked 1.0, read-all 0.6, read-one 0.3; everything else adds nothing", () => {
    expect(DEFAULT_SEED_WEIGHTS).toEqual({ liked: 1.0, readAll: 0.6, readOne: 0.3 });
    expect(seedWeight({ relation: "liked", scope: "all-works" })).toBe(1);
    expect(seedWeight({ relation: "read", scope: "all-works" })).toBe(0.6);
    expect(seedWeight({ relation: "read", scope: "one-work" })).toBe(0.3);
    for (const relation of ["cooler", "not-for-me", "inferred-interest", "unknown"] as const) expect(seedWeight({ relation, scope: "all-works" })).toBe(0);
  });

  it("w_read_all is configurable and moves only the read-all seeds", () => {
    const p = resolved(seedsJson);
    const at = (readAll: number) => Object.fromEntries(centreSeeds(p, { ...DEFAULT_SEED_WEIGHTS, readAll }).map((s) => [s.subject.name, s.weight]));
    expect(at(0.6)).toEqual({ "William Gibson": 0.6, "Kim Stanley Robinson": 1 });
    expect(at(1.0)).toEqual({ "William Gibson": 1, "Kim Stanley Robinson": 1 });
    expect(at(0)).toEqual({ "Kim Stanley Robinson": 1 });
  });

  it("a cooler seed adds nothing to the centre, but is still known as cooler (score penalty in R-2)", () => {
    const p = resolved(seedsJson);
    expect(centreSeeds(p).map((s) => s.subject.name)).not.toContain("Neal Stephenson");
    expect(coolerAuthors(p).map((a) => a.name)).toEqual(["Neal Stephenson"]);
    // whatever the seed weights are, cooler stays out
    for (const readAll of [0.1, 0.6, 1]) {
      expect(centreSeeds(p, { liked: 1, readAll, readOne: 1 }).some((s) => s.relation === "cooler" || s.relation === "not-for-me")).toBe(false);
    }
    const none = centreSeeds(resolved(file([entry("a", "cooler"), entry("b", "not-for-me")])));
    expect(none).toEqual([]);
  });

  it("expanded entries are not seeds: the centre averages within a seed, so expansion must not multiply its weight", () => {
    expect(centreSeeds(resolved(nodesExample)).map((s) => s.id)).toEqual(["seed-a-read", "seed-b-liked"]);
  });

  it("node weights: asserted pull 1.0, hypothesis pull 0.5, rejected -1.0, a push is negated, an open question is 0", () => {
    const node = (over: object) => ({ ...(nodesExample.nodes[0] as object), ...over }) as Node;
    expect(NODE_WEIGHTS).toEqual({ asserted: 1.0, hypothesis: 0.5, rejected: -1.0 });
    expect(nodeWeight(node({ status: "asserted", stance: "pull" }))).toBe(1);
    expect(nodeWeight(node({ status: "hypothesis", stance: "pull" }))).toBe(0.5);
    expect(nodeWeight(node({ status: "asserted", stance: "push" }))).toBe(-1);
    expect(nodeWeight(node({ status: "hypothesis", stance: "push" }))).toBe(-0.5);
    expect(nodeWeight(node({ status: "rejected", stance: "pull" }))).toBe(-1);
  });

  it("an open question has zero weight, whatever its options are", () => {
    const q = nodesExample.nodes.find((n) => n.kind === "open-question")!;
    expect(q.kind === "open-question" && q.options.length).toBeGreaterThan(0);
    expect(nodeWeight(q)).toBe(0);
    const total = (nodes: Node[]) => nodes.reduce((sum, n) => sum + Math.abs(nodeWeight(n)), 0);
    const withQ = nodesExample.nodes;
    expect(total(withQ)).toBe(total(withQ.filter((n) => n.kind !== "open-question")));
  });
});

describe("support: only seed ids or the owner's asserted events (taste-model.md §8)", () => {
  const supportsOf = (f: ProfileFile) => f.nodes.flatMap((n) => (n.kind === "open-question" ? [] : n.support));

  it("no node in any example is backed by anything else, and every seed id resolves", () => {
    for (const f of [seedsJson, nodesExample]) {
      for (const s of supportsOf(f)) expect(["seed", "asserted-event"]).toContain(s.type);
      expect(checkProfileFile(f, { vocabulary })).toEqual([]);
    }
  });

  it("derived evidence (a catalog tag, a SYNTH extraction) cannot be support: the schemas refuse it", () => {
    for (const type of ["catalog-tag", "synth", "derived", "isfdb-tag", "lcsh"]) {
      const bad = structuredClone(nodesExample);
      (bad.nodes[0] as any).support.push({ type, id: "x" });
      expect(profileSchemaErrors(bad).length).toBeGreaterThan(0);
      expect(ProfileFileSchema.safeParse(bad).success).toBe(false);
    }
    const none = structuredClone(nodesExample);
    (none.nodes[0] as any).support = [];
    expect(ProfileFileSchema.safeParse(none).success).toBe(false);
  });

  it("a seed reference that names no seed is a problem (an expanded entry is not a seed)", () => {
    const bad = structuredClone(nodesExample);
    (bad.nodes[0] as any).support = [{ type: "seed", id: "seed-a-read:isfdb:1" }];
    expect(checkProfileFile(bad)).toEqual([expect.stringContaining("not a seed")]);
    (bad.nodes[0] as any).support = [{ type: "seed", id: "nobody" }];
    expect(checkProfileFile(bad)).toEqual([expect.stringContaining("not a seed")]);
  });

  it("kinds must sit on their facet and agree with the vocabulary hierarchy", () => {
    const bad = structuredClone(nodesExample);
    (bad.nodes[0] as any).kind = "idea";
    expect(checkProfileFile(bad)[0]).toMatch(/does not sit on/);
    const sub = structuredClone(overlayExample);
    expect(checkProfileFile(sub, { vocabulary, seedIds: new Set(["seed-a-read"]) })).toEqual([]);
    (sub.nodes[0] as any).kind = "theme"; // climate-institutions has a parent, so it is a subtheme
    expect(checkProfileFile(sub, { vocabulary, seedIds: new Set(["seed-a-read"]) })[0]).toMatch(/subtheme/);
  });
});

describe("the writer refuses anything but the owner's statements (INV-19, taste tree ruling Q4)", () => {
  const owner = () => structuredClone(seedsJson);
  const node = (over: object): Node => ({ ...(structuredClone(nodesExample.nodes[0]) as object), ...over }) as Node;
  const cases: [string, (f: ProfileFile) => void, RegExp][] = [
    ["a chatgpt-export entry", (f) => (f.entries[0]!.provenance.source = "chatgpt-export"), /private, not an owner statement/],
    ["a selfco entry", (f) => (f.entries[1]!.provenance.source = "selfco"), /private, not an owner statement/],
    ["a taste-tree entry", (f) => (f.entries[1]!.provenance.source = "taste-tree"), /private, not an owner statement/],
    ["an inferred-interest entry", (f) => (f.entries[0]!.relation = "inferred-interest"), /not an owner statement/],
    ["an unknown entry", (f) => (f.entries[0]!.relation = "unknown"), /not an owner statement/],
    ["an expanded entry", (f) => f.entries.push({ ...entry("seed-gibson-read:isfdb:1475", "read", { scope: "one-work", subject: { kind: "work", name: "Neuromancer", id: "isfdb:1475" }, expanded: true, expandedFrom: "seed-gibson-read" }) }), /generated at build time/],
    ["a ref naming the private data folder", (f) => (f.entries[0]!.provenance.ref = "<data root>/private/anything"), /private path/],
    ["a ref naming the vault", (f) => (f.entries[0]!.provenance.ref = "from selfco notes"), /private path/],
    ["a ref naming an export", (f) => (f.entries[0]!.provenance.ref = "conversations.json line 4"), /private path/],
    ["an absolute path as ref", (f) => (f.entries[0]!.provenance.ref = ["", "Users", "someone", "notes.md"].join("/")), /private path/],
    ["a SYNTH node", (f) => f.nodes.push(node({ id: "n1", evidence: "SYNTH", status: "asserted", provenance: prov("owner-statement") })), /evidence SYNTH/],
    ["a hypothesis node", (f) => f.nodes.push(node({ id: "n1", evidence: "ASSERTED", status: "hypothesis", provenance: prov("owner-statement") })), /hypothesis stays private/],
    ["an accepted-SYNTH node with taste-tree provenance", (f) => f.nodes.push(node({ id: "n1", evidence: "ASSERTED", status: "asserted", provenance: prov("taste-tree"), support: [{ type: "seed", id: "seed-gibson-read" }] })), /private, not an owner statement/],
    ["an open question", (f) => f.nodes.push({ id: "q1", kind: "open-question", about: "seed-stephenson-cooler", options: ["style:comic-satirical"], status: "open", evidence: "SYNTH", provenance: prov("owner-statement") }), /open question is not an owner statement/],
  ];

  it.each(cases)("refuses %s and writes nothing", (_name, mutate, why) => {
    const f = owner();
    mutate(f);
    const path = join(tmp(), "profile", "seeds.json");
    expect(() => writeSeeds(f, path)).toThrow(SeedsRefusal);
    try {
      writeSeeds(f, path);
    } catch (e) {
      expect((e as SeedsRefusal).problems.join("\n")).toMatch(why);
    }
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.partial`)).toBe(false);
  });

  it("refuses every banned source on every relation, and leaves an existing file untouched", () => {
    const path = join(tmp(), "seeds.json");
    writeSeeds(owner(), path);
    const before = readFileSync(path, "utf8");
    for (const source of PROVENANCE_SOURCES.filter((s) => !(PUBLIC_SOURCES as readonly string[]).includes(s))) {
      for (const relation of RELATIONS) {
        const f = file([entry("x", relation, { provenance: prov(source) })]);
        expect(() => writeSeeds(f, path), `${source}/${relation}`).toThrow(SeedsRefusal);
      }
    }
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("accepts an owner-stated node (ASSERTED, asserted or rejected) and the stated relations", () => {
    const f = owner();
    f.nodes.push(node({ id: "n-ok", evidence: "ASSERTED", status: "asserted", provenance: prov("owner-statement"), support: [{ type: "seed", id: "seed-gibson-read" }, { type: "asserted-event", id: "taste-asserted-9" }] }));
    f.nodes.push(node({ id: "n-no", termId: "style:comic-satirical", kind: "style", evidence: "ASSERTED", status: "rejected", provenance: prov("owner-correction"), support: [{ type: "asserted-event", id: "taste-rejected-2" }] }));
    f.entries.push(entry("seed-extra", "not-for-me", { provenance: prov("owner-preference", "owner preference, 2026-11-02") }));
    const path = join(tmp(), "seeds.json");
    writeSeeds(f, path, { vocabulary });
    expect(readProfileFile(path)).toEqual(f);
  });

  it("refuses a file that is not even a profile (shape first)", () => {
    expect(() => writeSeeds({ schemaVersion: 1, entries: [{ id: "x" }], nodes: [] } as unknown as ProfileFile, join(tmp(), "s.json"))).toThrow();
  });
});

describe("the Z-1 privacy guard catches what the writer would have refused (INV-19)", () => {
  const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  function guardOn(files: Record<string, string>) {
    const dir = tmp("profile-guard-");
    git(dir, "init", "-q", "-b", "main");
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
    git(dir, "add", "-A", "-f");
    git(dir, "commit", "-q", "-m", "test");
    const res = spawnSync(process.execPath, [GUARD, "--json"], { cwd: dir, encoding: "utf8" });
    const violations = (res.stdout ? JSON.parse(res.stdout).violations : []) as { rule: string; path: string }[];
    return { status: res.status, rules: [...new Set(violations.map((v) => v.rule))].sort(), stdout: res.stdout };
  }

  it("passes the real seeds", () => {
    expect(guardOn({ "profile/seeds.json": readFileSync(SEEDS_PATH, "utf8") })).toMatchObject({ status: 0, rules: [] });
  });

  it.each(["chatgpt-export", "selfco"])("blocks a seeds file with an entry whose provenance is %s, written by hand around the writer", (source) => {
    const f = structuredClone(seedsJson);
    (f.entries[2]!.provenance as { source: string }).source = source;
    expect(() => writeSeeds(f, join(tmp(), "seeds.json"))).toThrow(SeedsRefusal);
    const r = guardOn({ "profile/seeds.json": JSON.stringify(f, null, 2) });
    expect(r.status).toBe(1);
    expect(r.rules).toEqual(["banned-provenance"]);
  });

  it("blocks it on a node too", () => {
    const f = structuredClone(nodesExample);
    (f.nodes[0]!.provenance as { source: string }).source = "chatgpt-export";
    expect(guardOn({ "profile/seeds.json": JSON.stringify(f) }).rules).toEqual(["banned-provenance"]);
  });
});

describe("the overlay: merge and refusal, never promotion (INV-18, OC22)", () => {
  const seeds = readProfileFile(SEEDS_PATH);
  const overlayOf = (entries: Entry[], nodes: Node[] = []) => file(entries, nodes);
  const privateSources = PROVENANCE_SOURCES.filter((s) => !(PUBLIC_SOURCES as readonly string[]).includes(s));

  it("with no overlay, the profile is the seeds", () => {
    const p = mergeOverlay(seeds, null);
    expect(p.entries.map(({ origin, ...e }) => e)).toEqual(seeds.entries);
    expect(p.refused).toEqual([]);
    expect(new Set(p.entries.map((e) => e.origin))).toEqual(new Set(["seeds"]));
  });

  it("never promotes an overlay entry to read or liked, whatever relation and source it claims", () => {
    const claims: Entry[] = [];
    for (const relation of RELATIONS) {
      for (const source of PROVENANCE_SOURCES) claims.push(entry(`ov-${relation}-${source}`, relation, { provenance: prov(source), subject: { kind: "author", name: "Someone" } }));
    }
    const merged = mergeOverlay(seeds, overlayOf(claims));
    const fromOverlay = merged.entries.filter((e) => e.origin === "overlay");
    expect(fromOverlay.length).toBeGreaterThan(0);
    for (const e of fromOverlay) {
      expect(["read", "liked"]).not.toContain(e.relation);
      expect(OVERLAY_RELATIONS as readonly string[]).toContain(e.relation);
      expect(privateSources as readonly string[]).toContain(e.provenance.source);
    }
    // the rest is refused, with a reason, and not coerced into inferred-interest
    const refusedIds = new Set(merged.refused.map((r) => r.id));
    expect(refusedIds.size + fromOverlay.length).toBe(claims.length);
    for (const c of claims) expect(refusedIds.has(c.id) || fromOverlay.some((e) => e.id === c.id)).toBe(true);
    expect(merged.refused.filter((r) => r.reason === "relation-not-allowed-in-overlay").map((r) => r.id)).toContain("ov-read-chatgpt-export");
    expect(merged.refused.filter((r) => r.reason === "relation-not-allowed-in-overlay").map((r) => r.id)).toContain("ov-liked-selfco");
  });

  it("an overlay that names a seed's subject changes nothing about the seed", () => {
    const gibson = seeds.entries.find((e) => e.subject.name === "William Gibson")!;
    const overlay = overlayOf([
      entry("ov-gibson-liked", "liked", { subject: gibson.subject, provenance: prov("chatgpt-export") }),
      entry("ov-gibson-inferred", "inferred-interest", { subject: gibson.subject, provenance: prov("chatgpt-export") }),
      entry(gibson.id, "unknown", { provenance: prov("taste-tree") }), // same id as a seed
    ]);
    const merged = mergeOverlay(seeds, overlay);
    expect(merged.entries.find((e) => e.id === gibson.id)).toEqual({ ...gibson, origin: "seeds" });
    expect(merged.refused.map((r) => [r.id, r.reason])).toEqual([
      ["ov-gibson-liked", "relation-not-allowed-in-overlay"],
      [gibson.id, "id-collision"],
    ]);
    expect(merged.entries.filter((e) => e.subject.name === "William Gibson").map((e) => [e.relation, e.origin])).toEqual([
      ["read", "seeds"],
      ["inferred-interest", "overlay"],
    ]);
  });

  it("the overlay adds nothing to the centre and no cooler author", () => {
    const overlay = overlayOf([
      entry("ov-1", "inferred-interest", { provenance: prov("chatgpt-export") }),
      entry("ov-2", "unknown", { provenance: prov("selfco") }),
    ]);
    const merged = mergeOverlay(seeds, overlay);
    expect(merged.entries).toHaveLength(seeds.entries.length + 2);
    expect(centreSeeds(merged)).toEqual(centreSeeds(mergeOverlay(seeds, null)));
    expect(coolerAuthors(merged)).toEqual(coolerAuthors(mergeOverlay(seeds, null)));
  });

  it("owner-statement sources and expanded entries belong elsewhere", () => {
    const merged = mergeOverlay(
      seeds,
      overlayOf([
        entry("ov-a", "inferred-interest", { provenance: prov("owner-statement") }),
        entry("ov-b", "inferred-interest", { provenance: prov("taste-tree"), subject: { kind: "work", name: "W", id: "isfdb:9" }, scope: "one-work", expanded: true, expandedFrom: "seed-gibson-read" }),
      ]),
    );
    expect(merged.refused.map((r) => r.reason)).toEqual(["owner-source-in-overlay", "expanded-in-overlay"]);
  });

  it("accepts overlay nodes (accepted SYNTH hypotheses stay private and still count) that cite real seeds, and refuses ones that do not", () => {
    const good = overlayExample.nodes[0]!;
    const bad = { ...structuredClone(good), id: "ov-node-bad", support: [{ type: "seed", id: "no-such-seed" }] } as Node;
    const nodeOfSeedsCollision = { ...structuredClone(good), id: "ov-node-accepted" } as Node;
    const merged = mergeOverlay(nodesExample, { ...overlayExample, entries: [], nodes: [{ ...(good as object), support: [{ type: "seed", id: "seed-a-read" }] } as Node, bad, nodeOfSeedsCollision] });
    expect(merged.nodes.filter((n) => n.origin === "overlay").map((n) => n.id)).toEqual(["ov-node-accepted"]);
    expect(merged.refused.map((r) => [r.id, r.reason])).toEqual([
      ["ov-node-bad", "unknown-seed-reference"],
      ["ov-node-accepted", "id-collision"],
    ]);
    const accepted = merged.nodes.find((n) => n.origin === "overlay")!;
    expect(accepted.kind !== "open-question" && accepted.evidence).toBe("SYNTH"); // stays SYNTH: accepting does not make it ASSERTED
    expect(nodeWeight(accepted)).toBe(1); // but it shapes the owner's own picks
  });

  it("loadProfile: a missing overlay file is an empty overlay; one that does not parse is an error", () => {
    const dir = tmp();
    writeFileSync(join(dir, "seeds.json"), readFileSync(SEEDS_PATH));
    expect(loadProfile({ seeds: join(dir, "seeds.json"), overlay: join(dir, "nope.json") }).entries).toHaveLength(3);
    writeFileSync(join(dir, "overlay.json"), JSON.stringify(overlayExample));
    const p = loadProfile({ seeds: join(dir, "seeds.json"), overlay: join(dir, "overlay.json") });
    expect(p.entries.filter((e) => e.origin === "overlay").map((e) => e.relation)).toEqual(["inferred-interest", "unknown"]);
    writeFileSync(join(dir, "overlay.json"), "{ not json");
    expect(() => loadProfile({ seeds: join(dir, "seeds.json"), overlay: join(dir, "overlay.json") })).toThrow();
    writeFileSync(join(dir, "overlay.json"), JSON.stringify({ ...overlayExample, entries: [{ id: "x" }] }));
    expect(() => loadProfile({ seeds: join(dir, "seeds.json"), overlay: join(dir, "overlay.json") })).toThrow();
  });
});

describe("the wall (INV-13): identify does not know the profile", () => {
  it("nothing under src/identify imports recommend or the profile", () => {
    const dir = new URL("../src/identify/", import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      expect(readFileSync(new URL(f, dir), "utf8"), f).not.toMatch(/recommend|profile/i);
    }
  });
});
