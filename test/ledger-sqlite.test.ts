import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryLedger, SqliteLedger, diffValues, replay } from "../src/ledger/index.ts";
import { main } from "../src/run/index.ts";
import { ledgerBehaviour } from "./ledger-behaviour.ts";
import { liveBehaviour } from "./live-behaviour.ts";
import { example, scenario, spine, status } from "./helpers/ledger-fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "bookcase-ledger-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const dbPath = () => join(dir, `ledger-${counter++}.db`);

const opened: SqliteLedger[] = [];
function open(path = dbPath(), options = {}): SqliteLedger {
  const ledger = new SqliteLedger(path, options);
  opened.push(ledger);
  return ledger;
}
afterAll(() => opened.forEach((l) => { try { l.close(); } catch { /* already closed */ } }));

function filled(path = dbPath()): SqliteLedger {
  const ledger = open(path);
  for (const e of scenario()) ledger.append(e);
  return ledger;
}

// The same behaviour as the in-memory ledger (test/ledger-behaviour.ts), on a file database.
ledgerBehaviour("SqliteLedger", (options) => open(dbPath(), options));
liveBehaviour("SqliteLedger", (options) => open(dbPath(), options));

describe("SqliteLedger: storage", () => {
  it("uses WAL mode on a file database", () => {
    expect(open().journalMode()).toBe("wal");
  });

  it("agrees with the in-memory ledger: the same events give the same events and view dump", () => {
    const memory = new MemoryLedger();
    const sqlite = open();
    for (const e of scenario()) {
      memory.append(e);
      sqlite.append(e);
    }
    expect([...sqlite.events()]).toEqual([...memory.events()]);
    expect(sqlite.viewDump()).toEqual(memory.viewDump());
    expect(JSON.stringify(sqlite.viewDump())).toBe(JSON.stringify(memory.viewDump()));
  });

  it("is durable: a closed and reopened ledger has the same events and views, and carries on from lastSeq", () => {
    const path = dbPath();
    const first = filled(path);
    const dump = JSON.stringify(first.viewDump());
    const events = [...first.events()];
    first.close();
    const again = open(path);
    expect(again.lastSeq()).toBe(scenario().length);
    expect([...again.events()]).toEqual(events);
    expect(JSON.stringify(again.viewDump())).toBe(dump);
    expect(again.append(example("PreferenceRecorded")).seq).toBe(scenario().length + 1);
  });

  it("a refused append leaves no trace: no event, no view row, no gap in seq", () => {
    const ledger = filled();
    const before = JSON.stringify(ledger.viewDump());
    expect(() => ledger.append(status("obs-001", "resolved", "paused", { kind: "budget-spent" }))).toThrow();
    expect(() => ledger.append(spine("obs-001"))).toThrow(/already exists/);
    expect(ledger.lastSeq()).toBe(scenario().length);
    expect(JSON.stringify(ledger.viewDump())).toBe(before);
    expect(ledger.append(example("PreferenceRecorded")).seq).toBe(scenario().length + 1);
  });

  it("pages through events past one page", () => {
    const ledger = open();
    const rejected = example("ImageRejected");
    for (let i = 0; i < 1203; i++) ledger.append(rejected);
    expect([...ledger.events()].map((e) => e.seq)).toEqual(Array.from({ length: 1203 }, (_, i) => i + 1));
    expect([...ledger.events(1200)].map((e) => e.seq)).toEqual([1201, 1202, 1203]);
  });

  it("refuses to open a database that is not a ledger, and to append when opened read-only", () => {
    const path = dbPath();
    const other = new DatabaseSync(path);
    other.exec("CREATE TABLE t (x)");
    other.close();
    expect(() => new SqliteLedger(path)).toThrow(/not a ledger database/);
    const ledgerPath = dbPath();
    filled(ledgerPath).close();
    const readOnly = open(ledgerPath, { readOnly: true });
    expect(readOnly.lastSeq()).toBe(scenario().length);
    expect(() => readOnly.append(example("PreferenceRecorded"))).toThrow(/read-only/);
  });
});

