// U-4: display mode registry and the data-driven overlay renderer (docs/capture/display-modes.md). Synthetic shelves only.
import { describe, expect, it } from "vitest";
import { rng } from "../src/eval/q1.ts";
import { DISPLAY_MODES, FEEL_METRICS, MODES, TOOLING_LAYERS, VARIANTS, checkRegistry, coverageState, variant, variantHash, variantsOf } from "../src/report/display-modes.ts";
import type { DisplayVariant } from "../src/report/display-modes.ts";
import { area, attachPieces, baseOutline, chaikin, clipConvex, convexHull, jaggedness, overlaySvg, partialFlags, stillProxies } from "../src/report/display-draw.ts";
import type { Pt, Scene, SceneSpine } from "../src/report/display-draw.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** A synthetic shelf: eight upright spines, one cut, one short, rungs from not-read to confirmed. */
function shelf(): Scene {
  const rungs = ["spine-found", "text-present", "text-read", "matched", "confirmed", "text-read", "spine-found", "confirmed"] as const;
  const spines: SceneSpine[] = rungs.map((rung, i) => {
    const quad = rect(100 + i * 60, i === 6 ? 300 : 100, 150 + i * 60, 500);
    return { index: i, quad, pieces: i % 2 ? [chaikin(quad, 1)] : [], boxScore: 0.3 + i / 20, cut: i === 3, partial: i === 6, rung, guess: i > 1 ? `Synthetic Title ${i}` : null };
  });
  return { width: 700, height: 600, spines, bands: [rect(90, 90, 600, 510)], tiles: [[0, 0, 400, 600], [300, 0, 700, 600]] };
}
const DISPLAY = { width: 1400, height: 1200 };

