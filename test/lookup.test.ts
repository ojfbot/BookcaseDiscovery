// C-10: catalog lookup efficiency. Synthetic fixtures only: invented responses, the mini ISFDB staging file and
// the mini Open Library dump (no photo, crop, reading or query from real data).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog/build.ts";
import { cleanQuery, liveQueries, openLookup, queryKey, readerTexts, resolveBox, type FetchLike, type LocalTier, type OutsideRecord } from "../src/catalog/coverage.ts";
import { copyKey, KnownIndex, LOOKUP, type CacheEntry } from "../src/catalog/lookup.ts";
import { localTier, workRecord } from "../src/catalog/lookup-local.ts";
import { attributable, attribution, planC4, planSummary } from "../src/catalog/lookup-plan.ts";
import { stage, WorkFacts, measure, loadShelfBooks } from "../src/catalog/ol-dump.ts";
import type { Reading } from "../src/eval/f0.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";
import { writeMiniOlDump, writeMiniShelf } from "./helpers/mini-ol-dump.ts";

const dir = mkdtempSync(join(tmpdir(), "bookcase-c10-"));
let isfdb: DatabaseSync;
let v2: DatabaseSync;
beforeAll(async () => {
  makeMiniStaging(join(dir, "staging.sqlite"));
  buildCatalog({ staging: join(dir, "staging.sqlite"), out: join(dir, "catalog.sqlite") });
  const files = writeMiniOlDump(dir);
  const m = await measure(files, loadShelfBooks([writeMiniShelf(dir)]));
  m.facts.save(join(dir, "measure"));
  await stage(files, WorkFacts.load(join(dir, "measure")), join(dir, "ol-staging.sqlite"), { dump_date: "2026-10-31" });
  buildCatalog({ staging: join(dir, "staging.sqlite"), openLibrary: join(dir, "ol-staging.sqlite"), out: join(dir, "catalog-v2.sqlite") });
  isfdb = new DatabaseSync(join(dir, "catalog.sqlite"), { readOnly: true });
  v2 = new DatabaseSync(join(dir, "catalog-v2.sqlite"), { readOnly: true });
});
afterAll(() => {
  isfdb?.close();
  v2?.close();
  rmSync(dir, { recursive: true, force: true });
});

const OL = "https://openlibrary.org/search.json";
const ol = (params: Record<string, string>) => `${OL}?${new URLSearchParams(params).toString()}`;
const loc = (cql: string) => `http://lx2.loc.gov:210/LCDB?${new URLSearchParams({ version: "1.1", operation: "searchRetrieve", query: cql }).toString()}`;
const olBody = (docs: object[]) => JSON.stringify({ numFound: docs.length, docs });
const read = (reader: Reading["reader"], ...texts: string[]): Reading => ({ id: "x", reader, variants: texts.map((text, i) => ({ rotation: 90, text, confidence: 1 - i / 10 })), seconds: 0 });
const box = (id: string) => ({ id, stratum: "no-catalog-match" as const, role: "sample" as const });
const neuromancerDoc = { key: "/works/OL27258W", title: "Neuromancer", author_name: ["William Gibson"], isbn: ["9780441569595"] };

function mockFetch(routes: (url: string) => { status: number; body: string }) {
  const calls: string[] = [];
  const f: FetchLike = async (url) => {
    calls.push(url);
    const r = routes(url);
    return { status: r.status, text: async () => r.body };
  };
  return { f, calls };
}
const cacheDir = () => mkdtempSync(join(dir, "cache-"));

