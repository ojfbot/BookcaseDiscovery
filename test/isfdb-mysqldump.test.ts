import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DumpSyntaxError, MysqlDumpParser } from "../src/catalog/mysqldump.ts";
import type { Value } from "../src/catalog/mysqldump.ts";
import { toIsbn13 } from "../src/catalog/isbn.ts";

const fixture = readFileSync(new URL("./fixtures/isfdb/mini-dump.sql", import.meta.url));

function parse(input: Buffer | string, tables: string[], chunk = Infinity) {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  const rows: Array<[string, Value[]]> = [];
  const created: Record<string, string[]> = {};
  const parser = new MysqlDumpParser({
    tables: new Set(tables),
    onTable: (t, cols) => (created[t] = cols),
    onRow: (t, r) => rows.push([t, r]),
  });
  for (let i = 0; i < buf.length; i += chunk) parser.push(buf.subarray(i, i + chunk));
  const stats = parser.finish();
  return { rows, created, stats };
}

describe("MysqlDumpParser", () => {
  it("reads column names from CREATE TABLE, ignoring keys and options", () => {
    const { created } = parse(fixture, ["authors"]);
    expect(created.authors).toEqual(["author_id", "author_canonical", "author_legalname", "author_birthplace", "author_birthdate", "author_lastname", "author_language"]);
  });

  it("reads values: ints, NULL, dates as text, escapes, multi-byte text, and `),(` inside strings", () => {
    const { rows } = parse(fixture, ["authors"]);
    expect(rows.map(([t]) => t)).toEqual(Array(5).fill("authors"));
    expect(rows[0]![1]).toEqual([101, "William Gibson", "Gibson, William Ford, III", "Conway, South Carolina", "1948-03-17", "Gibson", 17]);
    expect(rows[1]![1]).toEqual([102, "Kim Stanley Robinson", null, null, null, "Robinson", 17]);
    expect(rows[3]![1][1]).toBe("Stanisław Lem");
    expect(rows[4]![1]).toEqual([105, "Pat 'Quote' O'Brien, (Jr.)", 'back\\slash; "dq" ),(', "a\nnewline", "0000-00-00", "O'Brien", null]);
  });

  it("reads negative numbers and exponents", () => {
    const { rows } = parse(fixture, ["titles"]);
    expect(rows.find(([, r]) => r[0] === 203)![1][7]).toBe(-1.5);
  });

  it("skips tables it was not asked for, and everything outside INSERT/CREATE", () => {
    const { rows, created } = parse(fixture, ["languages"]);
    expect(rows).toEqual([["languages", [17, "English", "eng", "Yes"]], ["languages", [34, "Polish", "pol", "Yes"]]]);
    expect(Object.keys(created)).toEqual(["languages"]);
  });

  it("gives identical output for every chunk size, down to one byte", () => {
    const tables = ["authors", "titles", "pubs", "languages"];
    const whole = parse(fixture, tables);
    for (const chunk of [1, 2, 3, 7, 64, 1000]) {
      const split = parse(fixture, tables, chunk);
      expect(split.rows).toEqual(whole.rows);
      expect(split.created).toEqual(whole.created);
      expect(split.stats.bytes).toBe(fixture.length);
    }
  });

  it("splits a multi-byte character across chunks without corrupting it", () => {
    const bytes = Buffer.from("INSERT INTO `t` VALUES (1,'Łódź ★');\n");
    const star = bytes.indexOf(Buffer.from("★"));
    const rows: Value[][] = [];
    const parser = new MysqlDumpParser({ tables: new Set(["t"]), onRow: (_, r) => rows.push(r) });
    parser.push(bytes.subarray(0, star + 1)); // ends inside the three-byte star
    parser.push(bytes.subarray(star + 1));
    parser.finish();
    expect(rows).toEqual([[1, "Łódź ★"]]);
  });

  it("handles the escapes mysqldump writes", () => {
    const sql = "INSERT INTO `t` VALUES (1,'a\\0b\\nc\\rd\\te\\Zf\\\\g\\'h\\\"i'),(2,'it''s');\n";
    const { rows } = parse(sql, ["t"]);
    expect(rows[0]![1]).toEqual([1, "a\0b\nc\rd\te\x1af\\g'h\"i"]);
    expect(rows[1]![1]).toEqual([2, "it's"]);
  });

  it("counts invalid UTF-8 instead of hiding it", () => {
    const buf = Buffer.concat([Buffer.from("INSERT INTO `t` VALUES (1,'ok'),(2,'bad "), Buffer.from([0xe9]), Buffer.from(" byte');\n")]);
    const { rows, stats } = parse(buf, ["t"]);
    expect(rows[1]![1][1]).toBe("bad � byte");
    expect(stats.invalidUtf8).toBe(1);
  });

  it("handles a final line with no newline", () => {
    expect(parse("INSERT INTO `t` VALUES (1);", ["t"]).rows).toEqual([["t", [1]]]);
    expect(parse("CREATE TABLE `t` (\n  `a` int,\n  PRIMARY KEY (`a`)\n) ENGINE=MyISAM;\n", ["t"]).created.t).toEqual(["a"]);
  });

  it("refuses what it does not understand, with a byte offset", () => {
    expect(() => parse("INSERT INTO `t` (a,b) VALUES (1,2);\n", ["t"])).toThrow(/column lists are not supported/);
    expect(() => parse("INSERT INTO `t` VALUES (1,0x4142);\n", ["t"])).toThrow(DumpSyntaxError);
    expect(() => parse("INSERT INTO `t` VALUES (1,);\n", ["t"])).toThrow(DumpSyntaxError);
    expect(() => parse("INSERT INTO `t` VALUES (1,2) (3);\n", ["t"])).toThrow(/after a row/);
  });

  it("refuses a dump that stops inside a statement", () => {
    expect(() => parse("INSERT INTO `t` VALUES (1,'abc", ["t"])).toThrow(/ended inside a statement/);
    expect(() => parse("INSERT INTO `t` VALUES (1,2),(3", ["t"])).toThrow(/ended inside a statement/);
  });

  it("only treats a line that starts with INSERT INTO as a statement", () => {
    const { rows } = parse("-- INSERT INTO `t` VALUES (1);\n  INSERT INTO `t` VALUES (2);\nINSERT INTO `t` VALUES (3);\n", ["t"]);
    expect(rows).toEqual([["t", [3]]]);
  });
});

describe("toIsbn13", () => {
  it("passes a valid ISBN-13 and converts a valid ISBN-10", () => {
    expect(toIsbn13("9780441569595")).toBe("9780441569595");
    expect(toIsbn13("978-0-441-56959-5")).toBe("9780441569595");
    expect(toIsbn13("0441569595")).toBe("9780441569595");
    expect(toIsbn13("080442957X")).toBe("9780804429573");
    expect(toIsbn13("080442957x")).toBe("9780804429573");
  });
  it("returns null for a bad check digit, a wrong length, or not an ISBN", () => {
    expect(toIsbn13("0441569596")).toBeNull();
    expect(toIsbn13("9780441569594")).toBeNull();
    expect(toIsbn13("12345")).toBeNull();
    expect(toIsbn13("")).toBeNull();
    expect(toIsbn13(null)).toBeNull();
    expect(toIsbn13("ISBN pending")).toBeNull();
  });
});
