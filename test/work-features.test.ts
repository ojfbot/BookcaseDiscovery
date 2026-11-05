// KN-1: shared book knowledge (`work_features`): classification, the not-a-book-fact list, provenance per term, the
// Open Library subjects extract and crosswalk, the recommend crosswalk reading the table, and the wall.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog/build.ts";
import { openCatalog } from "../src/catalog/cli.ts";
import { loadShelfBooks, measure, stage, WorkFacts } from "../src/catalog/ol-dump.ts";
import { classify, extractOlSubjects, foldTerm, hasWorkFeatures, LEXICON, notABookFact, workFeatures, workGenres } from "../src/catalog/work-features.ts";
import { crosswalkFeatures, loadVocabulary } from "../src/recommend/vocabulary.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";
import { writeMiniOlDump, writeMiniShelf } from "./helpers/mini-ol-dump.ts";

describe("classify: genre, form or subject", () => {
  it.each([
    ["science fiction", "genre", "science-fiction"],
    ["juvenile fantasy", "genre", "fantasy"],
    ["young-adult sf", "genre", "science-fiction"],
    ["american science fiction", "genre", "science-fiction"],
    ["fiction, science fiction, general", "genre", "science-fiction"],
    ["fiction, science fiction, space opera", "genre", "space-opera"],
    ["fiction, mystery and detective, general", "genre", "mystery"],
    ["cyberpunk", "genre", "cyberpunk"],
    ["fiction", "form", "fiction"],
    ["fiction, general", "form", "fiction"],
    ["children's fiction", "form", "fiction"],
    ["short stories", "form", "short-stories"],
    ["comic books, strips, etc.", "form", "graphic-novel"],
    ["poetry", "form", "poetry"],
  ])("%s → %s %s", (term, kind, canon) => {
    expect(classify(term)).toMatchObject({ kind, canon });
  });

  it.each(["texas, fiction", "mars (planet) -- fiction", "time travel", "artificial intelligence", "twins, fiction", "near future"])("%s is a subject", (term) => {
    expect(classify(term)).toEqual({ kind: "subject", canon: null, family: null });
  });

  it("every lexicon name is folded, used once, and classifies to its own canon", () => {
    const seen = new Set<string>();
    for (const e of LEXICON) {
      for (const n of e.names) {
        expect(n, n).toBe(foldTerm(n));
        expect(seen.has(n), n).toBe(false);
        seen.add(n);
        expect(classify(n).canon, n).toBe(e.canon);
      }
    }
  });

  it("folds case, entities, ampersands and spaces", () => {
    expect(foldTerm("  Mystery &amp; Detective  ")).toBe("mystery and detective");
    expect(foldTerm("Action & Adventure")).toBe("action and adventure");
  });
});

describe("not a book fact: popularity, canon, adaptation and bookkeeping never enter the table", () => {
  it.each(["hugo award for best novel finalist", "1001 books you must read before you die", "into-movie", "nyt:hardcover-fiction=2008-05-04", "new york times bestseller", "accessible book", "protected daisy", "in library", "project gutenberg", "read", "2019", "user rating 8", "honorable mention dozois years best"])("%s is dropped", (t) => {
    expect(notABookFact(t)).toBe(true);
  });
  it.each(["science fiction", "cyberpunk", "reading", "mars (planet) -- fiction", "artificial intelligence"])("%s is kept", (t) => {
    expect(notABookFact(t)).toBe(false);
  });
});

/** Rewrite the mini works dump so a few works carry subjects. */
function addSubjects(path: string, byWork: Record<string, string[]>): void {
  const lines = gunzipSync(readFileSync(path)).toString("utf8").split("\n");
  const out = lines.map((l) => {
    const cols = l.split("\t");
    const subjects = byWork[cols[1] ?? ""];
    if (!subjects || cols.length < 5) return l;
    try {
      const rec = JSON.parse(cols[4]!);
      return [...cols.slice(0, 4), JSON.stringify({ ...rec, subjects })].join("\t");
    } catch {
      return l;
    }
  });
  writeFileSync(path, gzipSync(out.join("\n")));
}