describe("SqliteLedger: a version-1 database (before the live track)", () => {
  /** A v2 ledger made to look like L-2's: the live tables dropped, user_version back to 1. */
  function version1(): { path: string; dump: string } {
    const path = dbPath();
    const ledger = filled(path);
    const dump = JSON.stringify({ ...ledger.viewDump(), tracks: [], cards: [], adjudicationRequests: [] });
    ledger.close();
    const db = new DatabaseSync(path);
    db.exec("DROP TABLE tracks; DROP TABLE cards; DROP TABLE adjudication_requests; PRAGMA user_version = 1;");
    db.close();
    return { path, dump };
  }

  it("is refused read-only, and upgraded in place by a writable open, keeping its events and views", () => {
    const { path, dump } = version1();
    expect(() => new SqliteLedger(path, { readOnly: true })).toThrow(/not a ledger database/);
    const upgraded = open(path);
    expect(JSON.stringify(upgraded.viewDump())).toBe(dump);
    expect(upgraded.lastSeq()).toBe(scenario().length);
    upgraded.append(example("Track.born"));
    expect(upgraded.tracks()).toHaveLength(1);
    upgraded.close();
    const again = open(path, { readOnly: true });
    expect(again.tracks()).toHaveLength(1);
  });
});

describe("SqliteLedger: events are append-only (INV-14)", () => {
  /** A second connection, as any other program on the file would be. */
  function raw(path: string): DatabaseSync {
    return new DatabaseSync(path);
  }

  it("an UPDATE on events fails", () => {
    const path = dbPath();
    filled(path);
    const db = raw(path);
    expect(() => db.exec("UPDATE events SET type = 'RunFinished' WHERE seq = 1")).toThrow(/append-only: UPDATE refused/);
    expect(() => db.exec("UPDATE events SET payload = '{}'")).toThrow(/append-only/);
    db.close();
  });

  it("a DELETE on events fails, also through INSERT OR REPLACE", () => {
    const path = dbPath();
    const ledger = filled(path);
    const db = raw(path);
    expect(() => db.exec("DELETE FROM events WHERE seq = 1")).toThrow(/append-only: DELETE refused/);
    expect(() => db.exec("DELETE FROM events")).toThrow(/append-only/);
    db.exec("PRAGMA recursive_triggers = ON");
    expect(() =>
      db.exec(`INSERT OR REPLACE INTO events (seq, ts, run_id, type, payload) VALUES (1, 'x', 'r', 'RunFinished', '{}')`),
    ).toThrow(/append-only/);
    db.close();
    expect(ledger.lastSeq()).toBe(scenario().length);
  });

  it("a gap in seq is refused", () => {
    const path = dbPath();
    filled(path);
    const db = raw(path);
    expect(() => db.exec(`INSERT INTO events (seq, ts, run_id, type, payload) VALUES (500, 'x', 'r', 'RunFinished', '{}')`)).toThrow(/contiguous/);
    db.close();
  });
});

