// U-4: display modes and display variants (docs/capture/display-modes.md).
// A display mode says who the glass is for and which overlay layers it may draw; a display variant is one named
// style of a mode, for blue/green comparison. Everything a variant draws is in the data below: the renderer
// (display-draw.ts) draws the layers a variant lists with the parameters it carries and never branches on a mode's
// or variant's name. Orthogonal to U-1's overlay lens: any lens works inside any mode.
import { createHash } from "node:crypto";
import { RUNGS, filled } from "../eval/q2.ts";
import type { Rung } from "../eval/q2.ts";

export const DISPLAY_MODES = ["dev", "labelling", "user"] as const;
export type DisplayModeId = (typeof DISPLAY_MODES)[number];

/** Overlay layers, bottom to top in the order a variant lists them. */
export const LAYER_KINDS = [
  "scrim", // dims the photo; filled spines can be lifted out of it
  "tile-edge", // detector tile edges (dev)
  "band-line", // shelf band outlines (dev)
  "box", // oriented box per spine
  "cut-flag", // boxes touching an inner tile edge
  "partial-flag", // boxes much shorter than their band's spines
  "box-id", // raw box index
  "box-score", // detector box score
  "top-face", // a book's visible top face, lit as a second, dimmer shape beside its spine (H-2)
  "coverage-fill", // capture coverage per spine: filled / patchy, object-shaped (Q-0 §3)
  "highlight", // object-shaped highlight on recognised spines
  "machine-guess", // the machine's title guess, along the spine
  "rung-tag", // the spine's coverage rung, beside the guess
] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

/** Layers that show numbers, ids, text or developer geometry. The user mode may draw none of them. */
export const TOOLING_LAYERS: readonly LayerKind[] = ["tile-edge", "band-line", "box", "cut-flag", "partial-flag", "box-id", "box-score", "machine-guess", "rung-tag"];

export interface DisplayMode {
  id: DisplayModeId;
  audience: string;
  layers: readonly LayerKind[];
}

export const MODES: Record<DisplayModeId, DisplayMode> = {
  dev: {
    id: "dev",
    audience: "the owner and agents debugging perception: every box, its id and score, bands, tiles and flags",
    layers: ["scrim", "tile-edge", "band-line", "box", "cut-flag", "partial-flag", "box-id", "box-score"],
  },
  labelling: {
    id: "labelling",
    audience: "machine-first labelling review: hairline boxes, the machine's guess and its rung",
    layers: ["scrim", "box", "machine-guess", "rung-tag"],
  },
  user: {
    id: "user",
    audience: "the shopper: object-shaped highlights and capture-coverage fill; no boxes, no numbers, no labels",
    layers: ["scrim", "top-face", "coverage-fill", "highlight"],
  },
};

// --- style data ----------------------------------------------------------------------------------------------

/** Lengths are in display pixels at this long edge and scale with the shown image. */
export const REF_EDGE = 2000;

/** How a spine's shape is drawn: from its mask outline (pieces clipped to its box) or its oriented box. */
export interface ShapeSpec {
  source: "mask" | "quad";
  /** Draw the convex hull of the spine's mask pieces: one clean shape, no notches or seams between pieces. */
  hull: boolean;
  /** Chaikin corner-cutting passes on the outline: more passes, softer and steadier edges. */
  smoothing: number;
  /**
   * Cut the outline back to the spine face where the depth stage trimmed the box (H-2: the box over-selects and the
   * trim is feasible), so the light stops at the book's top edge instead of running onto its top or a cover.
   */
  face?: boolean;
}

/** One paint: what fills or edges a shape. `kind` picks a primitive; every number is a parameter. */
export interface Paint {
  kind: "none" | "glow" | "veil" | "ridge" | "stipple" | "hatch" | "rim";
  colour: string;
  opacity: number;
  /** glow: blur radius of the edge light; veil: feather of the fill edge. */
  blurPx?: number;
  /** A crisp stroke along the outline on top of the paint (0 = none). */
  rimPx?: number;
  rimOpacity?: number;
  /** ridge / stipple / hatch: distance between lines or dots. */
  spacingPx?: number;
  /** ridge / hatch: line width; stipple: dot radius. */
  markPx?: number;
  /** A dark blurred halo under a light paint, so it reads on bright scenes (U-1 §7.1: the ink ring). */
  haloOpacity?: number;
}

