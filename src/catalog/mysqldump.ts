// Streaming parser for `mysqldump` output (C-1): no MySQL server, no whole-file read.
//
// It understands exactly what mysqldump writes and refuses the rest:
//   CREATE TABLE `t` (          column names are read, nothing else in the definition matters
//     `col` type ...,
//   ) ENGINE=...;
//   INSERT INTO `t` VALUES (1,'a\'b',NULL,2.5),(...);   extended inserts, one statement per line
//
// Everything else (comments, SET, LOCK, DROP, tables the caller did not ask for) is skipped a line
// at a time. That is sound because mysqldump escapes newlines inside strings (`\n`), so a physical
// line is never split by data. Input arrives as arbitrary byte chunks; a statement, a string or an
// escape may straddle any chunk boundary (test/isfdb-mysqldump.test.ts feeds one byte at a time).
//
// Values come out as `string | number | null`. Strings are decoded as UTF-8 (the dump says
// `SET NAMES utf8`), and invalid sequences are counted in `stats.invalidUtf8` rather than hidden.

export type Value = string | number | null;

export interface DumpHandlers {
  /** Tables to read; every other table's lines are skipped. */
  tables: ReadonlySet<string>;
  /** A wanted table's CREATE TABLE was read: its column names in order. */
  onTable?(table: string, columns: string[]): void;
  /** One row of a wanted table's INSERT. `row` is a fresh array the handler may keep. */
  onRow(table: string, row: Value[]): void;
}

export interface DumpStats {
  bytes: number;
  insertStatements: number;
  rows: number;
  /** Strings that contained bytes which are not valid UTF-8 (each became U+FFFD). */
  invalidUtf8: number;
}

export class DumpSyntaxError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`${message} (at byte ${offset} of the dump)`);
    this.name = "DumpSyntaxError";
    this.offset = offset;
  }
}

const S = {
  LineStart: 0,
  SkipLine: 1,
  Head: 2,
  InsertName: 3,
  InsertAfterName: 4,
  CreateName: 5,
  CreateRest: 6,
  CreateBody: 7,
  RowOrEnd: 8,
  Value: 9,
  Token: 10,
  Str: 11,
  StrEscape: 12,
  StrQuote: 13,
  AfterValue: 14,
  AfterRow: 15,
} as const;