describe("normalized query key", () => {
  it("shares one key across token order, repeats and case", () => {
    expect(queryKey("openlibrary", ol({ q: "neuromancer gibson" }))).toBe(queryKey("openlibrary", ol({ q: "gibson neuromancer gibson" })));
    expect(queryKey("openlibrary", ol({ q: "NEUROMANCER Gibson" }))).toBe(queryKey("openlibrary", ol({ q: "neuromancer gibson" })));
  });

  it("keys a fielded query on the author's surname, so author spellings share it", () => {
    const k = queryKey("openlibrary", ol({ title: "neuromancer", author: "william gibson" }));
    expect(queryKey("openlibrary", ol({ title: "neuromancer", author: "gibson" }))).toBe(k);
    expect(queryKey("openlibrary", ol({ title: "neuromancer", author: "w gibson" }))).toBe(k);
    expect(queryKey("openlibrary", ol({ title: "neuromancer", author: "bruce sterling" }))).not.toBe(k);
  });

  it("keeps shapes and sources apart", () => {
    const and = queryKey("openlibrary", ol({ q: "neuromancer gibson" }));
    expect(queryKey("openlibrary", ol({ q: "neuromancer OR gibson" }))).not.toBe(and);
    expect(queryKey("openlibrary", ol({ title: "neuromancer gibson", author: "" }))).not.toBe(and);
    expect(queryKey("loc", loc("neuromancer gibson"))).toBe("loc|and|gibson neuromancer|");
    expect(queryKey("loc", loc("neuromancer or gibson"))).toBe("loc|or|gibson neuromancer|");
    expect(queryKey("loc", loc('dc.title="neuromancer" and dc.creator="william gibson"'))).toBe("loc|fielded|neuromancer|gibson");
  });

  it("reads back every query C-4's builder makes", () => {
    const texts = readerTexts({ qwen: read("qwen", "Neuromancer\nWilliam Gibson"), vision: read("vision", "GIBSON\nNEUROMANCER") });
    for (const source of ["openlibrary", "loc"] as const) for (const q of liveQueries(texts, source)) expect(queryKey(source, q.url)).toMatch(new RegExp(`^${source}\\|(fielded|and|or)\\|`));
    expect(queryKey("openlibrary", cleanQuery("openlibrary", "Neuromancer", "William Gibson"))).toBe("openlibrary|fielded|neuromancer|gibson");
  });

  it("gives a query with no keyword token its own entry", () => {
    expect(queryKey("openlibrary", ol({ q: "a" }))).not.toBe(queryKey("openlibrary", ol({ q: "b" })));
  });
});

describe("no repeat lookups", () => {
  it("lets reader variants of one spine share an entry: the second box makes no call", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([neuromancerDoc]) }));
    const cache = openLookup(cacheDir(), { fetch: f, sleep: async () => {} });
    const a = await resolveBox(isfdb, cache, box("p:1"), { vision: read("vision", "NEUROMANCER GIBSON") }, null);
    const b = await resolveBox(isfdb, cache, box("p:2"), { ppocr: read("ppocr", "gibson neuromancer") }, null);
    expect(a).toMatchObject({ tier: "live", cls: "in-isfdb" });
    expect(b).toMatchObject({ tier: "cache", cls: "in-isfdb" });
    expect(calls).toHaveLength(1);
  });

  it("resolves a fully cached box from the cache alone, never asking the local tier", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([neuromancerDoc]) }));
    const root = cacheDir();
    await resolveBox(isfdb, openLookup(root, { fetch: f, sleep: async () => {} }), box("p:1"), { vision: read("vision", "NEUROMANCER\nGIBSON") }, null);
    const never: LocalTier = { resolve: () => { throw new Error("local asked"); }, inOpenLibrary: () => { throw new Error("local asked"); } };
    const r = await resolveBox(isfdb, openLookup(root, { budget: 0 }), box("p:1"), { vision: read("vision", "NEUROMANCER\nGIBSON") }, null, { local: never });
    expect(r).toMatchObject({ tier: "cache", pending: 0, cls: "in-isfdb" });
    expect(calls).toHaveLength(1);
  });
});

describe("expiry", () => {
  it("keeps positive entries, retries no-match after 30 days and failures after 7, and serves stale when no call may be made", async () => {
    let clock = Date.parse("2026-11-05T00:00:00Z");
    let status = 500;
    let body = olBody([]);
    const { f, calls } = mockFetch(() => ({ status, body }));
    const root = cacheDir();
    const open = (o: { budget?: number } = {}) => openLookup(root, { fetch: f, sleep: async () => {}, now: () => clock, ...o });
    const failed = ol({ q: "failing query" });
    const none = ol({ q: "nothing found" });
    const hit = ol({ q: "neuromancer gibson" });
    let c = open();
    expect((await c.get("openlibrary", failed)).body).toBeNull();
    status = 200;
    await c.get("openlibrary", none);
    body = olBody([neuromancerDoc]);
    await c.get("openlibrary", hit);
    expect(calls).toHaveLength(5);
    const entry = (url: string) => JSON.parse(readFileSync(c.path("openlibrary", c.peek("openlibrary", url).key), "utf8")) as CacheEntry;
    expect([entry(failed).outcome, entry(none).outcome, entry(hit).outcome]).toEqual(["failed", "no-match", "match"]);
    expect(entry(hit).schema).toBe(LOOKUP.schema);

    clock += 8 * 86400000;
    c = open({ budget: 0 });
    expect(c.peek("openlibrary", failed).state).toBe("stale");
    expect(c.peek("openlibrary", none).state).toBe("fresh");
    expect((await c.get("openlibrary", failed)).from).toBe("stale");
    expect(calls).toHaveLength(5);
    c = open();
    expect((await c.get("openlibrary", failed)).from).toBe("live");
    expect(entry(failed).outcome).toBe("match");

    clock += 31 * 86400000;
    c = open();
    expect(c.peek("openlibrary", none).state).toBe("stale");
    expect(c.peek("openlibrary", hit).state).toBe("fresh");
    await c.get("openlibrary", none);
    expect(calls).toHaveLength(7);
  });
});

