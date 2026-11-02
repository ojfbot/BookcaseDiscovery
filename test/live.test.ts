// The live-stream contracts (S9, card T-0): the INV-20 counting rule, the track and card rules as
// the schemas state them, and replay of a recorded event file. The per-event cases that need a
// ledger are in `live-behaviour.ts`, run against both ledgers.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MemoryLedger,
  SqliteLedger,
  TRACK_EDGES,
  TRACK_STATES,
  agreeingObservationCount,
  conditionKey,
  diffCards,
  observationCount,
  payloadSchemas,
  replay,
} from "../src/ledger/index.ts";
import type { NewEvent, Payload } from "../src/ledger/index.ts";
import { payloadSchemaErrors } from "../src/ledger/schemas.ts";
import { exportLines, fill, live, liveScenario } from "./helpers/live-fixtures.ts";

const CONTRACTS = new URL("../contracts/", import.meta.url);
const RECORDED = new URL("./fixtures/contracts/recorded/live-session-000.jsonl", import.meta.url);
const readJson = (path: string): any => JSON.parse(readFileSync(new URL(path, CONTRACTS), "utf8"));

const dir = mkdtempSync(join(tmpdir(), "bookcase-live-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const dbPath = () => join(dir, `live-${counter++}.db`);

type Reading = Payload<"OcrReading">;
const reading = (change: Partial<Reading> = {}): Reading => ({ ...live<"OcrReading">("OcrReading").payload, ...change });

describe("INV-20: repeated readings of one track under one condition are one observation", () => {
  const frontal = { viewpoint: "frontal", exposure: "normal" } as const;

  it("two OcrReadings with the same condition count as one observation", () => {
    const first = reading({ condition: frontal, frameIndices: [133], text: "EXAMPLE TITLE ALPHA" });
    const later = reading({ condition: { ...frontal }, frameIndices: [190, 191], text: "EXAMPLE TITLE ALPHA", confidence: 0.99 });
    expect(observationCount([first])).toBe(1);
    expect(observationCount([first, later])).toBe(1);
    expect(observationCount(Array.from({ length: 50 }, () => later))).toBe(1);
    expect(conditionKey(first.condition)).toBe(conditionKey(later.condition));
  });

  it("a different viewpoint or a different exposure is another observation", () => {
    const a = reading({ condition: frontal });
    expect(observationCount([a, reading({ condition: { viewpoint: "left-oblique", exposure: "normal" } })])).toBe(2);
    expect(observationCount([a, reading({ condition: { viewpoint: "frontal", exposure: "over" } })])).toBe(2);
    expect(observationCount([a, reading({ condition: { viewpoint: "right-oblique", exposure: "under" } })])).toBe(2);
  });

  it("the same condition on another track is another observation", () => {
    expect(observationCount([reading({ trackId: "track-001" }), reading({ trackId: "track-002" })])).toBe(2);
  });

  it("agreement counts observations, not readings: a band may rise only across conditions", () => {
    const sameCondition = [reading({ text: "A" }), reading({ text: "A" }), reading({ text: "A" })];
    expect(agreeingObservationCount(sameCondition, "A")).toBe(1);
    const acrossConditions = [...sameCondition, reading({ text: "A", condition: { viewpoint: "left-oblique", exposure: "normal" } })];
    expect(agreeingObservationCount(acrossConditions, "A")).toBe(2);
    const disagreeing = [...sameCondition, reading({ text: "B", condition: { viewpoint: "left-oblique", exposure: "normal" } })];
    expect(agreeingObservationCount(disagreeing, "A")).toBe(1);
  });

  it("holds for readings as the ledger stores them", () => {
    const ledger = fill(new MemoryLedger(), liveScenario().slice(0, 6));
    ledger.append(live<"OcrReading">("OcrReading", { frameIndices: [190], confidence: 0.97 })); // same condition as seq 6
    const readings = [...ledger.events()].flatMap((e) => (e.type === "OcrReading" ? [e.payload] : []));
    expect(readings).toHaveLength(2);
    expect(observationCount(readings)).toBe(1);
  });
});

describe("Track: the legal transitions", () => {
  const states = [null, ...TRACK_STATES] as const;
  const base = live<"Track">("Track.born").payload;

  it("exactly the five legal edges pass the schema and Zod; every other pair of states fails both", () => {
    const accepted: string[] = [];
    for (const previous of states) {
      for (const state of TRACK_STATES) {
        const payload = { ...base, state, previous };
        const bySchema = payloadSchemaErrors("Track", payload).length === 0;
        const byZod = payloadSchemas.Track.safeParse(payload).success;
        expect(bySchema, `${previous} -> ${state}`).toBe(byZod);
        if (bySchema) accepted.push(`${previous} -> ${state}`);
      }
    }
    expect(accepted).toEqual(["null -> born", "born -> stable", "born -> lost", "stable -> lost", "lost -> stable"]);
    expect(TRACK_EDGES.map(([from, to]) => `${from} -> ${to}`)).toEqual(accepted);
  });

  it("is documented where people look: docs/contracts.md lists every edge", () => {
    const doc = readFileSync(new URL("../docs/contracts.md", import.meta.url), "utf8");
    for (const [from, to] of TRACK_EDGES) expect(doc).toContain(`\`${from ?? "(none)"}\` → \`${to}\``);
  });
});

describe("INV-21: a card revision is explicit, by construction", () => {
  const required = (type: string): string[] => readJson(`events/${type}.schema.json`).required;

  it("CardRevised cannot be written without what it was, why, and the exact diff", () => {
    expect(required("CardRevised")).toEqual(expect.arrayContaining(["previous", "reasonEventSeqs", "diff", "card"]));
    const schema = readJson("events/CardRevised.schema.json");
    expect(schema.properties.reasonEventSeqs.minItems).toBe(1);
    expect(schema.properties.diff.minItems).toBe(1);
  });

  it("CardUndo names the revision it reverses and what it restores; CardRetracted what left and why", () => {
    expect(required("CardUndo")).toEqual(expect.arrayContaining(["revisionEventSeq", "restored"]));
    expect(required("CardRetracted")).toEqual(expect.arrayContaining(["reason", "last", "reasonEventSeqs"]));
    expect(required("CardProposed")).toContain("evidenceEventSeqs");
  });

  it("diffCards lists the changed fields once each, in a fixed order", () => {
    const was = live<"CardProposed">("CardProposed").payload.card;
    expect(diffCards(was, was)).toEqual([]);
    expect(diffCards(was, { ...was, rationale: "Synthetic rationale: new.", rank: 1 }).map((c) => c.field)).toEqual(["rank", "rationale"]);
  });
});

describe("INV-22: a frame sample carries a hash, never pixels, and live frames are not retained", () => {
  const schema = readJson("events/FrameSample.schema.json");

  it("has no field that could hold an image, and counts blurred bystander regions instead of dropping frames", () => {
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["bystanderRegionsBlurred", "capturedAt", "frame", "frameIndex", "hash", "mode", "retention", "sessionId"].sort(),
    );
    expect(schema.properties.bystanderRegionsBlurred.minimum).toBe(0);
  });

  it("a live sample can only say retention 'none'; a sweep keyframe may say 'keyframe'", () => {
    const sample = live<"FrameSample">("FrameSample").payload;
    for (const [mode, retention, ok] of [["live", "none", true], ["live", "keyframe", false], ["sweep", "none", true], ["sweep", "keyframe", true]] as const) {
      const payload = { ...sample, mode, retention };
      expect(payloadSchemaErrors("FrameSample", payload).length === 0, `${mode}/${retention}`).toBe(ok);
      expect(payloadSchemas.FrameSample.safeParse(payload).success, `${mode}/${retention}`).toBe(ok);
    }
  });
});

describe("the live contracts in the ledger", () => {
  it("MemoryLedger and SqliteLedger give the same events and view dump for the live scenario", () => {
    const memory = fill(new MemoryLedger(), liveScenario());
    const sqlite = fill(new SqliteLedger(dbPath()), liveScenario()) as SqliteLedger;
    expect([...sqlite.events()]).toEqual([...memory.events()]);
    expect(JSON.stringify(sqlite.viewDump())).toBe(JSON.stringify(memory.viewDump()));
    sqlite.close();
  });

  it("the scenario, as the ledger exports it, is the recorded file byte for byte", () => {
    expect(exportLines(fill(new MemoryLedger(), liveScenario()))).toBe(readFileSync(RECORDED, "utf8"));
  });
});

describe("replay of a recorded live event file is byte-identical (INV-14)", () => {
  const recorded = readFileSync(RECORDED, "utf8");
  const events = recorded.split("\n").filter(Boolean).map((l) => JSON.parse(l));

  /** Every row of the tables replay must rebuild, as the bytes SQLite stores them. */
  function rows(path: string): Record<string, unknown[]> {
    const db = new DatabaseSync(path, { readOnly: true });
    const out: Record<string, unknown[]> = {};
    for (const table of ["events", "tracks", "cards", "adjudication_requests", "runs", "observations"]) {
      out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map((r) => ({ ...r }));
    }
    db.close();
    return out;
  }

  it("loads the recorded file into SQLite and exports the same bytes", () => {
    expect(events.length).toBe(liveScenario().length);
    const ledger = new SqliteLedger(dbPath());
    for (const { seq: _seq, ...event } of events) ledger.append(event as NewEvent);
    expect(exportLines(ledger)).toBe(recorded);
    ledger.close();
  });

  it("`replay` rebuilds a fresh database that is identical: events, views, and the stored rows", () => {
    const source = dbPath();
    const ledger = new SqliteLedger(source);
    for (const { seq: _seq, ...event } of events) ledger.append(event as NewEvent);
    const sourceDump = JSON.stringify(ledger.viewDump());
    ledger.close();

    const target = dbPath();
    expect(replay(source, target)).toEqual({ events: events.length, identical: true, differences: [] });
    const again = new SqliteLedger(target, { readOnly: true });
    expect(exportLines(again)).toBe(recorded);
    expect(JSON.stringify(again.viewDump())).toBe(sourceDump);
    again.close();
    expect(JSON.stringify(rows(target))).toBe(JSON.stringify(rows(source)));
  });
});
