import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog/build.ts";
import { buildImprintTable, editionKeys, imprintKey, imprintMatches, publisherKeys } from "../src/catalog/imprint.ts";
import type { Candidate } from "../src/catalog/retrieve.ts";
import type { SpineDecision } from "../src/eval/f0.ts";
import { boxImprint } from "../src/eval/f0d-cli.ts";
import { carries, reorderable, tieBreak, workImprints } from "../src/eval/f0d.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";

describe("imprint keys (publisher normalisation)", () => {
  it("drops business words and parentheticals, keeps short house names", () => {
    expect(imprintKey("Tor Books")).toBe("tor");
    expect(imprintKey("DAW")).toBe("daw");
    expect(imprintKey("Penguin Books (US)")).toBe("penguin");
    expect(imprintKey("The Penguin Press")).toBe("penguin");
    expect(imprintKey("O'Reilly Media")).toBe("oreilly");
    expect(imprintKey("Ediciones B")).toBe("ediciones b"); // what is left would be one letter
    expect(imprintKey("Tom Doherty Associates")).toBe("tor");
    expect(imprintKey("  ")).toBeNull();
    expect(imprintKey(null)).toBeNull();
  });

  it("splits ISFDB's 'Imprint / Publisher' strings into keys", () => {
    expect(publisherKeys("Del Rey / Ballantine")).toEqual(["del rey", "ballantine"]);
    expect(publisherKeys("Puffin / Penguin Books (UK)")).toEqual(["puffin", "penguin"]);
    expect(publisherKeys("")).toEqual([]);
  });

  it("groups an imprint under the houses ISFDB pairs it with, never under a book club", () => {
    const t = buildImprintTable([
      ["Del Rey / Ballantine", 40],
      ["Del Rey", 100],
      ["Tor / SFBC", 50],
      ["Tor", 500],
      ["Roc / Pinnacle", 2], // too few editions to make Pinnacle Roc's parent
      ["Roc", 300],
    ]);
    expect([...(t.parents.get("del rey") ?? [])]).toEqual(["ballantine"]);
    expect(t.parents.has("tor")).toBe(false);
    expect(t.parents.has("roc")).toBe(false);
    expect(editionKeys(t, "Del Rey")).toEqual(["del rey", "ballantine"]);
  });

  it("matches exactly or as a whole-word prefix of 3+ letters", () => {
    expect(imprintMatches("tor", ["tor teen"])).toBe(true);
    expect(imprintMatches("tor", ["tordotcom"])).toBe(false);
    expect(imprintMatches("del rey", ["del rey", "ballantine"])).toBe(true);
    expect(imprintMatches("pe", ["pe ltd"])).toBe(false);
    expect(imprintMatches(null, ["tor"])).toBe(false);
  });
});

describe("box imprint from its rotations", () => {
  const v = (imprint: string | null, imprintFrom: "text" | "logo" | null = "text") => ({ rotation: 90, title: null, author: null, imprint, imprintFrom, parsed: true, seconds: 1 });
  const r = (...variants: ReturnType<typeof v>[]) => ({ id: "x", reader: "q", variants, seconds: 1 });
  it("takes the one key every naming rotation gives, and drops conflicts", () => {
    expect(boxImprint(r(v("Tor Books"), v(null)))).toMatchObject({ key: "tor", from: "text", conflict: false });
    expect(boxImprint(r(v("Tor", "logo"), v("TOR", "logo")))).toMatchObject({ key: "tor", from: "logo" });
    expect(boxImprint(r(v("Tor", "logo"), v("Tor", "text")))).toMatchObject({ key: "tor", from: "text" });
    expect(boxImprint(r(v("Tor"), v("Ace")))).toMatchObject({ key: null, conflict: true });
    expect(boxImprint(r(v(null), v(null)))).toMatchObject({ key: null, conflict: false });
    expect(boxImprint(undefined).key).toBeNull();
  });
});

// --- tie-break ------------------------------------------------------------------------------------------