describe("replay (INV-14)", () => {
  it("rebuilds the views of a recorded synthetic run into a fresh database with an identical dump", () => {
    const source = dbPath();
    const original = filled(source);
    const target = dbPath();
    const result = replay(source, target);
    expect(result).toEqual({ events: scenario().length, identical: true, differences: [] });

    const rebuilt = open(target);
    expect(JSON.stringify(rebuilt.viewDump())).toBe(JSON.stringify(original.viewDump()));
    expect([...rebuilt.events()]).toEqual([...original.events()]);
  });

  it("an empty ledger replays to an empty one", () => {
    const source = dbPath();
    open(source).close();
    expect(replay(source, dbPath())).toEqual({ events: 0, identical: true, differences: [] });
  });

  it("refuses an existing target and a missing source, and never writes to the source", () => {
    const source = dbPath();
    filled(source).close();
    const target = dbPath();
    open(target).close();
    expect(() => replay(source, target)).toThrow(/wants a fresh database/);
    expect(() => replay(join(dir, "none.db"), dbPath())).toThrow(/no such database/);
    const stray = dbPath();
    expect(() => replay(join(dir, "none.db"), stray)).toThrow();
    expect(existsSync(stray)).toBe(false);
  });

  it("finds a view that no longer matches the log", () => {
    const source = dbPath();
    filled(source).close();
    const db = new DatabaseSync(source);
    db.exec("UPDATE observations SET status = 'paused' WHERE observation_id = 'obs-001'");
    db.exec("DELETE FROM observation_texts");
    db.close();
    const result = replay(source, dbPath());
    expect(result.identical).toBe(false);
    expect(result.differences).toContain('views.observations[0].status: "paused" != "resolved"');
    expect(result.differences.some((d) => d.startsWith("views.observations[0].texts"))).toBe(true);
    expect(result.events).toBe(scenario().length);
  });

  it("finds a log that the status machine would not have accepted", () => {
    const source = dbPath();
    const ledger = open(source);
    ledger.append(spine("obs-001"));
    ledger.append(status("obs-001", null, "unresolved"));
    ledger.append(status("obs-001", "unresolved", "resolved"));
    ledger.close();
    // Someone drops the trigger and rewrites history: resolved -> paused with no spent budget.
    const db = new DatabaseSync(source);
    db.exec("DROP TRIGGER events_no_update");
    db.exec(`UPDATE events SET payload = '{"observationId":"obs-001","from":"unresolved","to":"paused"}' WHERE seq = 3`);
    db.close();
    const result = replay(source, dbPath());
    expect(result.identical).toBe(false);
    expect(result.differences[0]).toMatch(/^event 3 \(StatusChanged\) refused on replay: .*needs cause budget-spent/);
  });

  it("diffValues names the path of each difference", () => {
    expect(diffValues({ a: [1, { b: 2 }], c: "x" }, { a: [1, { b: 3 }], c: "x" })).toEqual(["$.a[1].b: 2 != 3"]);
    expect(diffValues({ a: 1 }, { a: 1, b: 2 })).toEqual(["$.b: missing != 2"]);
    expect(diffValues([1, 2], [1])).toEqual(["$: length 2 != 1"]);
    expect(diffValues({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe("bookcase replay <db> --to <fresh db>", () => {
  function capture(args: string[]): { code: number; out: string; err: string } {
    const logs: string[] = [];
    const errs: string[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (...a) => logs.push(a.join(" "));
    console.error = (...a) => errs.push(a.join(" "));
    try {
      return { code: main(["replay", ...args]), out: logs.join("\n"), err: errs.join("\n") };
    } finally {
      console.log = log;
      console.error = error;
    }
  }

  it("exits 0 and says the views are identical", () => {
    const source = dbPath();
    filled(source).close();
    const target = dbPath();
    const { code, out } = capture([source, "--to", target]);
    expect(code).toBe(0);
    expect(out).toBe(`replayed ${scenario().length} events into ${target}: views identical`);
  });

  it("exits 1 and lists the differences when the views drifted", () => {
    const source = dbPath();
    filled(source).close();
    const db = new DatabaseSync(source);
    db.exec("UPDATE observations SET status = 'paused' WHERE observation_id = 'obs-001'");
    db.close();
    const { code, err } = capture([source, "--to", dbPath()]);
    expect(code).toBe(1);
    expect(err).toContain("views DIFFER");
    expect(err).toContain('views.observations[0].status: "paused" != "resolved"');
  });

  it("exits 2 on a usage error or an unreadable database", () => {
    expect(capture([]).code).toBe(2);
    expect(capture(["only-one"]).code).toBe(2);
    expect(capture(["a", "b", "--to", "c"]).code).toBe(2);
    expect(capture([join(dir, "none.db"), "--to", dbPath()])).toMatchObject({ code: 2, err: expect.stringContaining("no such database") });
  });

  it("runs from the real bin/bookcase under Node's type stripping", () => {
    const source = dbPath();
    filled(source).close();
    const target = dbPath();
    const run = spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "bookcase"), "replay", source, "--to", target], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("views identical");
  });
});

