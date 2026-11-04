// F-0f rows, perspective measures and shelf-label rules on synthetic polygons and made-up strings only (no photo,
// no detection output, no reader text from a photo).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Detection } from "../src/eval/f0.ts";
import { kinds } from "../src/eval/f0c.ts";
import { pairedShare, unchanged, verdicts } from "../src/eval/f0f-cli.ts";
import { alongToLine, evidenceOf, hasText, LABEL, labelWhy, lean, perspectiveBoxes, ROW, rowFits, theilSen, TOPS_SHORT, type BoxEvidence } from "../src/eval/f0f.ts";
import { geometry } from "../src/eval/f0e.ts";
import type { Polygon4 } from "../src/eval/labels.ts";

const box = (x: number, y: number, w: number, h: number): Polygon4 => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/** A box w x h centred at (cx, cy), its long side turned `deg` degrees (positive: bottom end to the right). */
function turned(cx: number, cy: number, w: number, h: number, deg: number): Polygon4 {
  const a = (deg * Math.PI) / 180;
  const ux = Math.sin(a), uy = Math.cos(a); // down the long side
  const vx = uy, vy = -ux; // across
  const p = (s: number, t: number): [number, number] => [cx + s * vx * (w / 2) + t * ux * (h / 2), cy + s * vy * (w / 2) + t * uy * (h / 2)];
  return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
}

function det(polys: Polygon4[], covers: Polygon4[] = [], height = 3000): Detection {
  return {
    id: "synthetic",
    width: 8000,
    height,
    spines: polys.map((polygon) => ({ polygon, boxScore: 0.5, maskScore: 0.9, aspect: 5, cut: false })),
    covers: covers.map((polygon) => ({ polygon, boxScore: 0.4, maskScore: 0.9, aspect: 1.4, cut: false })),
    bands: [{ polygon: box(0, 0, 2000, 1000), spines: polys.length, span: 2000, gap: 0 }],
    gaps: { bandLength: 2000, gapLength: 0, gapCount: 0, medianWidth: 100 },
    tiles: 1,
    seconds: 1,
  };
}

/** Ten upright 100 x 1000 spines from x = 0, the sixth replaced by a piece holding only its lower 600 px. */
const shelfWithPiece = () => det(Array.from({ length: 10 }, (_, i) => (i === 5 ? box(500, 400, 100, 600) : box(i * 100, 0, 100, 1000))));

describe("rows from neighbours", () => {
  it("fits a robust line and measures along a direction to it", () => {
    const [a, b] = theilSen([0, 10, 20, 30, 40], [1, 21, 41, 61, 1000], 10);
    expect(a).toBeCloseTo(2);
    expect(b).toBeCloseTo(1);
    expect(theilSen([0, 10, 20], [0, 100, 200], 0.3)[0]).toBe(0.3);
    // From (0, 500) straight up to the line y = 100: 400 px.
    expect(alongToLine(0, 500, 0, -1, [0, 100])).toBeCloseTo(400);
    expect(alongToLine(0, 50, 0, -1, [0, 100])).toBeCloseTo(-50);
  });

  it("finds a piece's row, its spine height and its top line", () => {
    const fits = rowFits(shelfWithPiece());
    const f = fits.get(5)!;
    expect(f.h).toBeCloseTo(1000);
    expect(f.top[0]).toBeCloseTo(0);
    expect(f.top[1]).toBeCloseTo(0);
    expect(f.bottom[1]).toBeCloseTo(1000);
    expect(f.neighbours).not.toContain(5);
  });

  it("reads a row's lean as linear in x, so a box leaning against it stands out", () => {
    // Spines converging downward: lean falls 1 degree per 100 px across; the box at x = 500 leans 12 degrees off.
    const polys = Array.from({ length: 11 }, (_, i) => turned(i * 100 + 50, 500, 60, 1000, (i === 5 ? 12 : 0) + 5 - i));
    const fits = rowFits(det(polys));
    expect(fits.get(5)!.lean).toBeCloseTo(0, 0);
    expect(lean(geometry(polys[5]!))).toBeCloseTo(12, 0);
    const pb = perspectiveBoxes(det(polys));
    expect(pb.find((b) => b.index === 5)!.leanOff).toBeGreaterThan(ROW.angleDev);
    expect(pb.find((b) => b.index === 3)!.leanOff).toBeLessThan(1);
  });
});

