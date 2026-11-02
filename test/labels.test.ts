import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LabelSet, assignShelves } from "../src/eval/labels.ts";
import type { Polygon4 } from "../src/eval/labels.ts";
import { fromLabelStudio, polygonToRect, rectToPolygon, toLabelStudio } from "../src/eval/labelstudio.ts";
import type { LsTask } from "../src/eval/labelstudio.ts";

const fixtureDir = new URL("./fixtures/synthetic/", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, fixtureDir), "utf8"));

/** Compare two label sets, numbers (polygon corners) to within 0.05 px. */
function expectSameLabels(a: unknown, b: unknown, path = "labels") {
  if (typeof a === "number" && typeof b === "number") return expect(Math.abs(a - b), path).toBeLessThan(0.05);
  if (a && b && typeof a === "object" && typeof b === "object") {
    expect(Object.keys(a).sort(), path).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(a)) expectSameLabels((a as never)[k], (b as never)[k], `${path}.${k}`);
    return;
  }
  expect(a, path).toEqual(b);
}

const IMAGE = (p: { hash: string }) => `/data/local-files/?d=labels/synthetic/${p.hash.slice(0, 8)}.jpg`;

describe("rotated rectangle geometry", () => {
  it("unrotated box has axis-aligned corners", () => {
    const poly = rectToPolygon({ x: 10, y: 20, width: 5, height: 40 }, 1000, 500);
    expect(poly).toEqual([[100, 100], [150, 100], [150, 300], [100, 300]]);
  });

  it("90 degrees clockwise turns the top edge downwards", () => {
    const [tl, tr, , bl] = rectToPolygon({ x: 50, y: 10, width: 10, height: 5, rotation: 90 }, 1000, 1000);
    expect(tl).toEqual([500, 100]);
    expect(tr[0]).toBeCloseTo(500, 2);
    expect(tr[1]).toBeCloseTo(200, 2);
    expect(bl[0]).toBeCloseTo(450, 2);
    expect(bl[1]).toBeCloseTo(100, 2);
  });

  it("polygonToRect inverts rectToPolygon", () => {
    const v = { x: 12.5, y: 7.25, width: 3.5, height: 41, rotation: -23.5 };
    const back = polygonToRect(rectToPolygon(v, 8064, 6048), 8064, 6048);
    for (const k of Object.keys(v) as (keyof typeof v)[]) expect(back[k]).toBeCloseTo(v[k], 2);
  });
});

describe("assignShelves", () => {
  const box = (x: number, y: number, w = 10, h = 30): Polygon4 => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const spine = (id: string, polygon: Polygon4) => ({
    id, polygon, kind: "spine" as const, text: { title: "", author: "" }, unreadable: false, catalogId: null, notes: "",
  });

  it("orders bands top to bottom and spines left to right within a band", () => {
    const bands = [{ id: "lower", polygon: box(0, 100, 200, 50) }, { id: "upper", polygon: box(0, 0, 200, 50) }];
    const out = assignShelves(bands, [spine("b", box(50, 10)), spine("a", box(10, 10)), spine("c", box(20, 105))]);
    expect(out.bands.map((b) => b.id)).toEqual(["upper", "lower"]);
    expect(out.spines.map((s) => [s.id, s.shelf, s.ordinal])).toEqual([["b", 0, 1], ["a", 0, 0], ["c", 1, 0]]);
    expect(out.outsideBands).toBe(0);
  });

  it("puts a spine outside every band on the nearest one and counts it", () => {
    const out = assignShelves([{ id: "only", polygon: box(0, 0, 100, 40) }], [spine("x", box(10, 200))]);
    expect(out.spines[0]).toMatchObject({ shelf: 0, ordinal: 0 });
    expect(out.outsideBands).toBe(1);
  });

  it("leaves shelf and ordinal null when there are no bands", () => {
    const out = assignShelves([], [spine("x", box(10, 10))]);
    expect(out.spines[0]).toMatchObject({ shelf: null, ordinal: null });
  });
});

const rect = (x: number, y: number, w: number, h: number, rot: number): Polygon4 => rectToPolygon({ x: (x / 4000) * 100, y: (y / 3000) * 100, width: (w / 4000) * 100, height: (h / 3000) * 100, rotation: rot }, 4000, 3000);

