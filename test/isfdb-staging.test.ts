import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { computeContentHash, dumpDateFromName, stageDump, tableCounts } from "../src/catalog/isfdb-staging.ts";
import { main } from "../src/catalog/isfdb-import.ts";
import { runSpotChecks, spotCheck } from "../src/catalog/spot-check.ts";

const FIXTURE = new URL("./fixtures/isfdb/mini-dump.sql", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "bookcase-isfdb-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixed = () => new Date("2026-11-02T00:00:00Z");
let n = 0;
const out = () => join(dir, `staging-${n++}.sqlite`);

async function stage(dump = FIXTURE, to = out(), now = fixed) {
  return stageDump({ dump, out: to, now, dumpDate: "2026-10-31" });
}

describe("stageDump (synthetic dump)", () => {
  it("stages the kept tables with the counts in the dump", async () => {
    const r = await stage();
    expect(r.counts).toEqual({
      authors: 5, canonical_author: 6, titles: 6, pubs: 6, pub_authors: 6, pub_content: 6,
      publishers: 3, pub_series: 1, series: 2, tags: 2, tag_mapping: 3, languages: 2,
    });
    expect(r.dumpDate).toBe("2026-10-31");
  });

  it("keeps only the named columns and derives pubs.isbn13", async () => {
    const r = await stage();
    const db = new DatabaseSync(r.out, { readOnly: true });
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols("authors")).toEqual(["author_id", "author_canonical", "author_legalname", "author_lastname", "author_language"]);
    expect(cols("pubs")).toContain("isbn13");
    expect(cols("pubs")).not.toContain("pub_frontimage");
    expect(cols("pubs")).not.toContain("pub_price");
    const isbns = db.prepare("SELECT pub_id, pub_isbn, isbn13 FROM pubs ORDER BY pub_id").all();
    expect(isbns.map((x) => ({ ...x }))).toEqual([
      { pub_id: 401, pub_isbn: "0441569595", isbn13: "9780441569595" },
      { pub_id: 402, pub_isbn: "978-0-441-56959-4", isbn13: null }, // bad check digit
      { pub_id: 403, pub_isbn: "0553560735", isbn13: "9780553560732" },
      { pub_id: 404, pub_isbn: "0553380958", isbn13: "9780553380958" },
      { pub_id: 405, pub_isbn: "0441569596", isbn13: null },
      { pub_id: 406, pub_isbn: null, isbn13: null },
    ]);
    expect(db.prepare("SELECT value FROM meta WHERE key = 'dump_date'").get()).toEqual({ value: "2026-10-31" });
    expect(Number(db.prepare("PRAGMA user_version").get()!.user_version)).toBe(1);
    db.close();
  });

  it("gives the same content hash on two parses, whatever the import time", async () => {
    const a = await stage(FIXTURE, out(), () => new Date("2026-11-02T00:00:00Z"));
    const b = await stage(FIXTURE, out(), () => new Date("2027-01-01T12:34:56Z"));
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.contentHash).toBe(a.contentHash);
    const db = new DatabaseSync(a.out, { readOnly: true });
    expect(computeContentHash(db)).toBe(a.contentHash); // recomputed from the file
    db.close();
  });

  it("changes the hash when one value changes", async () => {
    const edited = join(dir, "backup-MySQL-55-2026-11-01");
    writeFileSync(edited, readFileSync(FIXTURE, "utf8").replace("'Solaris'", "'Solaris '"));
    const a = await stage();
    const b = await stageDump({ dump: edited, out: out() });
    expect(b.contentHash).not.toBe(a.contentHash);
    expect(b.dumpDate).toBe("2026-11-01");
  });

  it("reads a zip through a stream", async () => {
    const zip = join(dir, "backup-MySQL-55-2026-10-31.zip");
    execFileSync("zip", ["-q", "-j", zip, FIXTURE]);
    const plain = await stage();
    const zipped = await stage(zip);
    expect(zipped.contentHash).toBe(plain.contentHash);
  });

  it("fails loudly and leaves nothing behind when the dump is damaged", async () => {
    const damaged = join(dir, "damaged.sql");
    writeFileSync(damaged, readFileSync(FIXTURE, "utf8").replace("(1,701,201,9)", "(1,701,201)"));
    const target = out();
    await expect(stageDump({ dump: damaged, out: target })).rejects.toThrow(/tag_mapping.*row has 3 values/);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it("fails when a kept column is missing from the dump's CREATE TABLE", async () => {
    const renamed = join(dir, "renamed.sql");
    writeFileSync(renamed, readFileSync(FIXTURE, "utf8").replace("`author_lastname`", "`author_surname`"));
    await expect(stageDump({ dump: renamed, out: out() })).rejects.toThrow(/no column `author_lastname`/);
  });

  it("fails when a wanted table is absent", async () => {
    const trimmed = join(dir, "trimmed.sql");
    writeFileSync(trimmed, readFileSync(FIXTURE, "utf8").replaceAll("`languages`", "`languages_x`"));
    await expect(stageDump({ dump: trimmed, out: out() })).rejects.toThrow(/no table `languages`/);
  });
});

describe("spot checks (synthetic data)", () => {
  it("resolve the three seed titles to their authors, with ISBNs", async () => {
    const r = await stage();
    const db = new DatabaseSync(r.out, { readOnly: true });
    const results = runSpotChecks(db);
    expect(results.map((x) => x.ok)).toEqual([true, true, true]);
    const neuromancer = results[0]!;
    expect(neuromancer.authors).toEqual(["William Gibson"]);
    expect(neuromancer.workIds).toEqual([201]);
    // the variant's edition (pub 405) is included through title_parent
    expect(neuromancer.editions.map((e) => e.pubId)).toEqual([401, 405, 402]);
    expect(neuromancer.editions.map((e) => e.isbn13)).toEqual(["9780441569595", null, null]);
    expect(results[1]!.authors).toEqual(["Kim Stanley Robinson"]);
    expect(results[2]!.authors).toEqual(["Neal Stephenson"]);
    expect(spotCheck(db, { title: "Neuromancer", author: "Neal Stephenson" }).ok).toBe(false);
    db.close();
  });
});

describe("pnpm catalog:import / catalog:check", () => {
  it("imports into $BOOKCASE_DATA/catalog and prints counts, hash and spot checks", async () => {
    const root = join(dir, "data");
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      expect(await main(["import", "--dump", FIXTURE], { BOOKCASE_DATA: root })).toBe(0);
      expect(await main(["check"], { BOOKCASE_DATA: root })).toBe(0);
    } finally {
      console.log = log;
    }
    const text = lines.join("\n");
    expect(existsSync(join(root, "catalog", "isfdb-staging.sqlite"))).toBe(true);
    expect(text).toMatch(/canonical_author\s+6/);
    expect(text).toMatch(/content hash: [0-9a-f]{64}/);
    expect(text).toMatch(/PASS Neuromancer -> William Gibson/);
  });
});

describe("helpers", () => {
  it("takes the dump date from ISFDB's file name", () => {
    expect(dumpDateFromName("/x/backup-MySQL-55-2026-10-31.zip")).toBe("2026-10-31");
    expect(dumpDateFromName("/x/dump.sql")).toBeNull();
  });
  it("tableCounts covers every staged table", async () => {
    const r = await stage();
    const db = new DatabaseSync(r.out, { readOnly: true });
    expect(Object.keys(tableCounts(db))).toHaveLength(12);
    db.close();
  });
});