describe("perspective measures", () => {
  it("flags a piece short of its row's top, partial, by its third of the frame", () => {
    const pb = perspectiveBoxes(shelfWithPiece(), new Map([["synthetic:5", -0.3], ["synthetic:0", 0.02]]));
    const piece = pb.find((b) => b.index === 5)!;
    expect(piece.shortOfTop).toBeCloseTo(0.4);
    expect(piece.shortOfTop!).toBeGreaterThan(TOPS_SHORT);
    expect(piece.partial).toBe(false); // 600 of 1000 is above F-0e's 0.55
    expect(piece.seam).toBe(-0.3);
    expect(piece.third).toBe("top");
    expect(pb.find((b) => b.index === 0)!.shortOfTop).toBeCloseTo(0);
    // The same shelf low in a taller frame is in the bottom third.
    expect(perspectiveBoxes({ ...shelfWithPiece(), height: 700 })[0]!.third).toBe("bottom");
  });

  it("compares a pooled share, arm against base, paired by photo", () => {
    const rows = (k: number, n: number, id: string) => Array.from({ length: n }, (_, i) => ({ imageId: id, x: i < k }));
    const base = [...rows(2, 10, "a"), ...rows(4, 10, "b")];
    const arm = [...rows(1, 10, "a"), ...rows(2, 10, "b")];
    const d = pairedShare(base, arm, (r) => r.x, 200)!;
    expect(d[0]).toBeCloseTo(-0.15);
    expect(d[2]).toBeLessThan(0);
  });

  it("maps unchanged boxes by polygon and leaves changed ones out", () => {
    const a = shelfWithPiece();
    const b = { ...a, spines: [a.spines[1]!, { ...a.spines[5]!, polygon: box(500, 0, 100, 1000) }, a.spines[0]!] };
    expect([...unchanged(a, b)]).toEqual([[0, 1], [2, 0]]);
  });
});

describe("shelf labels and cards", () => {
  const ev = (texts: string[], probe?: { white: number; edges: number }): BoxEvidence => ({ texts, textFound: texts.some(hasText), probe });
  const strip = box(0, 1000, 900, 80);
  const card = box(0, 1000, 400, 220);
  const cover = box(0, 0, 650, 1000);

  it("names a genre strip by its words and its shape, never a cover reading the strip below it", () => {
    expect(labelWhy(strip, ev(["Science Fiction/Fantasy (Alphabetical by Author)"]))).toBe("shelf-strip");
    expect(labelWhy(strip, ev(["Science FictionlFantasy"]))).toBe("shelf-strip");
    expect(labelWhy(strip, ev(["Fantasy (AphabeticalbyAu"]))).toBe("shelf-strip");
    expect(labelWhy(cover, ev(["A DANCE WITH DRAGONS\nScience Fiction/Fantasy"]))).toBeNull();
    // Genre words alone are an imprint's, and one reading never runs into the next.
    expect(labelWhy(strip, ev(["SCIENCE FICTION", "FANTASY"]))).toBeNull();
    expect(labelWhy(strip, evidenceOf({ vision: { variants: [{ text: "M4S SCIENCE FICTION" }, { text: "FANTASY" }] } }))).toBeNull();
  });

  it("names a shelf-talker by its phrasing, through OCR slips", () => {
    expect(labelWhy(card, ev(["Like Some Author?\nNow try..\nOther Writer"]))).toBe("shelf-talker");
    expect(labelWhy(card, ev(["Lika Somo Author?"]))).toBe("shelf-talker");
    expect(labelWhy(cover, ev(["Staff Pick!"]))).toBe("shelf-talker");
    expect(labelWhy(card, ev(["Something Like Love"]))).toBeNull();
  });

  it("names a blank card only when no reader found text, its pixels are flat white and it lies flat", () => {
    const white = { white: 0.9, edges: 0.1 };
    expect(labelWhy(card, ev(["", " ", "Title: ...\nAuthor: ...\nImprint: ..."], white))).toBe("blank-card");
    expect(labelWhy(card, ev(["A BOOK"], white))).toBeNull();
    expect(labelWhy(card, ev([""], { white: 0.6, edges: 0.1 }))).toBeNull();
    expect(labelWhy(card, ev([""], { white: 0.9, edges: 0.3 }))).toBeNull();
    // A white book standing upright is not a card.
    expect(labelWhy(box(0, 0, 100, 400), ev([""], white))).toBeNull();
    expect(labelWhy(card, ev([""]))).toBeNull(); // no probe, no claim
  });

  it("treats empty and none-saying answers as no text", () => {
    expect(hasText("")).toBe(false);
    expect(hasText("...")).toBe(false);
    expect(hasText("Title: none\nAuthor: none\nImprint: none")).toBe(false);
    expect(hasText("unreadable")).toBe(false);
    expect(hasText("A")).toBe(false);
    expect(hasText("DUNE")).toBe(true);
  });

  it("drops a card the cover pass kept and flags a strip on the spine path, only with evidence", () => {
    const shelf = Array.from({ length: 20 }, (_, i) => box(i * 100, 0, 100, 1000));
    const d = det([...shelf, box(0, 1010, 1600, 90)], [box(2200, 300, 640, 480)]);
    const plain = kinds(d);
    expect(plain.covers).toHaveLength(1);
    const e = (ref: string) => (ref === "c0" ? ev(["Like An Author?"]) : ref === "s20" ? ev(["Fiction/Fantasy"]) : ev(["A TITLE"]));
    const k = kinds(d, e);
    expect(k.covers).toHaveLength(0);
    expect(k.dropped.map((b) => b.why)).toContain("shelf-talker");
    expect(k.spines[20]).toMatchObject({ kind: "not-a-book", why: "shelf-strip" });
    expect(k.spines.slice(0, 20).every((b) => b.kind === "spine")).toBe(true);
    // Without evidence F-0c's kinds are unchanged.
    expect(plain.spines[20]!.why).not.toBe("shelf-strip");
  });
});