describe("the display mode registry", () => {
  it("is sound", () => {
    expect(checkRegistry()).toEqual([]);
  });

  it("has dev, labelling and user modes, each with a variant, and two or more user variants for blue/green", () => {
    expect([...DISPLAY_MODES]).toEqual(["dev", "labelling", "user"]);
    for (const m of DISPLAY_MODES) expect(variantsOf(m).length).toBeGreaterThan(0);
    expect(variantsOf("user").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps boxes, numbers and labels out of the user mode", () => {
    for (const k of TOOLING_LAYERS) expect(MODES.user.layers).not.toContain(k);
    const leaky: DisplayVariant = { ...variant("user-glow"), id: "user-leaky", layers: [...variant("user-glow").layers, { kind: "box-score", colour: "#fff", sizePx: 8 }] };
    expect(checkRegistry([...VARIANTS, leaky]).join("\n")).toMatch(/user-leaky: the user mode draws no box-score/);
  });

  it.each([
    ["a duplicate id", (v: DisplayVariant[]) => [...v, v[0]!], /duplicate id/],
    ["a layer the mode does not allow", (v: DisplayVariant[]) => [...v, { ...v[0]!, id: "labelling-x", mode: "labelling" as const }], /layer tile-edge is not allowed in mode labelling/],
    ["an id that does not start with its mode", (v: DisplayVariant[]) => [...v, { ...v[0]!, id: "fancy" }], /does not start with its mode/],
    ["one user variant only", (v: DisplayVariant[]) => v.filter((x) => x.mode !== "user" || x.id === "user-glow"), /two or more variants/],
    ["an opacity above 1", (v: DisplayVariant[]) => [...v, { ...v[0]!, id: "dev-x", layers: [{ kind: "box" as const, colour: "#fff", opacity: 1.5, widthPx: 1 }] }], /opacity 1.5/],
  ])("rejects %s", (_name, mutate, message) => {
    expect(checkRegistry(mutate(structuredClone(VARIANTS))).join("\n")).toMatch(message);
  });

  it("hashes a variant by its parameters, not its key order", () => {
    const v = variant("user-veil");
    const reordered = Object.fromEntries(Object.entries(structuredClone(v)).reverse()) as unknown as DisplayVariant;
    expect(variantHash(reordered)).toBe(variantHash(v));
    const retuned = structuredClone(v);
    (retuned.layers[0] as { opacity: number }).opacity += 0.01;
    expect(variantHash(retuned)).not.toBe(variantHash(v));
    expect(new Set(VARIANTS.map(variantHash)).size).toBe(VARIANTS.length);
  });

  it("maps rungs to Q-0's three glass states", () => {
    expect(coverageState(null)).toBe("not-seen");
    expect(coverageState("not-seen")).toBe("not-seen");
    expect(["seen", "spine-found", "text-present"].map((r) => coverageState(r as never))).toEqual(["patchy", "patchy", "patchy"]);
    expect(["text-read", "matched", "confirmed"].map((r) => coverageState(r as never))).toEqual(["filled", "filled", "filled"]);
  });

  it("defines the live feel metrics Q-6 reports, with zero uncaused downgrades as the target", () => {
    const ids = FEEL_METRICS.map((m) => m.id);
    for (const id of ["flicker-rate", "edge-wobble", "time-to-fill", "uncaused-downgrade"]) expect(ids).toContain(id);
    expect(FEEL_METRICS.find((m) => m.id === "uncaused-downgrade")!.target).toBe("0");
    expect(FEEL_METRICS.some((m) => m.tier === "still")).toBe(true);
  });
});

describe("polygon geometry", () => {
  it("clips a polygon by a convex one in either winding", () => {
    expect(area(clipConvex(rect(0, 0, 10, 10), rect(5, 5, 20, 20)))).toBeCloseTo(25);
    expect(area(clipConvex(rect(0, 0, 10, 10), [...rect(5, 5, 20, 20)].reverse()))).toBeCloseTo(25);
    expect(clipConvex(rect(0, 0, 1, 1), rect(5, 5, 6, 6))).toEqual([]);
  });

  it("smooths, hulls and measures jaggedness", () => {
    const notched: Pt[] = [[0, 0], [10, 0], [10, 10], [5, 4], [0, 10]];
    expect(chaikin(notched, 2)).toHaveLength(notched.length * 4);
    expect(convexHull(notched)).toHaveLength(4);
    expect(jaggedness(rect(0, 0, 10, 20))).toBeCloseTo(0);
    expect(jaggedness(notched)).toBeGreaterThan(0.05);
  });

  it("flags boxes much shorter than their band's spines", () => {
    const quads = [rect(0, 0, 10, 100), rect(10, 0, 20, 100), rect(20, 60, 30, 100), rect(30, 0, 40, 100)];
    expect(partialFlags(quads, [rect(-5, -5, 50, 105)])).toEqual([false, false, true, false]);
  });
});

describe("attaching mask pieces to whole-spine boxes", () => {
  const A = rect(0, 0, 40, 200);
  const B = rect(50, 0, 90, 200);
  const C = rect(100, 0, 140, 200);

  it("gives each box the best rung of its pieces, and the guess from that piece", () => {
    const out = attachPieces(
      [A, B, C],
      [
        { outline: rect(2, 2, 38, 198), rung: "text-read", guess: "a" },
        { outline: rect(52, 0, 88, 90), rung: "spine-found", guess: null },
        { outline: rect(52, 100, 88, 200), rung: "confirmed", guess: "b" },
        { outline: rect(35, 10, 60, 100), rung: "confirmed", guess: "straddler" }, // 60 % inside B
      ],
    );
    expect(out.map((o) => o.rung)).toEqual(["text-read", "confirmed", "spine-found"]);
    expect(out[1]!.guess).toBe("b");
    expect(out[0]!.pieces).toHaveLength(1);
    expect(out[2]).toMatchObject({ pieces: [], guess: null, maskShare: 0 });
  });

  it("draws the box when the pieces cover too little of it", () => {
    const [o] = attachPieces([A], [{ outline: rect(0, 0, 40, 60), rung: "text-read", guess: null }]);
    expect(o!.rung).toBe("text-read");
    expect(o!.pieces).toEqual([]);
  });

  it("starts the drawn outline from the box, the hull of the pieces or the first piece", () => {
    const s = shelf().spines[1]!;
    expect(baseOutline(s, { source: "quad", hull: false, smoothing: 0 })).toBe(s.quad);
    expect(baseOutline(s, { source: "mask", hull: false, smoothing: 0 })).toBe(s.pieces[0]);
    expect(area(baseOutline(s, { source: "mask", hull: true, smoothing: 0 }))).toBeCloseTo(area(convexHull(s.pieces[0]!)));
    const bare = shelf().spines[0]!;
    expect(baseOutline(bare, { source: "mask", hull: true, smoothing: 0 })).toBe(bare.quad);
  });
});

describe("the overlay renderer draws what the variant says, and nothing else", () => {
  const scene = shelf();

  it.each(VARIANTS.map((v) => [v.id, v] as const))("%s: one group per listed layer, self-contained, no filters", (_id, v) => {
    const svg = overlaySvg(scene, v, DISPLAY);
    expect(svg.startsWith("<svg")).toBe(true);
    expect([...svg.matchAll(/data-layer="([a-z-]+)"/g)].map((m) => m[1])).toEqual(v.layers.map((l) => l.kind));
    expect(svg).toContain(`viewBox="0 0 ${DISPLAY.width} ${DISPLAY.height}"`);
    expect(svg).not.toMatch(/href=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    // Browsers drop SVG filters on images with hundreds of complex paths; soft edges are stroke stacks instead.
    expect(svg).not.toMatch(/<filter|filter=/);
  });

  it("user variants draw no text, ids or scores", () => {
    for (const v of variantsOf("user")) expect(overlaySvg(scene, v, DISPLAY)).not.toMatch(/<text|0\.\d\d<\/text>/);
  });

  it("dev variants draw ids and scores; labelling draws guesses and rungs", () => {
    const dev = overlaySvg(scene, variant("dev-boxes"), DISPLAY);
    expect(dev).toMatch(/>7<\/text>/);
    expect(dev).toMatch(/>0\.65<\/text>/);
    const lab = overlaySvg(scene, variant("labelling-hairline"), DISPLAY);
    expect(lab).toContain("Synthetic Title");
    expect(lab).toMatch(/>confirmed<\/text>/);
  });

  it("follows the data: a variant listing only boxes draws only boxes", () => {
    const v: DisplayVariant = { id: "dev-min", mode: "dev", name: "min", intent: "test", layers: [{ kind: "box", colour: "#abcdef", opacity: 0.5, widthPx: 1 }] };
    const svg = overlaySvg(scene, v, DISPLAY);
    expect(svg).toContain('stroke="#abcdef"');
    expect(svg).not.toMatch(/<text|<pattern|<mask/);
  });

  it("fills read spines and leaves unread ones patchy", () => {
    const one = (rung: SceneSpine["rung"]): Scene => ({ ...scene, spines: [{ ...scene.spines[1]!, rung }] });
    const v = variant("user-ridge");
    expect(overlaySvg(one("text-read"), v, DISPLAY)).toMatch(/id="ridge2_4m/); // 3.5 px at the 2000 px reference, shown at 1400 px
    expect(overlaySvg(one("text-present"), v, DISPLAY)).toMatch(/id="ridge8_4m/); // 12 px
  });
});

describe("still proxies for the feel metrics", () => {
  it("smoothing damps mask noise; no smoothing passes it through", () => {
    const outline = chaikin(rect(0, 0, 40, 300), 1);
    const raw = stillProxies(outline, 40, { source: "mask", hull: false, smoothing: 0 }, rng(1));
    const smooth = stillProxies(outline, 40, { source: "mask", hull: false, smoothing: 3 }, rng(1));
    expect(raw.wobble).toBeCloseTo(1, 1);
    expect(smooth.wobble).toBeLessThan(raw.wobble);
    expect(smooth.areaCv).toBeGreaterThan(0);
    expect(smooth.areaCv).toBeLessThan(0.05);
  });
});
