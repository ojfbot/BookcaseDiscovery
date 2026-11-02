import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog/build.ts";
import type { Candidate } from "../src/catalog/retrieve.ts";
import { buildLabelSet, decide, machineAgreement, variantsOf, type Detection, type Reading } from "../src/eval/f0.ts";
import { LabelSet } from "../src/eval/labels.ts";
import { makeMiniStaging } from "./helpers/mini-staging.ts";

const dir = mkdtempSync(join(tmpdir(), "bookcase-f0-"));
let db: DatabaseSync;
beforeAll(() => {
  makeMiniStaging(join(dir, "staging.sqlite"));
  buildCatalog({ staging: join(dir, "staging.sqlite"), out: join(dir, "catalog.sqlite"), now: () => new Date("2026-11-02T00:00:00Z") });
  db = new DatabaseSync(join(dir, "catalog.sqlite"), { readOnly: true });
});
afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const read = (reader: Reading["reader"], ...texts: string[]): Reading => ({
  id: "x",
  reader,
  variants: texts.map((text, i) => ({ rotation: i % 2 ? 270 : 90, text, confidence: 0.9 })),
  seconds: 0,
});
const run = (reads: Partial<Record<Reading["reader"], Reading>>) => decide(db, "img:0", "img", 0.4, reads, new Map<string, Candidate | undefined>());

describe("decide (OC36: readers agree and the catalog confirms)", () => {
  it("accepts when two readers name the same work", () => {
    const d = run({ vision: read("vision", "NEUROMANCER WILLIAM GIBSON", ""), ppocr: read("ppocr", "", "Neuromancer Gibson") });
    expect(d.accepted?.workId).toBe("isfdb:201");
    expect(d.agreeing.sort()).toEqual(["ppocr", "vision"]);
    expect(d.reason).toBeNull();
    expect(d.hard).toBe(false);
  });

  it("leaves one confirming reader unknown (single-reader) and marks the crop hard", () => {
    const d = run({ vision: read("vision", "NEUROMANCER WILLIAM GIBSON"), ppocr: read("ppocr", "") });
    expect(d.accepted).toBeNull();
    expect(d.reason).toBe("single-reader");
    expect(d.hard).toBe(true);
  });

  it("a third reader (the VLM on a hard crop) can complete the pair", () => {
    const d = run({ vision: read("vision", "NEUROMANCER WILLIAM GIBSON"), ppocr: read("ppocr", "zzqx"), qwen: read("qwen", "Neuromancer\nWilliam Gibson") });
    expect(d.accepted?.workId).toBe("isfdb:201");
    expect(d.agreeing.sort()).toEqual(["qwen", "vision"]);
  });

  it("names the reason when readers disagree, read nothing, or match nothing", () => {
    expect(run({ vision: read("vision", "NEUROMANCER WILLIAM GIBSON"), ppocr: read("ppocr", "RED MARS KIM STANLEY ROBINSON") }).reason).toBe("readers-disagree");
    expect(run({ vision: read("vision", "", " "), ppocr: read("ppocr", "") }).reason).toBe("no-text");
    expect(run({ vision: read("vision", "COOKING WITH HERBS"), ppocr: read("ppocr", "COOKING HERBS") }).reason).toBe("no-catalog-match");
  });

  it("ignores empty and one-letter readings and de-duplicates the rest", () => {
    expect(variantsOf(read("vision", "", "a", "Dune  Herbert", "Dune Herbert"))).toEqual(["Dune Herbert"]);
  });
});

describe("buildLabelSet", () => {
  it("writes schema-valid machine labels with reasons in notes", () => {
    const sq = (x: number): [number, number][] => [[x, 10], [x + 20, 10], [x + 20, 110], [x, 110]];
    const det: Detection = {
      id: "img", width: 400, height: 200, tiles: 1, seconds: 1,
      spines: [0, 30, 60].map((x) => ({ polygon: sq(x) as never, boxScore: 0.4, maskScore: 0.9, aspect: 5, cut: false })),
      bands: [{ polygon: [[0, 5], [90, 5], [90, 115], [0, 115]], spines: 3, span: 80, gap: 0 }],
      gaps: { bandLength: 80, gapLength: 0, gapCount: 0, medianWidth: 20 },
    };
    const accepted = run({ vision: read("vision", "NEUROMANCER WILLIAM GIBSON"), ppocr: read("ppocr", "Neuromancer Gibson") });
    const unknown = run({ vision: read("vision", "") });
    const decisions = new Map([["img:0", accepted], ["img:1", { ...unknown, id: "img:1" }]]);
    const set = LabelSet.parse(buildLabelSet("pilot-test", [{ id: "img", photoHash: "a".repeat(64), path: "/x.jpg", setting: "real-use" }], new Map([["img", det]]), decisions));
    const spines = set.photos[0]!.spines;
    expect(spines.map((s) => s.ordinal)).toEqual([0, 1, 2]);
    expect(spines[0]!.catalogId).toBe("isfdb:201");
    expect(spines[0]!.text.title).toBe("Neuromancer");
    expect(spines[1]!.catalogId).toBeNull();
    expect(spines[1]!.unreadable).toBe(true);
    expect(spines[1]!.notes).toBe("machine:unknown reason=no-text");
    expect(spines[2]!.notes).toBe("machine:unknown reason=not-read");
    const m = machineAgreement(new Map([["img", det]]), [accepted, { ...unknown, id: "img:1" }], new Map());
    expect(m.catalogConfirmed).toEqual({ count: 1, share: 0.5 });
    expect(m.unknownByReason).toEqual({ "no-text": 1 });
  });
});
