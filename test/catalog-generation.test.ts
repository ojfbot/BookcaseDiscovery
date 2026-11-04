// C-8 candidate generation: exact titles first, then per-token trigram queries rarest first into a capped pool.
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildCatalog } from "../src/catalog/build.ts";
import { buildStats } from "../src/catalog/rarity.ts";
import { catalogDf, GENERATION, retrieve, RETRIEVE_SQL, tokenQueriesFor } from "../src/catalog/retrieve.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";

const dir = mkdtempSync(join(tmpdir(), "bookcase-c8-"));
const out = join(dir, "catalog.sqlite");
let db: DatabaseSync;

beforeAll(() => {
  makeMiniStaging(join(dir, "staging.sqlite"));
  buildCatalog({ staging: join(dir, "staging.sqlite"), out, now: () => new Date("2026-11-03T00:00:00Z") });
  db = new DatabaseSync(out, { readOnly: true });
});
afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const dfOf = (table: Record<string, number>) => (t: string) => table[t] ?? 0;
const ids = (variants: string[], opts: Parameters<typeof retrieve>[3]) => retrieve(db, variants, 10, opts).map((c) => c.workId);

describe("tokenQueriesFor", () => {
  it("orders tokens rarest first, unknown words before known ones, the longer first on a tie", () => {
    const q = tokenQueriesFor(["PHILIP UBIK DICK QQQZ"], dfOf({ philip: 18000, dick: 3000, ubik: 4 }));
    expect(q.map((x) => x.token)).toEqual(["qqqz", "ubik", "dick", "philip"]);
    expect(q.map((x) => x.df)).toEqual([0, 4, 3000, 18000]);
  });

  it("sends no phrase under 3 characters and no stopword to the trigram index", () => {
    const q = tokenQueriesFor(["IT BY THE OF K SEA"], dfOf({ sea: 10 }));
    expect(q.map((x) => x.token)).toEqual(["sea"]);
    for (const x of q) for (const p of x.phrases) expect(p.length).toBeGreaterThanOrEqual(3);
  });

  it("halves only a long read token the catalog does not hold as a word", () => {
    const known = tokenQueriesFor(["STATION"], dfOf({ station: 3000 }));
    expect(known[0]!.phrases).toEqual(["station"]); // no "stat", "tion"
    const unknown = tokenQueriesFor(["STATI0NX"], dfOf({}));
    expect(unknown.find((x) => x.token === "stati0nx")!.phrases).toEqual(["stati0nx", "stat", "ti0nx"]);
    expect(tokenQueriesFor(["ABCDEF"], dfOf({}))[0]!.phrases).toEqual(["abcdef"]); // under `halveFrom`
    expect(GENERATION.halveFrom).toBe(7);
  });

  it("keeps a join or a 0/O reading only when the catalog holds it as a word", () => {
    const q = tokenQueriesFor(["NEURO MANCER SN0W"], dfOf({ neuromancer: 10, snow: 5000, neuro: 40, mancer: 2 }));
    const tokens = q.map((x) => x.token);
    expect(tokens).toContain("neuromancer");
    expect(tokens).toContain("snow");
    expect(tokens).not.toContain("mancersn0w"); // a join that is no word
    // Without a df table every guess stays (C-3's behaviour), longest first.
    const bare = tokenQueriesFor(["NEURO MANCER"], null).map((x) => x.token);
    expect(bare[0]).toBe("neuromancer");
  });
});

describe("candidate generation", () => {
  it("looks up every run of read tokens as an exact title, with no trigram query at all", () => {
    expect(ids(["QQQZ NEUROMANCER ZZZQ"], { ftsLimit: 0, expandLimit: 0 })).toEqual(["isfdb:201"]);
    expect(ids(["QQQZ RED MARS ZZZQ"], { ftsLimit: 0, expandLimit: 0 })).toEqual(["isfdb:202"]);
  });

  it("fills a small pool from the rarest token first", () => {
    const opts = { ftsLimit: 1, perToken: 1, expandLimit: 0 };
    // "neuromanc" is no catalog word (df 0): it goes first and takes the one slot.
    expect(ids(["MARS NEUROMANC"], { ...opts, df: dfOf({ mars: 50 }) })).toEqual(["isfdb:201"]);
    // Make "mars" the rarer word and it takes the slot instead.
    expect(ids(["MARS NEUROMANC"], { ...opts, df: dfOf({ mars: 1, neuromanc: 9 }) })).toEqual(["isfdb:202"]);
  });

  it("lets other readings generate candidates but scores them on the reader's own text only", () => {
    const opts = { ftsLimit: 0, expandLimit: 0 };
    expect(ids(["NEUROM"], opts)).toEqual([]);
    const r = retrieve(db, ["NEUROM"], 10, { ...opts, generateFrom: ["NEUROMANCER", "SOLARIS"] });
    // Solaris is generated but "NEUROM" does not explain it, so it is not a candidate.
    expect(r.map((c) => c.workId)).toEqual(["isfdb:201"]);
    expect(r[0]!.variant).toBe(0);
    expect(r[0]!.evidence.flatMap((e) => e.matches.map((m) => m.query))).toEqual(["neurom"]);
  });

  it("runs no statement that scans a catalog table", () => {
    for (const [name, sql] of Object.entries(RETRIEVE_SQL)) {
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("x", 1) as Array<{ detail: string }>).map((r) => r.detail);
      for (const step of plan) expect(`${name}: ${step}`).not.toMatch(/: SCAN (?!.*VIRTUAL TABLE)/);
    }
  });
});

describe("catalogDf", () => {
  it("reads df from the statistics sidecar beside the catalog, and is null without one or with a stale one", () => {
    const path = join(dir, "df.sqlite");
    buildCatalog({ staging: join(dir, "staging.sqlite"), out: path, now: () => new Date("2026-11-03T00:00:00Z") });
    const bare = new DatabaseSync(path, { readOnly: true });
    expect(catalogDf(bare)).toBeNull();
    bare.close();

    buildStats(path);
    const withStats = new DatabaseSync(path, { readOnly: true });
    const df = catalogDf(withStats)!;
    expect(df("neuromancer")).toBe(1);
    expect(df("nowordlikethis")).toBe(0);
    withStats.close();

    const later = new Date(Date.now() + 60_000);
    utimesSync(path, later, later);
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const stale = new DatabaseSync(path, { readOnly: true });
    expect(catalogDf(stale)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/another state/));
    warn.mockRestore();
    stale.close();
  });
});
