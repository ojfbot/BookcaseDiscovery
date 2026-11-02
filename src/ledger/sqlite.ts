// SQLite ledger (L-2): the durable implementation of the L-1 `Ledger` interface, on Node's built-in
// `node:sqlite` (docs/probe.md: its bundled SQLite has FTS5 trigram, so no native dependency).
//
// `events` is the source of truth: append-only, UPDATE and DELETE rejected by trigger. The view
// tables below are derived from it and updated incrementally in the same transaction as each
// append, so a refused event leaves nothing behind. `bookcase replay` rebuilds them from the log
// into a fresh database and diffs the result against these.
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EventType, LedgerEvent, NewEvent, Payload, Status } from "./contracts.ts";
import { LedgerError } from "./ledger.ts";
import type { Ledger, ObservationView, RecommendationView, RunView, ViewDump, WorkItemView } from "./ledger.ts";
import { prepareEvent } from "./prepare.ts";
import { checkAdjudication, checkStatusChange } from "./status.ts";

/** Bump when a table changes; `PRAGMA user_version` holds it. */
export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE events (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  run_id  TEXT NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload))
);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only: UPDATE refused'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only: DELETE refused'); END;
-- seq is gap-free: it is how replay and RecommendationRevised.reasonEventSeqs name events.
CREATE TRIGGER events_contiguous AFTER INSERT ON events
WHEN NEW.seq <> COALESCE((SELECT MAX(seq) FROM events WHERE seq < NEW.seq), 0) + 1
BEGIN SELECT RAISE(ABORT, 'events.seq must be contiguous'); END;