describe("detect.py and f0f.ts agree", () => {
  it("uses the same row constants", () => {
    const py = readFileSync(new URL("../helpers/label/detect.py", import.meta.url), "utf8");
    const num = (k: string) => Number(py.match(new RegExp(`^${k} = ([0-9.]+)`, "m"))?.[1]);
    expect(num("ROW_WIDTHS")).toBe(ROW.widths);
    expect(num("ROW_LEAN")).toBe(ROW.lean);
    expect(num("ROW_WHOLE")).toBe(ROW.whole);
    expect(num("ANGLE_DEV")).toBe(ROW.angleDev);
    expect(num("TOPS_SHORT")).toBe(TOPS_SHORT);
  });
});

describe("keep rules", () => {
  const t = (v: number, lo: number, hi: number): [number, number, number] => [v, lo, hi];
  const arm = (partial: [number, number, number], seam: number, works: [number, number, number], changed?: [number, number, number]) => ({
    measures: { partial: { delta: partial }, seamError: { delta: t(seam, seam - 0.01, seam + 0.01) } },
    reads: { delta: { worksPerPhoto: works } },
    changedBoxReads: { confirmedShareDelta: changed ?? t(0, 0, 0) },
  });
  const labels = (n: number) => ({ spinePath: { removedConfirmed: n }, coverArm: { removedConfirmed: 0 } });
  const yard = (recall: [number, number, number], wrong: [number, number, number]) => ({ titles: { delta: { recall }, wrongPerImage: wrong } });

  it("ships tops only when partial falls, seams improve, works hold and the yardstick is unhurt", () => {
    const m = (p: any, y: any) => ({ "pilot-000": { arms: { tops: p }, labels: labels(0) }, yardstick: { arms: { tops: y }, labels: labels(0) } });
    expect((verdicts(m(arm(t(-0.02, -0.03, -0.01), -0.01, t(0, -0.5, 0.5)), yard(t(0, -0.01, 0.01), t(0, -0.1, 0.1)))) as any).tops.ship).toBe(true);
    expect((verdicts(m(arm(t(-0.02, -0.03, 0.01), -0.01, t(0, -0.5, 0.5)), yard(t(0, -0.01, 0.01), t(0, -0.1, 0.1)))) as any).tops.ship).toBe(false);
    expect((verdicts(m(arm(t(-0.02, -0.03, -0.01), -0.01, t(-1, -2, -0.5)), yard(t(0, -0.01, 0.01), t(0, -0.1, 0.1)))) as any).tops.ship).toBe(false);
    expect((verdicts(m(arm(t(-0.02, -0.03, -0.01), -0.01, t(0, -0.5, 0.5)), yard(t(-0.05, -0.08, -0.02), t(0, -0.1, 0.1)))) as any).tops.ship).toBe(false);
  });

  it("ships angles only when the boxes it turned read better", () => {
    const m = (changed: [number, number, number]) => ({
      "pilot-000": { arms: { angles: arm(t(0, 0, 0), 0, t(0, -0.5, 0.5), changed) }, labels: labels(0) },
      yardstick: { arms: { angles: yard(t(0, -0.01, 0.01), t(0, -0.1, 0.1)) }, labels: labels(0) },
    });
    expect((verdicts(m(t(0.05, 0.01, 0.09))) as any).angles.ship).toBe(true);
    expect((verdicts(m(t(0.05, -0.01, 0.09))) as any).angles.ship).toBe(false);
  });

  it("ships the label filter only when it removes no confirmed book", () => {
    const m = (n: number) => ({ "pilot-000": { arms: {}, labels: labels(n) }, yardstick: { arms: {}, labels: labels(0) } });
    expect((verdicts(m(0)) as any).labelFilter.ship).toBe(true);
    expect((verdicts(m(1)) as any).labelFilter.ship).toBe(false);
  });
});

describe("label constants", () => {
  it("are the ones the report pre-registered", () => {
    expect(LABEL.white).toBe(0.75);
    expect(LABEL.edges).toBe(0.18);
    expect(LABEL.cardDeg).toBe(40);
    expect(LABEL.stripRatio).toBe(0.35);
  });
});