describe("budget and plan", () => {
  it("stops calling once the budget is spent and reports what it skipped", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([]) }));
    const cache = openLookup(cacheDir(), { fetch: f, sleep: async () => {}, budget: 2 });
    const r = await resolveBox(isfdb, cache, box("p:1"), { vision: read("vision", "XQZV WPLM\nKRTN BLOP\nSNRK FWOP") }, null);
    expect(calls).toHaveLength(2);
    expect(r.skipped).toBe("budget");
    expect(cache.summary().skipped.openlibrary).toBeGreaterThan(0);
    expect(cache.budgetLeft).toBe(0);
  });

  it("counts retries against the budget and leaves an interrupted query uncached", async () => {
    const { f, calls } = mockFetch(() => ({ status: 503, body: "" }));
    const cache = openLookup(cacheDir(), { fetch: f, sleep: async () => {}, budget: 2 });
    const a = await cache.get("openlibrary", ol({ q: "busy server" }));
    expect(a.from).toBe("skipped");
    expect(calls).toHaveLength(2);
    expect(cache.peek("openlibrary", ol({ q: "busy server" })).state).toBe("missing");
  });

  it("plans without calling: lower and upper bounds per source, by tier", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([neuromancerDoc]) }));
    const root = cacheDir();
    await resolveBox(isfdb, openLookup(root, { fetch: f, sleep: async () => {} }), box("p:0"), { vision: read("vision", "NEUROMANCER\nGIBSON") }, null);
    const plan = openLookup(root, { plan: true, fetch: f });
    const rs = [
      await resolveBox(isfdb, plan, box("p:1"), { vision: read("vision", "NEUROMANCER\nGIBSON") }, null),
      await resolveBox(isfdb, plan, box("p:2"), { vision: read("vision", "XQZV WPLM\nKRTN BLOP") }, null),
      await resolveBox(isfdb, plan, box("p:3"), { vision: read("vision", "WPLM XQZV\nBLOP KRTN") }, null),
    ];
    expect(calls).toHaveLength(1);
    const s = planSummary(rs, plan);
    expect(s.outcomes).toMatchObject({ cache: 1, "would-go-live": 2 });
    // Two boxes whose lines differ only in word order share every key: lower bound 1 Open Library call.
    expect(s.live.lower).toEqual({ openlibrary: 1, loc: 0 });
    expect(s.live.upper.openlibrary).toBe(3);
    expect(s.live.upper.loc).toBe(2);
    expect(s.live.cleanChecksUpTo).toBe(2);
    expect(s.keys.cacheHitRate).toBeCloseTo(1 / 6, 3);
  });

  it("plans C-4's behaviour from its version-1 files: exact URLs, no shared keys", () => {
    const root = cacheDir();
    const texts = readerTexts({ vision: read("vision", "NEUROMANCER\nGIBSON") });
    const first = liveQueries(texts, "openlibrary")[0]!;
    mkdirSync(join(root, "openlibrary"));
    writeFileSync(join(root, "openlibrary", `${createHash("sha256").update(first.url).digest("hex")}.json`), JSON.stringify({ url: first.url, status: 200, fetchedAt: "2026-11-03T00:00:00Z", body: olBody([neuromancerDoc]) }));
    const p = planC4([texts, readerTexts({ vision: read("vision", "GIBSON\nNEUROMANCER") })], root);
    expect(p.needCalls).toBe(1);
    expect(p.lower.openlibrary).toBe(1);
  });
});

