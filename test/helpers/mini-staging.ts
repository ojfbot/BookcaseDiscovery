// A tiny hand-built ISFDB staging file for the catalog build and retrieval tests (C-3). Ids are invented.
import { DatabaseSync } from "node:sqlite";
import { createSchema } from "../../src/catalog/isfdb-staging.ts";

type A = Array<Array<string | number | null>>;

export function makeMiniStaging(path: string): void {
  const db = new DatabaseSync(path);
  createSchema(db);
  const ins = (table: string, rows: A) => {
    if (rows.length === 0) return;
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    const st = db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
    for (const r of rows) st.run(...r);
  };
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("schema_version", "1");
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("content_hash", "test-hash");
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("dump_date", "2026-10-31");
  ins("languages", [[17, "English", "eng"], [34, "Polish", "pol"]]);
  ins("publishers", [[501, "Ace"], [502, "Penguin"]]);
  // authors: id, canonical, legal, last, language
  ins("authors", [
    [101, "William Gibson", "Gibson, William Ford, III", "Gibson", 17],
    [102, "Kim Stanley Robinson", null, "Robinson", 17],
    [103, "Stanisław Lem", "Lem, Stanisław", "Lem", 34],
    [104, "J. R. R. Tolkien", "Tolkien, John Ronald Reuel", "Tolkien", 17],
    [105, "Richard Bachman", null, "Bachman", 17],
    [106, "Stephen King", "King, Stephen Edwin", "King", 17],
    [107, "&#1057;&#1090;&#1072;&#1085;&#1080;&#1089;&#1083;&#1072;&#1074; &#1051;&#1077;&#1084;", null, "Lem", 17],
    [108, "Philip K. Dick", "Dick, Philip Kindred", "Dick", 17],
  ]);
  ins("series", [[301, "Sprawl", 303, 1, null], [302, "Mars Trilogy", 0, 1, null], [303, "Cyberpunk Collection", 0, 1, null]]);
  // titles: id, title, series_id, seriesnum, seriesnum_2, copyright, ttype, parent, language, non_genre, graphic
  ins("titles", [
    [201, "Neuromancer", 301, 1, "1", "1984-07-00", "NOVEL", 0, 17, "No", "No"],
    [202, "Red Mars", 302, 1, "1", "1992-09-00", "NOVEL", 0, 17, "No", "No"],
    [203, "Solaris", 0, 0, null, "1961-00-00", "NOVEL", 0, 34, "No", "No"],
    [204, "Solaris", 0, 0, null, "1970-00-00", "NOVEL", 203, 17, "No", "No"],
    [205, "The Fellowship of the Ring: Being the First Part of The Lord of the Rings", 0, 0, null, "1954-07-29", "NOVEL", 0, 17, "No", "No"],
    [206, "The Running Man", 0, 0, null, "1982-05-00", "NOVEL", 0, 17, "No", "No"],
    [207, "Neuromancer (excerpt)", 0, 0, null, "1984-00-00", "SHORTFICTION", 0, 17, "No", "No"],
    [208, "Neuromancer", 0, 0, null, "1985-00-00", "COVERART", 0, 17, "No", "No"],
    [209, "Do Androids Dream of Electric Sheep?", 0, 0, null, "1968-00-00", "NOVEL", 0, 17, "No", "No"],
    [210, "Blade Runner", 0, 0, null, "1969-00-00", "NOVEL", 209, 17, "No", "No"],
    [211, "&#1057;&#1086;&#1083;&#1103;&#1088;&#1080;&#1089;", 0, 0, null, "1961-00-00", "NOVEL", 203, 17, "No", "No"],
    [212, "Never Published", 0, 0, null, "8888-00-00", "NOVEL", 0, 17, "No", "No"],
    [213, "Count Zero", 301, 2, "2", "1986-03-00", "NOVEL", 0, 17, "No", "No"],
    [214, "Ubik", 0, 0, null, "0000-00-00", "NOVEL", 0, 17, "No", "No"],
  ]);
  ins("canonical_author", [
    [1, 201, 101, 1], [2, 202, 102, 1], [3, 203, 103, 1], [4, 204, 103, 1], [5, 205, 104, 1], [6, 206, 105, 1],
    [7, 206, 106, 2], [8, 207, 101, 1], [9, 213, 101, 1], [10, 209, 108, 1], [11, 210, 108, 1], [12, 211, 107, 1], [13, 214, 108, 1],
  ]);
  ins("pubs", [
    [401, "Neuromancer", "T1", "1984-07-00", 501, "271", "pb", "NOVEL", "0441569595", 0, null, null, "9780441569595"],
    [402, "Neuromancer", "T2", "2000-00-00", 502, "271", "tp", "NOVEL", "978-0-441-56959-4", 0, null, null, "9780441569594"],
    [403, "Red Mars", "T3", "1993-00-00", 501, "519", "tp", "NOVEL", null, 0, null, null, null],
    [404, "Solaris", "T4", "1970-00-00", 501, "204", "pb", "NOVEL", "", 0, null, null, null],
    [405, "The Fellowship of the Ring", "T5", "1954-07-29", 502, "423", "hc", "NOVEL", null, 0, null, null, null],
    [406, "The Running Man", "T6", "1982-05-00", 501, "219", "pb", "NOVEL", null, 0, null, null, null],
    [407, "Do Androids Dream of Electric Sheep?", "T7", "1968-00-00", 502, "210", "hc", "NOVEL", null, 0, null, null, null],
    [408, "Count Zero", "T8", "1986-03-00", 501, "246", "pb", "NOVEL", null, 0, null, null, null],
    [409, "Ubik", "T9", "1969-00-00", 501, "202", "pb", "NOVEL", null, 0, null, null, null],
  ]);
  ins("pub_content", [
    [1, 201, 401, "1"], [2, 201, 402, "1"], [3, 202, 403, "1"], [4, 204, 404, "1"], [5, 205, 405, "1"], [6, 206, 406, "1"],
    [7, 207, 401, "5"], [8, 209, 407, "1"], [9, 213, 408, "1"], [10, 214, 409, "1"],
  ]);
  ins("tags", [[701, "cyberpunk", 0], [702, "terraforming", 0]]);
  ins("tag_mapping", [[1, 701, 201, 9], [2, 701, 201, 10], [3, 702, 202, 10]]);
  db.close();
}