const INSERT_PREFIX = Buffer.from("INSERT INTO `");
const CREATE_PREFIX = Buffer.from("CREATE TABLE `");
const VALUES_KEYWORD = " VALUES ";
const BACKTICK = 0x60;
const QUOTE = 0x27;
const BACKSLASH = 0x5c;
const NL = 0x0a;
const utf8 = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export class MysqlDumpParser {
  readonly stats: DumpStats = { bytes: 0, insertStatements: 0, rows: 0, invalidUtf8: 0 };

  private state: number = S.LineStart;
  private head: number[] = [];
  private name: number[] = [];
  private table = "";
  private wanted = false;
  private afterName = 0; // progress through VALUES_KEYWORD
  private row: Value[] = [];
  private segments: Buffer[] = [];
  private token = "";
  private line: number[] = [];
  private columns: string[] = [];

  private readonly handlers: DumpHandlers;

  constructor(handlers: DumpHandlers) {
    this.handlers = handlers;
  }

  push(chunk: Uint8Array): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const base = this.stats.bytes;
    this.stats.bytes += buf.length;
    let i = 0;
    const n = buf.length;
    while (i < n) {
      switch (this.state) {
        case S.LineStart:
          this.head.length = 0;
          this.state = S.Head;
          break;

        case S.SkipLine: {
          const nl = buf.indexOf(NL, i);
          if (nl === -1) return;
          i = nl + 1;
          this.state = S.LineStart;
          break;
        }

        case S.Head: {
          const b = buf[i++]!;
          if (b === NL) {
            this.state = S.LineStart;
            break;
          }
          this.head.push(b);
          const k = this.head.length - 1;
          const isInsert = INSERT_PREFIX[k] === b && this.head.every((x, j) => x === INSERT_PREFIX[j]);
          const isCreate = CREATE_PREFIX[k] === b && this.head.every((x, j) => x === CREATE_PREFIX[j]);
          if (isInsert && this.head.length === INSERT_PREFIX.length) {
            this.name.length = 0;
            this.state = S.InsertName;
          } else if (isCreate && this.head.length === CREATE_PREFIX.length) {
            this.name.length = 0;
            this.state = S.CreateName;
          } else if (!isInsert && !isCreate) {
            this.state = S.SkipLine;
          }
          break;
        }

        case S.InsertName:
        case S.CreateName: {
          const b = buf[i++]!;
          if (b !== BACKTICK) {
            if (b === NL) throw new DumpSyntaxError("table name not closed", base + i);
            this.name.push(b);
            break;
          }
          this.table = Buffer.from(this.name).toString("utf8");
          this.wanted = this.handlers.tables.has(this.table);
          if (!this.wanted) {
            this.state = S.SkipLine;
          } else if (this.state === S.InsertName) {
            this.afterName = 0;
            this.state = S.InsertAfterName;
          } else {
            this.columns = [];
            this.line.length = 0;
            this.state = S.CreateRest;
          }
          break;
        }

        case S.CreateRest: {
          // the rest of the `CREATE TABLE `t` (` line
          const nl = buf.indexOf(NL, i);
          if (nl === -1) return;
          i = nl + 1;
          this.state = S.CreateBody;
          break;
        }

        case S.CreateBody: {
          const nl = buf.indexOf(NL, i);
          const end = nl === -1 ? n : nl;
          for (let j = i; j < end; j++) this.line.push(buf[j]!);
          if (nl === -1) return;
          i = nl + 1;
          const text = Buffer.from(this.line).toString("utf8");
          this.line.length = 0;
          if (text.startsWith(")")) {
            this.handlers.onTable?.(this.table, this.columns);
            this.state = S.LineStart;
            break;
          }
          const m = /^\s+`([^`]+)`\s/.exec(text);
          if (m) this.columns.push(m[1]!); // PRIMARY KEY, KEY, ... lines do not start with a backtick
          break;
        }

        case S.InsertAfterName: {
          const b = buf[i++]!;
          if (b !== VALUES_KEYWORD.charCodeAt(this.afterName)) {
            throw new DumpSyntaxError(
              `INSERT INTO \`${this.table}\`: expected "VALUES" (column lists are not supported)`,
              base + i,
            );
          }
          if (++this.afterName === VALUES_KEYWORD.length) {
            this.stats.insertStatements++;
            this.state = S.RowOrEnd;
          }
          break;
        }

        case S.RowOrEnd: {
          const b = buf[i++]!;
          if (b === 0x28 /* ( */) {
            this.row = [];
            this.state = S.Value;
          } else if (b === 0x3b /* ; */) {
            this.state = S.SkipLine;
          } else {
            throw new DumpSyntaxError(`expected "(" or ";" in INSERT INTO \`${this.table}\``, base + i);
          }
          break;
        }

        case S.Value: {
          const b = buf[i];
          if (b === QUOTE) {
            i++;
            this.segments.length = 0;
            this.state = S.Str;
          } else {
            this.token = "";
            this.state = S.Token;
          }
          break;
        }

        case S.Token: {
          let j = i;
          while (j < n) {
            const b = buf[j]!;
            if (b === 0x2c /* , */ || b === 0x29 /* ) */) break;
            if (b === NL || b === QUOTE) throw new DumpSyntaxError(`unexpected byte in a value in \`${this.table}\``, base + j);
            j++;
          }
          this.token += buf.toString("latin1", i, j);
          i = j;
          if (j < n) {
            this.row.push(this.parseToken(this.token, base + j));
            this.state = S.AfterValue;
          }
          break;
        }

        case S.Str: {
          let j = i;
          while (j < n) {
            const b = buf[j]!;
            if (b === QUOTE || b === BACKSLASH) break;
            j++;
          }
          if (j > i) this.segments.push(buf.subarray(i, j));
          i = j;
          if (j < n) {
            i++;
            this.state = buf[j] === BACKSLASH ? S.StrEscape : S.StrQuote;
          }
          break;
        }

        case S.StrEscape: {
          const b = buf[i++]!;
          this.segments.push(unescape(b));
          this.state = S.Str;
          break;
        }

        case S.StrQuote: {
          if (buf[i] === QUOTE) {
            i++;
            this.segments.push(Buffer.from("'"));
            this.state = S.Str;
          } else {
            this.row.push(this.decode());
            this.state = S.AfterValue;
          }
          break;
        }

        case S.AfterValue: {
          const b = buf[i++]!;
          if (b === 0x2c) {
            this.state = S.Value;
          } else if (b === 0x29) {
            this.stats.rows++;
            this.handlers.onRow(this.table, this.row);
            this.state = S.AfterRow;
          } else {
            throw new DumpSyntaxError(`expected "," or ")" in INSERT INTO \`${this.table}\``, base + i);
          }
          break;
        }

        case S.AfterRow: {
          const b = buf[i++]!;
          if (b === 0x2c) this.state = S.RowOrEnd;
          else if (b === 0x3b) this.state = S.SkipLine;
          else throw new DumpSyntaxError(`expected "," or ";" after a row of \`${this.table}\``, base + i);
          break;
        }
      }
    }
  }

  /** Call after the last chunk. Throws if the input ended inside a statement. */
  finish(): DumpStats {
    // A token or the `'` of StrQuote can legitimately be the last thing before EOF only if the
    // statement is unfinished, so any non-line-level state is an error.
    if (this.state === S.LineStart || this.state === S.SkipLine || this.state === S.Head) return this.stats;
    throw new DumpSyntaxError(`dump ended inside a statement for \`${this.table}\``, this.stats.bytes);
  }

  private decode(): string {
    const segs = this.segments;
    const joined = segs.length === 1 ? segs[0]! : Buffer.concat(segs);
    const text = utf8.decode(joined);
    if (text.includes("�")) this.stats.invalidUtf8++;
    this.segments = [];
    return text;
  }

  private parseToken(token: string, offset: number): Value {
    if (token === "NULL") return null;
    if (NUMBER.test(token)) {
      const v = Number(token);
      return Number.isSafeInteger(v) || token.includes(".") || /e/i.test(token) ? v : token;
    }
    throw new DumpSyntaxError(`unsupported value "${token.slice(0, 20)}" in \`${this.table}\``, offset);
  }
}

function unescape(b: number): Buffer {
  switch (b) {
    case 0x30: return Buffer.from([0]); // \0
    case 0x6e: return Buffer.from([0x0a]); // \n
    case 0x72: return Buffer.from([0x0d]); // \r
    case 0x74: return Buffer.from([0x09]); // \t
    case 0x62: return Buffer.from([0x08]); // \b
    case 0x5a: return Buffer.from([0x1a]); // \Z
    case 0x25: return Buffer.from("\\%"); // MySQL keeps the backslash of \% and \_ outside LIKE patterns
    case 0x5f: return Buffer.from("\\_");
    default: return Buffer.from([b]); // \' \" \\ and any other escaped byte stand for themselves
  }
}

/** Feed a whole async byte stream through a parser. */
export async function parseDumpStream(source: AsyncIterable<Uint8Array>, handlers: DumpHandlers): Promise<DumpStats> {
  const parser = new MysqlDumpParser(handlers);
  for await (const chunk of source) parser.push(chunk);
  return parser.finish();
}