describe("migration", () => {
  it("moves version-1 files to normalized keys, keeps them, and counts collisions", () => {
    const root = cacheDir();
    const v1 = (source: string, url: string, body: string | null, fetchedAt: string, status = 200) => {
      mkdirSync(join(root, source), { recursive: true });
      const p = join(root, source, `${createHash("sha256").update(url).digest("hex")}.json`);
      writeFileSync(p, JSON.stringify({ url, status, fetchedAt, body }));
      return p;
    };
    const a = v1("openlibrary", ol({ q: "neuromancer gibson" }), olBody([neuromancerDoc]), "2026-11-03T10:00:00Z");
    v1("openlibrary", ol({ q: "gibson neuromancer" }), olBody([{ ...neuromancerDoc, key: "/works/OL9W" }]), "2026-11-03T09:00:00Z");
    v1("openlibrary", ol({ q: "nothing found" }), olBody([]), "2026-11-03T09:00:00Z");
    v1("loc", loc("broken query"), null, "2026-11-03T09:00:00Z", 500);
    const before = readFileSync(a, "utf8");
    const cache = openLookup(root, { budget: 0 });
    expect(cache.migration).toEqual({
      files: { openlibrary: 3, loc: 1 },
      keys: { openlibrary: 2, loc: 1 },
      collisions: { openlibrary: 1, loc: 0 },
      collisionsDiffering: { openlibrary: 1, loc: 0 },
    });
    expect(readFileSync(a, "utf8")).toBe(before);
    const e = JSON.parse(readFileSync(cache.path("openlibrary", "openlibrary|and|gibson neuromancer|"), "utf8")) as CacheEntry;
    // Both positive: the earliest fetched wins; the other's URL is kept on the entry.
    expect(e.legacyUrls).toEqual([ol({ q: "neuromancer gibson" })]);
    expect(e.outcome).toBe("match");
    expect(cache.peek("loc", loc("broken query")).entry!.outcome).toBe("failed");
    expect(JSON.parse(readFileSync(join(root, "v2", "meta.json"), "utf8")).schema).toBe(2);
    expect(openLookup(root).migration).toBeNull();
  });
});

describe("known copies and works", () => {
  const gibson: OutsideRecord = { source: "openlibrary", id: "/works/OL27258W", title: "Neuromancer", subtitle: null, authors: ["William Gibson"], isbns: ["9780441569595"], subjects: [], year: null };

  it("tries a copy's resolved record on the next copy's own reads, with no call", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([]) }));
    const known = new KnownIndex<OutsideRecord>();
    const copy = copyKey(["p:1", "p:2"]);
    known.add(copy, null, gibson);
    const r = await resolveBox(isfdb, openLookup(cacheDir(), { fetch: f, sleep: async () => {} }), box("p:2"), { vision: read("vision", "NEUROMANCR\nGIBSON") }, null, { known, copy });
    expect(r).toMatchObject({ tier: "known", cls: "in-isfdb", skipped: null });
    expect(calls).toHaveLength(0);
  });

  it("skips live calls for a copy whose group is resolved but whose own reads do not pass, leaving it unresolved", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([]) }));
    const known = new KnownIndex<OutsideRecord>();
    known.add(null, "isfdb:201", gibson);
    const r = await resolveBox(isfdb, openLookup(cacheDir(), { fetch: f, sleep: async () => {} }), box("p:3"), { vision: read("vision", "XQZV WPLM") }, "isfdb:201", { known });
    expect(r).toMatchObject({ tier: null, cls: "unresolved", skipped: "known" });
    expect(calls).toHaveLength(0);
  });

  it("persists the index and keys copy groups on their members, not their numbers", () => {
    const p = join(cacheDir(), "known.json");
    const k = new KnownIndex<OutsideRecord>(p);
    k.add(copyKey(["b", "a"]), "isfdb:201", gibson);
    k.save();
    const again = new KnownIndex<OutsideRecord>(p);
    expect(again.recordsFor(copyKey(["a", "b"]), null)).toEqual([gibson]);
    expect(again.has(null, "isfdb:201")).toBe(true);
    expect(again.size).toEqual({ copies: 1, works: 1 });
  });
});