export type LayerStyle =
  | { kind: "scrim"; colour: string; opacity: number; liftFilled: boolean; liftFeatherPx: number }
  | { kind: "box"; colour: string; opacity: number; widthPx: number; dash?: string }
  | { kind: "cut-flag" | "partial-flag"; colour: string; opacity: number; widthPx: number; dash?: string }
  | { kind: "band-line" | "tile-edge"; colour: string; opacity: number; widthPx: number; dash?: string }
  | { kind: "box-id" | "box-score"; colour: string; sizePx: number }
  | { kind: "machine-guess"; colour: string; sizePx: number; maxShare: number }
  | { kind: "rung-tag"; filledColour: string; patchyColour: string; sizePx: number }
  | { kind: "coverage-fill"; shape: ShapeSpec; filled: Paint; patchy: Paint }
  | { kind: "highlight"; shape: ShapeSpec; minRung: Rung; paint: Paint }
  | { kind: "top-face"; minState: "patchy" | "filled"; smoothing: number; paint: Paint };

export interface DisplayVariant {
  id: string;
  mode: DisplayModeId;
  name: string;
  intent: string;
  layers: LayerStyle[];
}

const PAPER = "#fcfbf6"; // U-1 --card
const INK = "#100e08"; // U-1 scrim ink
const NONE: Paint = { kind: "none", colour: PAPER, opacity: 0 };

const devLayers = (scrim: number, whole: string): LayerStyle[] => [
  { kind: "scrim", colour: INK, opacity: scrim, liftFilled: false, liftFeatherPx: 0 },
  { kind: "tile-edge", colour: "#d65bd6", opacity: 0.55, widthPx: 1, dash: "2 4" },
  { kind: "band-line", colour: "#5fd3e8", opacity: 0.8, widthPx: 1.5, dash: "10 6" },
  { kind: "box", colour: whole, opacity: 0.9, widthPx: 1.2 },
  { kind: "cut-flag", colour: "#e2231a", opacity: 1, widthPx: 2 },
  { kind: "partial-flag", colour: "#ff9a1f", opacity: 1, widthPx: 2, dash: "4 3" },
  { kind: "box-id", colour: PAPER, sizePx: 9 },
  { kind: "box-score", colour: "#ffd84a", sizePx: 8 },
];