-- Views. Each row's \`seq\` is the event that created it, which fixes the dump order.
CREATE TABLE images (
  seq INTEGER PRIMARY KEY, session_id TEXT NOT NULL, image_hash TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE rejections (
  seq INTEGER PRIMARY KEY, session_id TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE observations (
  observation_id TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL UNIQUE,
  session_id     TEXT NOT NULL,
  image_hash     TEXT NOT NULL,
  spine          TEXT NOT NULL,
  hypotheses     TEXT,          -- the most recent proposal
  band           TEXT,          -- the most recent band
  status         TEXT CHECK (status IN ('unresolved','resolved','paused','needs-pixels')),
  status_seq     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX observations_session ON observations (session_id);
CREATE INDEX observations_image ON observations (image_hash);
CREATE TABLE observation_texts (
  seq INTEGER PRIMARY KEY, observation_id TEXT NOT NULL REFERENCES observations, body TEXT NOT NULL
);
CREATE TABLE observation_adjudications (
  seq INTEGER PRIMARY KEY, observation_id TEXT NOT NULL REFERENCES observations, body TEXT NOT NULL
);
CREATE TABLE observation_corrections (
  seq INTEGER PRIMARY KEY, observation_id TEXT NOT NULL REFERENCES observations, body TEXT NOT NULL
);
CREATE INDEX texts_obs ON observation_texts (observation_id);
CREATE INDEX adjudications_obs ON observation_adjudications (observation_id);
CREATE INDEX corrections_obs ON observation_corrections (observation_id);
CREATE TABLE work_items (
  work_item_id TEXT PRIMARY KEY,
  seq          INTEGER NOT NULL UNIQUE,
  observation_id TEXT NOT NULL REFERENCES observations,
  opened       TEXT NOT NULL,
  resolution   TEXT CHECK (resolution IN ('fulfilled','withdrawn'))
);
CREATE TABLE recommendations (
  recommendation_id TEXT PRIMARY KEY,
  seq             INTEGER NOT NULL UNIQUE,
  ranking_version TEXT NOT NULL,
  current         TEXT NOT NULL,
  revisions       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE runs (
  run_id        TEXT PRIMARY KEY,
  seq           INTEGER NOT NULL UNIQUE,
  started       TEXT NOT NULL,
  adjudications INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  finished      TEXT
);
`;

export interface SqliteLedgerOptions {
  /** Also validate each event against the JSON Schema (Ajv) and refuse on disagreement with Zod. Off by default. */
  crossCheck?: boolean;
  /** Open an existing database without writing; `append` throws. Used by replay for the source. */
  readOnly?: boolean;
}

type Row = Record<string, string | number | null>;

const json = (v: unknown): string => JSON.stringify(v);
const parse = <T>(text: unknown): T => JSON.parse(text as string) as T;

export class SqliteLedger implements Ledger {
  readonly #db: DatabaseSync;
  readonly #crossCheck: boolean;
  readonly #readOnly: boolean;
  readonly #statements = new Map<string, StatementSync>();

  /** `path` is a database file (created with its parent directory if absent) or `:memory:`. */
  constructor(path: string, options: SqliteLedgerOptions = {}) {
    this.#crossCheck = options.crossCheck ?? false;
    this.#readOnly = options.readOnly ?? false;
    if (!this.#readOnly && path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path, { readOnly: this.#readOnly });
    this.#db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;");
    const version = Number(this.#get("PRAGMA user_version")!.user_version);
    if (version === SCHEMA_VERSION) {
      if (!this.#readOnly) this.#db.exec("PRAGMA journal_mode = WAL;");
      return;
    }
    const tables = Number(this.#get("SELECT count(*) AS n FROM sqlite_master")!.n);
    if (version !== 0 || tables !== 0 || this.#readOnly) {
      this.#db.close();
      throw new LedgerError(`${path}: not a ledger database this code can open (user_version ${version}, ${tables} objects)`);
    }
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec(`BEGIN; ${SCHEMA} PRAGMA user_version = ${SCHEMA_VERSION}; COMMIT;`);
  }

  close(): void {
    this.#db.close();
  }

  /** The journal mode in effect: "wal" for a file database. */
  journalMode(): string {
    return String(this.#get("PRAGMA journal_mode")!.journal_mode);
  }

  // ---- statements ----

  #stmt(sql: string): StatementSync {
    let s = this.#statements.get(sql);
    if (!s) this.#statements.set(sql, (s = this.#db.prepare(sql)));
    return s;
  }
  #get(sql: string, ...params: (string | number | null)[]): Row | undefined {
    return this.#stmt(sql).get(...params) as Row | undefined;
  }
  #all(sql: string, ...params: (string | number | null)[]): Row[] {
    return this.#stmt(sql).all(...params) as Row[];
  }
  #run(sql: string, ...params: (string | number | null)[]): { lastInsertRowid: number | bigint } {
    return this.#stmt(sql).run(...params);
  }

  // ---- append ----

  append(event: NewEvent): LedgerEvent {
    if (this.#readOnly) throw new LedgerError("append: this ledger was opened read-only");
    const parsed = prepareEvent(event, this.#crossCheck);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const seq = Number(
        this.#run(
          "INSERT INTO events (ts, run_id, type, payload) VALUES (?, ?, ?, ?)",
          parsed.ts,
          parsed.runId,
          parsed.type,
          json(parsed.payload),
        ).lastInsertRowid,
      );
      const stored = { seq, ...parsed } as LedgerEvent;
      this.#apply(stored); // throws before the transaction commits, so a refused event leaves nothing
      this.#db.exec("COMMIT");
      return structuredClone(stored);
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #requireObservation(id: string, type: string): void {
    if (!this.#get("SELECT 1 AS x FROM observations WHERE observation_id = ?", id)) {
      throw new LedgerError(`${type}: unknown observation "${id}"`);
    }
  }
  #requireFresh(table: string, column: string, id: string, what: string, type: string): void {
    if (this.#get(`SELECT 1 AS x FROM ${table} WHERE ${column} = ?`, id)) {
      throw new LedgerError(`${type}: ${what} "${id}" already exists`);
    }
  }

  /** The SQL twin of `views.ts` `apply`. The shared behaviour suite keeps the two equal. */
  #apply(event: LedgerEvent): void {
    const { seq, type } = event;
    switch (event.type) {
      case "ScanSessionOpened":
      case "PreferenceRecorded": // taste, not identity: no view here changes (INV-7)
        return;
      case "RunStarted":
        this.#requireFresh("runs", "run_id", event.runId, "run", type);
        this.#run("INSERT INTO runs (run_id, seq, started) VALUES (?, ?, ?)", event.runId, seq, json(event.payload));
        return;
      case "RunFinished": {
        const run = this.run(event.runId);
        if (!run) throw new LedgerError(`${type}: unknown run "${event.runId}"`);
        if (run.finished) throw new LedgerError(`${type}: run "${event.runId}" already finished`);
        this.#run("UPDATE runs SET finished = ? WHERE run_id = ?", json(event.payload), event.runId);
        return;
      }
      case "ImageAssetIngested":
        this.#run(
          "INSERT INTO images (seq, session_id, image_hash, body) VALUES (?, ?, ?, ?)",
          seq,
          event.payload.sessionId,
          event.payload.imageHash,
          json(event.payload),
        );
        return;
      case "ImageRejected":
        this.#run("INSERT INTO rejections (seq, session_id, body) VALUES (?, ?, ?)", seq, event.payload.sessionId, json(event.payload));
        return;
      case "SpineObserved": {
        const p = event.payload;
        this.#requireFresh("observations", "observation_id", p.observationId, "observation", type);
        this.#run(
          "INSERT INTO observations (observation_id, seq, session_id, image_hash, spine) VALUES (?, ?, ?, ?, ?)",
          p.observationId,
          seq,
          p.sessionId,
          p.imageHash,
          json(p),
        );
        return;
      }
      case "TextObserved":
        this.#requireObservation(event.payload.observationId, type);
        this.#run("INSERT INTO observation_texts (seq, observation_id, body) VALUES (?, ?, ?)", seq, event.payload.observationId, json(event.payload));
        return;
      case "HypothesesProposed":
        this.#requireObservation(event.payload.observationId, type);
        this.#run("UPDATE observations SET hypotheses = ? WHERE observation_id = ?", json(event.payload), event.payload.observationId);
        return;
      case "AdjudicationRecorded": {
        const p = event.payload;
        this.#requireObservation(p.observationId, type);
        const run = this.run(event.runId);
        checkAdjudication(run, p);
        this.#run("INSERT INTO observation_adjudications (seq, observation_id, body) VALUES (?, ?, ?)", seq, p.observationId, json(p));
        if (run && !p.cached) {
          this.#run(
            "UPDATE runs SET adjudications = adjudications + 1, input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE run_id = ?",
            p.inputTokens,
            p.outputTokens,
            event.runId,
          );
        }
        return;
      }
      case "BandAssigned":
        this.#requireObservation(event.payload.observationId, type);
        this.#run("UPDATE observations SET band = ? WHERE observation_id = ?", json(event.payload), event.payload.observationId);
        return;
      case "StatusChanged": {
        const p = event.payload;
        this.#requireObservation(p.observationId, type);
        const row = this.#get("SELECT status, status_seq FROM observations WHERE observation_id = ?", p.observationId)!;
        checkStatusChange(p, {
          current: row.status as Status | null,
          currentSeq: Number(row.status_seq),
          seq,
          run: this.run(event.runId),
          eventAt: (at) => {
            const e = this.#get("SELECT type, payload FROM events WHERE seq = ?", at);
            return e && { type: e.type as EventType, payload: parse(e.payload) };
          },
        });
        this.#run("UPDATE observations SET status = ?, status_seq = ? WHERE observation_id = ?", p.to, seq, p.observationId);
        return;
      }
      case "IdentityCorrected":
        this.#requireObservation(event.payload.observationId, type);
        this.#run(
          "INSERT INTO observation_corrections (seq, observation_id, body) VALUES (?, ?, ?)",
          seq,
          event.payload.observationId,
          json(event.payload.correction),
        );
        return;
      case "WorkItemOpened": {
        const p = event.payload;
        this.#requireObservation(p.observationId, type);
        this.#requireFresh("work_items", "work_item_id", p.workItemId, "work item", type);
        this.#run("INSERT INTO work_items (work_item_id, seq, observation_id, opened) VALUES (?, ?, ?, ?)", p.workItemId, seq, p.observationId, json(p));
        return;
      }
      case "WorkItemClosed":
        if (!this.#get("SELECT 1 AS x FROM work_items WHERE work_item_id = ?", event.payload.workItemId)) {
          throw new LedgerError(`${type}: unknown work item "${event.payload.workItemId}"`);
        }
        this.#run("UPDATE work_items SET resolution = ? WHERE work_item_id = ?", event.payload.resolution, event.payload.workItemId);
        return;
      case "RecommendationIssued": {
        const p = event.payload;
        this.#requireObservation(p.recommendation.observationId, type);
        this.#requireFresh("recommendations", "recommendation_id", p.recommendationId, "recommendation", type);
        this.#run(
          "INSERT INTO recommendations (recommendation_id, seq, ranking_version, current) VALUES (?, ?, ?, ?)",
          p.recommendationId,
          seq,
          p.rankingVersion,
          json(p.recommendation),
        );
        return;
      }
      case "RecommendationRevised": {
        const p = event.payload;
        if (!this.#get("SELECT 1 AS x FROM recommendations WHERE recommendation_id = ?", p.recommendationId)) {
          throw new LedgerError(`${type}: unknown recommendation "${p.recommendationId}"`);
        }
        this.#requireObservation(p.recommendation.observationId, type);
        this.#run(
          "UPDATE recommendations SET ranking_version = ?, current = ?, revisions = revisions + 1 WHERE recommendation_id = ?",
          p.rankingVersion,
          json(p.recommendation),
          p.recommendationId,
        );
        return;
      }
      default: {
        const unreachable: never = event;
        throw new LedgerError(`unhandled event ${JSON.stringify(unreachable)}`);
      }
    }
  }

  // ---- reads ----

  *events(after = 0): Iterable<LedgerEvent> {
    const page = 500;
    for (let cursor = after; ; ) {
      const rows = this.#all("SELECT seq, ts, run_id, type, payload FROM events WHERE seq > ? ORDER BY seq LIMIT ?", cursor, page);
      for (const r of rows) {
        yield { seq: Number(r.seq), type: r.type, ts: r.ts, runId: r.run_id, payload: parse(r.payload) } as LedgerEvent;
      }
      if (rows.length < page) return;
      cursor = Number(rows[rows.length - 1]!.seq);
    }
  }

  lastSeq(): number {
    return Number(this.#get("SELECT COALESCE(MAX(seq), 0) AS n FROM events")!.n);
  }

  /** Observations matching `where` (a fragment over `observations`), children included. */
  #observationViews(where: string, ...params: (string | number | null)[]): ObservationView[] {
    const rows = this.#all(`SELECT * FROM observations ${where} ORDER BY seq`, ...params);
    const children = (table: string) => {
      const by = new Map<string, unknown[]>();
      const sub = `SELECT observation_id FROM observations ${where}`;
      for (const r of this.#all(`SELECT observation_id, body FROM ${table} WHERE observation_id IN (${sub}) ORDER BY seq`, ...params)) {
        const list = by.get(r.observation_id as string) ?? [];
        list.push(parse(r.body));
        by.set(r.observation_id as string, list);
      }
      return by;
    };
    const texts = children("observation_texts");
    const adjudications = children("observation_adjudications");
    const corrections = children("observation_corrections");
    return rows.map((r) => {
      const id = r.observation_id as string;
      return {
        observationId: id,
        spine: parse(r.spine),
        texts: (texts.get(id) ?? []) as Payload<"TextObserved">[],
        hypotheses: r.hypotheses === null ? null : parse(r.hypotheses),
        adjudications: (adjudications.get(id) ?? []) as Payload<"AdjudicationRecorded">[],
        band: r.band === null ? null : parse(r.band),
        status: r.status as Status | null,
        corrections: (corrections.get(id) ?? []) as Payload<"IdentityCorrected">["correction"][],
      };
    });
  }

  observation(observationId: string): ObservationView | undefined {
    return this.#observationViews("WHERE observation_id = ?", observationId)[0];
  }

  observations(filter: { sessionId?: string; imageHash?: string } = {}): ObservationView[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.sessionId !== undefined) (clauses.push("session_id = ?"), params.push(filter.sessionId));
    if (filter.imageHash !== undefined) (clauses.push("image_hash = ?"), params.push(filter.imageHash));
    return this.#observationViews(clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", ...params);
  }

  workItems(filter: { open?: boolean } = {}): WorkItemView[] {
    const where = filter.open === undefined ? "" : filter.open ? "WHERE resolution IS NULL" : "WHERE resolution IS NOT NULL";
    return this.#all(`SELECT work_item_id, opened, resolution FROM work_items ${where} ORDER BY seq`).map((r) => ({
      workItemId: r.work_item_id as string,
      opened: parse(r.opened),
      resolution: r.resolution as WorkItemView["resolution"],
    }));
  }

  recommendations(): RecommendationView[] {
    return this.#all("SELECT recommendation_id, ranking_version, current, revisions FROM recommendations ORDER BY seq").map((r) => ({
      recommendationId: r.recommendation_id as string,
      rankingVersion: r.ranking_version as string,
      current: parse(r.current),
      revisions: Number(r.revisions),
    }));
  }

  #runView(r: Row): RunView {
    return {
      runId: r.run_id as string,
      started: parse(r.started),
      usage: { adjudications: Number(r.adjudications), inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens) },
      finished: r.finished === null ? null : parse(r.finished),
    };
  }

  run(runId: string): RunView | undefined {
    const r = this.#get("SELECT * FROM runs WHERE run_id = ?", runId);
    return r && this.#runView(r);
  }

  runs(): RunView[] {
    return this.#all("SELECT * FROM runs ORDER BY seq").map((r) => this.#runView(r));
  }

  images(sessionId?: string): Payload<"ImageAssetIngested">[] {
    const rows = sessionId === undefined
      ? this.#all("SELECT body FROM images ORDER BY seq")
      : this.#all("SELECT body FROM images WHERE session_id = ? ORDER BY seq", sessionId);
    return rows.map((r) => parse(r.body));
  }

  rejections(sessionId?: string): Payload<"ImageRejected">[] {
    const rows = sessionId === undefined
      ? this.#all("SELECT body FROM rejections ORDER BY seq")
      : this.#all("SELECT body FROM rejections WHERE session_id = ? ORDER BY seq", sessionId);
    return rows.map((r) => parse(r.body));
  }

  viewDump(): ViewDump {
    return {
      images: this.images(),
      rejections: this.rejections(),
      observations: this.observations(),
      workItems: this.workItems(),
      recommendations: this.recommendations(),
      runs: this.runs(),
    };
  }
}