describe("local tier", () => {
  it("resolves against the ISFDB catalog first, with no call", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([]) }));
    const r = await resolveBox(isfdb, openLookup(cacheDir(), { fetch: f, sleep: async () => {} }), box("p:1"), { vision: read("vision", "NEUROMANCER\nGIBSON") }, null, { local: localTier(isfdb, v2) });
    expect(r).toMatchObject({ tier: "local-isfdb", resolvedBy: "isfdb", cls: "in-isfdb", isfdb: { workId: "isfdb:201", how: "local" }, inOpenLibrary: true });
    expect(calls).toHaveLength(0);
  });

  it("then against catalog-v2's Open Library works, checked against ISFDB as C-4 checks a live record", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([]) }));
    const r = await resolveBox(isfdb, openLookup(cacheDir(), { fetch: f, sleep: async () => {} }), box("p:1"), { vision: read("vision", "MOONWALKING WITH EINSTEIN\nFOER") }, null, { local: localTier(isfdb, v2) });
    expect(r).toMatchObject({ tier: "local-openlibrary", resolvedBy: "openlibrary", cls: "not-in-isfdb", inOpenLibrary: true, genre: "no-subjects" });
    expect(r.record!.id).toMatch(/^ol:/);
    expect(calls).toHaveLength(0);
  });

  it("goes live only on a local miss", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, body: olBody([]) }));
    const r = await resolveBox(isfdb, openLookup(cacheDir(), { fetch: f, sleep: async () => {} }), box("p:1"), { vision: read("vision", "XQZV WPLM") }, null, { local: localTier(isfdb, v2) });
    expect(r.cls).toBe("unresolved");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("turns a catalog work into a record with its editions' ISBNs", () => {
    expect(workRecord(isfdb, "isfdb:201")).toMatchObject({ source: "isfdb", title: "Neuromancer", authors: ["William Gibson"] });
    expect(workRecord(isfdb, "isfdb:201")!.isbns).toContain("9780441569595");
    expect(workRecord(isfdb, "isfdb:999999")).toBeNull();
  });
});

describe("batching attribution", () => {
  const entry = (key: string, docs: object[], fetchedAt: string): CacheEntry => ({ schema: 2, key, source: "openlibrary", url: "", legacyUrls: [], status: 200, outcome: docs.length ? "match" : "no-match", fetchedAt, body: olBody(docs) });

  it("gives a record back to a query only when every query token is in its returned fields", () => {
    const rec = { title: "Neuromancer", subtitle: null, authors: ["William Gibson"], subjects: ["Cyberpunk"] };
    expect(attributable(rec, ["neuromancer", "gibson"])).toBe(true);
    expect(attributable(rec, ["neuromancer", "sterling"])).toBe(false);
    expect(attributable(rec, [])).toBe(false);
  });

  it("measures recall and cross-attribution on cached positive responses, and gates on both", () => {
    const a = attribution({
      openlibrary: [
        entry("openlibrary|and|gibson neuromancer|", [neuromancerDoc, { key: "/works/OL2W", title: "Burning Chrome", author_name: ["William Gibson"], subject: ["Neuromancer"] }], "2026-11-03T09:00:00Z"),
        entry("openlibrary|and|gibson|", [neuromancerDoc], "2026-11-03T09:01:00Z"),
        entry("openlibrary|and|ubik|", [], "2026-11-03T09:02:00Z"),
        entry("openlibrary|fielded|neuromancer|gibson", [{ key: "/works/OL3W", title: "Neuromancer: the graphic novel", author_name: ["Tom de Haven"] }], "2026-11-03T09:03:00Z"),
      ],
      loc: [],
    });
    expect(a.openlibrary.and).toMatchObject({ queries: 2, records: 3, attributed: 3, cross: 3, passes: false });
    expect(a.openlibrary.fielded).toMatchObject({ queries: 1, records: 1, attributed: 0, recall: 0, passes: false });
    expect(a.loc.and).toMatchObject({ queries: 0, recall: null, passes: false });
  });
});

describe("cache files", () => {
  it("never writes outside the version-2 store", async () => {
    const { f } = mockFetch(() => ({ status: 200, body: olBody([neuromancerDoc]) }));
    const root = cacheDir();
    const cache = openLookup(root, { fetch: f, sleep: async () => {} });
    await cache.get("openlibrary", ol({ q: "neuromancer gibson" }));
    expect(readdirSync(root)).toEqual(["v2"]);
    expect(existsSync(join(root, "v2", "meta.json"))).toBe(true);
  });
});