export const VARIANTS: DisplayVariant[] = [
  {
    id: "dev-boxes",
    mode: "dev",
    name: "Dev · boxes",
    intent: "F-0e's render language: yellow boxes, red cuts, orange partials, bands and tiles, ids and scores",
    layers: devLayers(0.2, "#ffd400"),
  },
  {
    id: "dev-quiet",
    mode: "dev",
    name: "Dev · quiet",
    intent: "the same layers on a darker scrim with paper boxes, for dense shelves",
    layers: devLayers(0.45, PAPER),
  },
  {
    id: "labelling-hairline",
    mode: "labelling",
    name: "Labelling · hairline",
    intent: "U-1 hairlines, the machine's guess along each spine, its rung (green from text-read up, amber below)",
    layers: [
      { kind: "scrim", colour: INK, opacity: 0.35, liftFilled: false, liftFeatherPx: 0 },
      { kind: "box", colour: PAPER, opacity: 0.38, widthPx: 0.8 },
      { kind: "machine-guess", colour: PAPER, sizePx: 11, maxShare: 0.9 },
      { kind: "rung-tag", filledColour: "#52b083", patchyColour: "#e0a53a", sizePx: 8 },
    ],
  },
  {
    id: "user-glow",
    mode: "user",
    name: "User · glow",
    intent: "a soft paper-white light hugging each read spine's outline; patchy spines a faint stipple",
    layers: [
      { kind: "scrim", colour: INK, opacity: 0.34, liftFilled: true, liftFeatherPx: 6 },
      {
        kind: "coverage-fill",
        shape: { source: "mask", hull: true, smoothing: 2 },
        filled: { kind: "glow", colour: PAPER, opacity: 0.4, blurPx: 5, rimPx: 0.6, rimOpacity: 0.3, haloOpacity: 0.18 },
        patchy: { kind: "stipple", colour: PAPER, opacity: 0.45, spacingPx: 7, markPx: 0.9 },
      },
      { kind: "highlight", shape: { source: "mask", hull: true, smoothing: 2 }, minRung: "confirmed", paint: { kind: "rim", colour: PAPER, opacity: 0, rimPx: 1.2, rimOpacity: 0.75, haloOpacity: 0.4 } },
    ],
  },
  {
    id: "user-glow-volume",
    mode: "user",
    name: "User · glow, volume",
    intent: "user-glow cut back to each spine's face (H-2's trim), with the book's visible top face lit as a second, dimmer shape",
    layers: [
      { kind: "scrim", colour: INK, opacity: 0.34, liftFilled: true, liftFeatherPx: 6 },
      { kind: "top-face", minState: "filled", smoothing: 1, paint: { kind: "glow", colour: PAPER, opacity: 0.2, blurPx: 3, rimPx: 0.5, rimOpacity: 0.16 } },
      {
        kind: "coverage-fill",
        shape: { source: "mask", hull: true, smoothing: 2, face: true },
        filled: { kind: "glow", colour: PAPER, opacity: 0.4, blurPx: 5, rimPx: 0.6, rimOpacity: 0.3, haloOpacity: 0.18 },
        patchy: { kind: "stipple", colour: PAPER, opacity: 0.45, spacingPx: 7, markPx: 0.9 },
      },
      { kind: "highlight", shape: { source: "mask", hull: true, smoothing: 2, face: true }, minRung: "confirmed", paint: { kind: "rim", colour: PAPER, opacity: 0, rimPx: 1.2, rimOpacity: 0.75, haloOpacity: 0.4 } },
    ],
  },
  {
    id: "user-veil",
    mode: "user",
    name: "User · veil",
    intent: "a translucent paper fill with a feathered edge over each read spine; patchy spines a fine hatch",
    layers: [
      { kind: "scrim", colour: INK, opacity: 0.18, liftFilled: false, liftFeatherPx: 0 },
      {
        kind: "coverage-fill",
        shape: { source: "mask", hull: true, smoothing: 3 },
        filled: { kind: "veil", colour: "#fff6dc", opacity: 0.3, blurPx: 2.5, haloOpacity: 0.15 },
        patchy: { kind: "hatch", colour: PAPER, opacity: 0.4, spacingPx: 6, markPx: 0.8 },
      },
      { kind: "highlight", shape: { source: "mask", hull: true, smoothing: 3 }, minRung: "confirmed", paint: { kind: "veil", colour: "#fff6dc", opacity: 0.16, blurPx: 1 } },
    ],
  },
  {
    id: "user-ridge",
    mode: "user",
    name: "User · ridges",
    intent: "Touch ID: fine ridges across each spine, sparse while patchy, dense once read; raw mask outline, no hull",
    layers: [
      { kind: "scrim", colour: INK, opacity: 0.26, liftFilled: false, liftFeatherPx: 0 },
      {
        kind: "coverage-fill",
        shape: { source: "mask", hull: false, smoothing: 1 },
        filled: { kind: "ridge", colour: PAPER, opacity: 0.42, spacingPx: 3.5, markPx: 0.9, rimPx: 0.6, rimOpacity: 0.35, haloOpacity: 0.25 },
        patchy: { kind: "ridge", colour: PAPER, opacity: 0.22, spacingPx: 12, markPx: 0.8 },
      },
      { kind: "highlight", shape: { source: "mask", hull: false, smoothing: 1 }, minRung: "confirmed", paint: { kind: "rim", colour: PAPER, opacity: 0, rimPx: 1, rimOpacity: 0.65 } },
    ],
  },
];

// --- coverage state (Q-0 §3: what glass shows per rung) -------------------------------------------------------

export type CoverageState = "not-seen" | "patchy" | "filled";

/** Blank below `seen`, patchy (hatched in Q-0) from `seen` to `text-present`, filled from `text-read` up. */
export function coverageState(rung: Rung | null): CoverageState {
  if (rung === null || rung === "not-seen") return "not-seen";
  return filled(rung) ? "filled" : "patchy";
}

export const rungAtLeast = (rung: Rung, min: Rung): boolean => RUNGS.indexOf(rung) >= RUNGS.indexOf(min);

// --- lookup, checks and identity -----------------------------------------------------------------------------

export function variant(id: string, variants: DisplayVariant[] = VARIANTS): DisplayVariant {
  const v = variants.find((x) => x.id === id);
  if (!v) throw new Error(`no display variant "${id}"`);
  return v;
}

export const variantsOf = (mode: DisplayModeId, variants: DisplayVariant[] = VARIANTS): DisplayVariant[] => variants.filter((v) => v.mode === mode);