const cand = (workId: string, score = 0.9, title = 0.95, cov = 0.8): Candidate => ({
  workId, title: workId, subtitle: null, authors: [], series: null, seriesNum: null, year: null, ttype: "NOVEL", editionCount: 1,
  score, queryCoverage: cov, variant: 0, evidence: [{ field: "title", score: title, form: workId, matches: [] }],
});
const decision = (confirmed: SpineDecision["confirmed"], accepted: Candidate | null = null): SpineDecision => ({
  id: "img:0", imageId: "img", boxScore: 0.3, confirmed, top: { ...confirmed }, readText: { vision: true, ppocr: true },
  accepted, agreeing: accepted ? ["vision", "ppocr"] : [], reason: accepted ? null : "readers-disagree", hard: true,
});

describe("imprint tie-break (never identity on its own)", () => {
  const w1 = cand("w1", 0.92), w2 = cand("w2", 0.9), weak = cand("w3", 0.5);
  const lists = { vision: [w1, w2], ppocr: [w2] };
  const base = decision({ vision: "w1", ppocr: "w2" });

  it("lets the imprint pick between candidates a reader already passes, so two readers agree", () => {
    const t = tieBreak(base, lists, (w) => w === "w2");
    expect(t.decision.accepted?.workId).toBe("w2");
    expect(t.decision.agreeing.sort()).toEqual(["ppocr", "vision"]);
    expect(t.switched).toEqual(["vision"]);
    expect(t.fired).toBe(true);
  });

  it("never touches a spine two readers already agree on", () => {
    const agreed = decision({ vision: "w1", ppocr: "w1" }, w1);
    expect(tieBreak(agreed, { vision: [w1, w2], ppocr: [w1, w2] }, (w) => w === "w2").decision).toBe(agreed);
  });

  it("does nothing when the imprint matches every passing candidate, or none", () => {
    expect(tieBreak(base, lists, () => true).decision.accepted).toBeNull();
    expect(tieBreak(base, lists, () => false).decision.accepted).toBeNull();
  });

  it("never promotes a candidate that fails the bar, nor a reader's only passing one", () => {
    const l = { vision: [weak, w1], ppocr: [w1] };
    const d = decision({ vision: null, ppocr: "w1" });
    expect(tieBreak(d, l, (w) => w === "w1").decision.accepted).toBeNull();
    expect(tieBreak(d, { vision: [w2, weak], ppocr: [w1] }, (w) => w === "w3").decision.accepted).toBeNull();
  });

  it("an imprint plus one reader is not an accept", () => {
    const d = decision({ vision: "w1", ppocr: null });
    expect(tieBreak(d, { vision: [w1, w2], ppocr: [] }, (w) => w === "w2").decision.accepted).toBeNull();
  });

  it("finds the spines an imprint could change", () => {
    expect(reorderable(base, lists)).toBe(true);
    expect(reorderable(decision({ vision: "w1", ppocr: null }), { vision: [w1, w2], ppocr: [] })).toBe(false);
    expect(reorderable(decision({ vision: "w1", ppocr: "w1" }, w1), lists)).toBe(false);
  });
});

describe("work imprints from the catalog", () => {
  const dir = mkdtempSync(join(tmpdir(), "bookcase-f0d-"));
  let db: DatabaseSync;
  beforeAll(() => {
    makeMiniStaging(join(dir, "staging.sqlite"));
    buildCatalog({ staging: join(dir, "staging.sqlite"), out: join(dir, "catalog.sqlite"), now: () => new Date("2026-11-03T00:00:00Z") });
    db = new DatabaseSync(join(dir, "catalog.sqlite"), { readOnly: true });
  });
  afterAll(() => {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("collects every edition's publisher keys for a work", () => {
    const table = buildImprintTable((db.prepare("SELECT publisher, count(*) AS n FROM editions GROUP BY publisher").all() as { publisher: string; n: number }[]).map((r) => [r.publisher, r.n] as const));
    const keysOf = workImprints(db, table);
    expect(keysOf("isfdb:201").sort()).toEqual(["ace", "penguin"]);
    expect(carries(keysOf, "ace")("isfdb:201")).toBe(true);
    expect(carries(keysOf, "tor")("isfdb:201")).toBe(false);
  });
});