describe("work features in the catalog build (synthetic staging and dumps)", () => {
  let dir: string;
  let v1x: DatabaseSync;
  let v2: DatabaseSync;
  let plain: DatabaseSync;
  let extract: Awaited<ReturnType<typeof extractOlSubjects>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "bcd-kn1-"));
    const files = writeMiniOlDump(dir);
    addSubjects(files.works, {
      "/works/OL1W": ["Science fiction", "Fiction", "Hackers, fiction", "Accessible book", "science fiction"],
      "/works/OL4W": ["Memory", "Biography"],
      "/works/OL6W": ["Shelf-only subject"], // shelf-held only: never extracted
    });
    const m = await measure(files, loadShelfBooks([writeMiniShelf(dir)]));
    m.facts.save(join(dir, "measure"));
    const olStaging = join(dir, "ol-staging.sqlite");
    await stage(files, WorkFacts.load(join(dir, "measure")), olStaging, { dump_date: "2026-10-31" });
    const subjects = join(dir, "ol-subjects.sqlite");
    extract = await extractOlSubjects({ works: files.works, staging: olStaging, out: subjects, dumpDate: "2026-10-31" });

    const staging = join(dir, "isfdb-staging.sqlite");
    makeMiniStaging(staging);
    const st = new DatabaseSync(staging);
    st.exec(`INSERT INTO tags VALUES (703, 'Cyberpunk', 0), (704, 'ofearna-ebooks', 1), (705, 'hugo award for best novel finalist', 0), (706, 'science fiction', 0), (707, 'translated', 0);
      INSERT INTO tag_mapping VALUES (10, 703, 201, 11), (11, 704, 201, 12), (12, 705, 201, 13), (13, 706, 201, 13), (14, 707, 204, 14), (15, 707, 211, 15);`);
    st.close();
    const now = () => new Date("2026-11-05T00:00:00Z");
    buildCatalog({ staging, out: join(dir, "plain.sqlite"), now });
    buildCatalog({ staging, out: join(dir, "v1x.sqlite"), features: { olSubjects: subjects, olCrosswalk: olStaging }, now });
    buildCatalog({ staging, out: join(dir, "v2.sqlite"), openLibrary: olStaging, features: { olSubjects: subjects }, now });
    plain = openCatalog(join(dir, "plain.sqlite"));
    v1x = openCatalog(join(dir, "v1x.sqlite"));
    v2 = openCatalog(join(dir, "v2.sqlite"));
  });
  afterAll(() => {
    for (const db of [plain, v1x, v2]) db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the extract keeps breadth works with subjects only", () => {
    const db = new DatabaseSync(join(dir, "ol-subjects.sqlite"), { readOnly: true });
    const ids = (db.prepare("SELECT id FROM ol_subjects ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
    db.close();
    expect(ids).toEqual([1, 4]);
    expect(extract.withSubjects).toBe(2);
  });

  it("ISFDB tags: public only, every tag, case variants folded, counted by distinct user, with provenance", () => {
    expect(hasWorkFeatures(plain)).toBe(true);
    const f = workFeatures(plain, "isfdb:201");
    expect(f.map((x) => [x.term, x.kind, x.canon, x.count])).toEqual([
      ["cyberpunk", "genre", "cyberpunk", 3],
      ["science fiction", "genre", "science-fiction", 1],
    ]);
    expect(f[0]).toMatchObject({ source: "isfdb-tag", recordId: "isfdb-tag:701", fetched: "2026-10-31" });
    // a tag on two variant titles of one work, by two users
    expect(workFeatures(plain, "isfdb:203")).toMatchObject([{ term: "translated", kind: "subject", count: 2, recordId: "isfdb-tag:707" }]);
    const meta = Object.fromEntries((plain.prepare("SELECT key, value FROM meta WHERE key LIKE 'work_features%'").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
    expect(meta).toMatchObject({ work_features: "isfdb-tag", "work_features.isfdbPrivateSkipped": "1", "work_features.notABookFact": "1" });
  });

  it("works.tags is untouched (the top 8, any status): the build's other tables do not change", () => {
    expect(JSON.parse((plain.prepare("SELECT tags FROM works WHERE id = 'isfdb:201'").get() as { tags: string }).tags)).toContain("ofearna-ebooks");
  });

  it("Open Library subjects reach a crosswalked ISFDB work, folded and de-duplicated, without bookkeeping", () => {
    const ol = workFeatures(v2, "isfdb:201").filter((x) => x.source === "openlibrary-subject");
    expect(ol.map((x) => [x.term, x.kind, x.canon])).toEqual([
      ["fiction", "form", "fiction"],
      ["hackers, fiction", "subject", null],
      ["science fiction", "genre", "science-fiction"],
    ]);
    expect(ol[0]).toMatchObject({ recordId: "OL1W", fetched: "2026-10-31", count: 1 });
    expect(workFeatures(v2, "ol:OL4W").map((x) => [x.term, x.kind])).toEqual([["biography", "form"], ["memory", "subject"]]);
    expect(workGenres(workFeatures(v2, "isfdb:201"))).toEqual({ "isfdb-tag": ["cyberpunk", "science-fiction"], "openlibrary-subject": ["science-fiction"] });
  });

  it("crosswalk only: a v1 build gets the same Open Library subjects on ISFDB works and stays ISFDB-only", () => {
    const pick = (db: DatabaseSync) => db.prepare("SELECT * FROM work_features WHERE work_id LIKE 'isfdb:%' ORDER BY work_id, source, term").all();
    expect(pick(v1x)).toEqual(pick(v2));
    for (const t of ["works", "editions", "authors", "work_authors", "title_forms", "author_forms", "series_forms"]) {
      const all = (db: DatabaseSync) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all();
      expect(all(v1x), t).toEqual(all(plain));
    }
  });

  it("Open Library subjects without a merge or a crosswalk are refused", () => {
    expect(() => buildCatalog({ staging: join(dir, "isfdb-staging.sqlite"), out: join(dir, "bad.sqlite"), features: { olSubjects: join(dir, "ol-subjects.sqlite") } })).toThrow(/ol-crosswalk/);
  });

  it("the recommend crosswalk reads the catalog's rows (R-0 §2.4), drops generic values and keeps provenance", () => {
    const x = crosswalkFeatures(loadVocabulary(), workFeatures(v2, "isfdb:202"));
    expect(x.terms).toEqual([{ id: "idea:terraforming", weight: 1 / 3, from: expect.objectContaining({ source: "isfdb-tag", recordId: "isfdb-tag:702" }) }]);
    const y = crosswalkFeatures(loadVocabulary(), workFeatures(v2, "isfdb:201"));
    expect(y.dropped.map((d) => [d.from.source, d.from.term, d.reason])).toEqual([["isfdb-tag", "science fiction", "generic"], ["openlibrary-subject", "fiction", "generic"], ["openlibrary-subject", "science fiction", "generic"]]);
    expect(y.terms.map((t) => [t.id, t.weight])).toEqual([["form:cyberpunk-fiction", 1]]);
    expect(y.unmapped.map((u) => u.term)).toEqual(["hackers, fiction"]);
  });
});

describe("the wall (INV-13): identify can read work features without reaching recommend or the profile", () => {
  /** Every file under src/ that a module imports, transitively (static `import ... from "./x.ts"` only). */
  function closure(entry: string): string[] {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gms)) walk(resolve(dirname(file), m[1]!));
    };
    walk(entry);
    return [...seen];
  }

  it("work-features.ts and everything it imports stay outside src/recommend and the profile", () => {
    const files = closure(resolve(new URL("../src/catalog/work-features.ts", import.meta.url).pathname));
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      expect(f, f).not.toMatch(/\/src\/recommend\/|profile/i);
      expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+"[^"]*(recommend|profile)[^"]*"/i);
    }
  });
});