/** Every rule the registry must keep. Returns problems, empty when sound. */
export function checkRegistry(variants: DisplayVariant[] = VARIANTS): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const v of variants) {
    if (ids.has(v.id)) out.push(`${v.id}: duplicate id`);
    ids.add(v.id);
    if (!/^[a-z][a-z0-9-]*$/.test(v.id)) out.push(`${v.id}: id is not kebab-case`);
    if (!v.id.startsWith(`${v.mode}-`)) out.push(`${v.id}: id does not start with its mode`);
    const mode = MODES[v.mode];
    if (!mode) {
      out.push(`${v.id}: unknown mode ${String(v.mode)}`);
      continue;
    }
    const kinds = v.layers.map((l) => l.kind);
    if (new Set(kinds).size !== kinds.length) out.push(`${v.id}: a layer is listed twice`);
    for (const k of kinds) if (!mode.layers.includes(k)) out.push(`${v.id}: layer ${k} is not allowed in mode ${v.mode}`);
    if (v.mode === "user") for (const k of kinds) if (TOOLING_LAYERS.includes(k)) out.push(`${v.id}: the user mode draws no ${k}`);
    for (const l of v.layers) {
      const ops = "opacity" in l ? [l.opacity] : [];
      if (l.kind === "coverage-fill") ops.push(l.filled.opacity, l.patchy.opacity);
      if (l.kind === "highlight" || l.kind === "top-face") ops.push(l.paint.opacity);
      for (const o of ops) if (!(o >= 0 && o <= 1)) out.push(`${v.id}: ${l.kind} opacity ${o} is outside 0..1`);
    }
  }
  for (const m of DISPLAY_MODES) if (!variants.some((v) => v.mode === m)) out.push(`mode ${m} has no variant`);
  if (variants.filter((v) => v.mode === "user").length < 2) out.push("the user mode needs two or more variants for blue/green");
  return out;
}

/** Canonical JSON: keys sorted at every depth, so the hash does not depend on key order. */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object")
    return `{${Object.keys(x)
      .sort()
      .filter((k) => (x as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(x);
}

/**
 * The hash a session logs beside a variant's id: SHA-256 over the variant's canonical JSON, first 16 hex.
 * Two sessions compare as one arm only when id and hash both match, so a retuned variant is a new arm.
 */
export const variantHash = (v: DisplayVariant): string => createHash("sha256").update(canonical(v)).digest("hex").slice(0, 16);

// --- feel metrics (defined now; the live prototype Q-6 measures them per variant) --------------------------

export interface FeelMetric {
  id: string;
  unit: string;
  /** What is counted or measured, per display variant. */
  definition: string;
  /** A starting target (INV-23): O-7 sets the real one. `null`: report only. */
  target: string | null;
  /** live: needs frames (Q-6); still: computable on photos today. */
  tier: "live" | "still";
}

export const FEEL_METRICS: FeelMetric[] = [
  { id: "flicker-rate", unit: "events/s", tier: "live", target: "≤ 0.05", definition: "glass state changes on one spine or segment that revert within 500 ms (on→off→on or the reverse), per second of session" },
  { id: "edge-wobble", unit: "px RMS", tier: "live", target: "≤ 1.5 px at p95, phone held still", definition: "RMS distance between a drawn outline and the same outline one frame later, after resampling both to 64 points, in screen points, over tracks held still" },
  { id: "time-to-fill", unit: "s", tier: "live", target: null, definition: "from a segment's first frame in view to its fill committing, p50 and p90 over segments that fill" },
  { id: "uncaused-downgrade", unit: "count", tier: "live", target: "0", definition: "fills or highlights that go down with no `cause` (Q-0 §7 monotone rule); any one is a bug" },
  { id: "highlight-churn", unit: "changes/min", tier: "live", target: null, definition: "highlights entering or leaving per minute of panning, against U-1's SWAP_LIMIT" },
  { id: "outline-jaggedness", unit: "ratio", tier: "still", target: null, definition: "drawn outline perimeter over its convex hull's perimeter, minus 1 (0 = convex), 90th percentile over spines (most outlines are convex; the tail is what shows)" },
  { id: "perturbation-wobble", unit: "ratio", tier: "still", target: null, definition: "RMS outline displacement after the variant's smoothing over the RMS vertex noise put in (σ = 2 % of the spine's width): below 1 the variant damps mask noise" },
  { id: "area-stability", unit: "CV", tier: "still", target: null, definition: "coefficient of variation of drawn area over 8 noisy copies of the outline, median over spines" },
];