describe("Label Studio converter", () => {
  const tasks: LsTask[] = read("labelstudio-export-shelf.json");

  it("imports a real Label Studio export into a valid label set", () => {
    const { labels, warnings } = fromLabelStudio("synthetic", tasks);
    expect(LabelSet.safeParse(labels).success).toBe(true);
    expect(warnings).toEqual([]);
    const photo = labels.photos[0]!;
    expect(photo.shelfBands).toHaveLength(1);
    expect(photo.spines.length).toBeGreaterThan(0);
    expect(photo.spines.map((s) => s.ordinal)).toEqual(photo.spines.map((_, i) => i).sort((a, b) => a - b));
    expect(photo.spines.every((s) => s.shelf === 0 && s.catalogId === null)).toBe(true);
    expect(photo.spines.some((s) => s.text.title.length > 0 && s.text.author.length > 0)).toBe(true);
  });

  it("round-trips export -> schema -> Label Studio -> schema", () => {
    const first = fromLabelStudio("synthetic", tasks).labels;
    const again = fromLabelStudio("synthetic", toLabelStudio(first, IMAGE)).labels;
    expectSameLabels(again, first);
  });

  it("round-trips schema -> Label Studio -> schema for a hand-built set, including flags and series", () => {
    const set = LabelSet.parse({
      schemaVersion: 1,
      session: "hand-built",
      photos: [{
        hash: "a".repeat(64), setting: "whole-48", shelfIndex: null, width: 4000, height: 3000,
        shelfBands: [
          { id: "b0", polygon: rect(100, 200, 3800, 640, 0.9) },
          { id: "b1", polygon: rect(100, 1200, 3800, 640, 0.9) },
        ],
        spines: [
          { id: "s0", polygon: rect(200, 240, 120, 560, 2), shelf: 0, ordinal: 0, kind: "spine",
            text: { title: "Neuromancer", author: "William Gibson", series: "Sprawl" }, unreadable: false, catalogId: null, notes: "price sticker" },
          { id: "s1", polygon: rect(400, 250, 120, 560, 2), shelf: 0, ordinal: 1, kind: "face-out",
            text: { title: "", author: "" }, unreadable: true, catalogId: null, notes: "" },
          { id: "s2", polygon: rect(200, 1250, 700, 120, 1), shelf: 1, ordinal: 0, kind: "stacked",
            text: { title: "Dune", author: "Frank Herbert" }, unreadable: false, catalogId: null, notes: "" },
        ],
      }],
    });
    const back = fromLabelStudio("hand-built", toLabelStudio(set, IMAGE)).labels;
    expectSameLabels(back, set);
  });

  it("never imports predictions, cancelled annotations or tasks without labels", () => {
    const base = tasks[0]!;
    const cancelled: LsTask = { ...base, annotations: [{ ...base.annotations![0]!, was_cancelled: true }], predictions: [{ result: [] }] };
    const empty: LsTask = { ...base, annotations: [] };
    const { labels, warnings } = fromLabelStudio("synthetic", [cancelled, empty]);
    expect(labels.photos).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it("keeps catalogId from an earlier import when the same spine is re-imported", () => {
    const first = fromLabelStudio("synthetic", tasks).labels;
    const resolved = structuredClone(first);
    resolved.photos[0]!.spines[0]!.catalogId = "not-in-catalog";
    const again = fromLabelStudio("synthetic", tasks, resolved).labels;
    expect(again.photos[0]!.spines[0]!.catalogId).toBe("not-in-catalog");
  });

  it("re-importing replaces a photo and keeps photos absent from the export", () => {
    const first = fromLabelStudio("synthetic", tasks).labels;
    const other = structuredClone(first.photos[0]!);
    other.hash = "b".repeat(64);
    const withOther = { ...first, photos: [...first.photos, other] };
    const again = fromLabelStudio("synthetic", tasks, withOther).labels;
    expect(again.photos.map((p) => p.hash).sort()).toEqual([first.photos[0]!.hash, other.hash].sort());
  });
});

describe("pnpm labels:import", () => {
  it("writes only under $BOOKCASE_DATA/labels/ and the file validates", () => {
    const data = mkdtempSync(join(tmpdir(), "bookcase-labels-"));
    const out = execFileSync("node", ["src/eval/labels-import.ts", "test/fixtures/synthetic/labelstudio-export-shelf.json", "--session", "synthetic"], {
      encoding: "utf8",
      env: { ...process.env, BOOKCASE_DATA: data },
    });
    expect(out).toContain(`${data}/labels/synthetic.json`);
    const written = JSON.parse(readFileSync(`${data}/labels/synthetic.json`, "utf8"));
    expect(LabelSet.safeParse(written).success).toBe(true);
  });

  it("rejects a session id that could escape the labels directory", () => {
    expect(() =>
      execFileSync("node", ["src/eval/labels-import.ts", "test/fixtures/synthetic/labelstudio-export-shelf.json", "--session", "../x"], { stdio: "pipe" }),
    ).toThrow();
  });
});
