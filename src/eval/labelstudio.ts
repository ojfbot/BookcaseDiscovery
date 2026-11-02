// Converter between Label Studio's JSON export and the label schema (src/eval/labels.ts).
// The labelling config the converter expects is `docs/labelling-config.xml`; names below must match it.
import { assignShelves, LabelSet, SCHEMA_VERSION, spineKinds } from "./labels.ts";
import type { Photo, Polygon4, ShelfBand, Spine, SpineKind } from "./labels.ts";

export const BAND_LABEL = "shelf-band";
const KINDS: ReadonlySet<string> = new Set(spineKinds);
const TEXT_FIELDS = ["title", "author", "series", "notes"] as const;

type Num = number;
export interface LsResult {
  id: string;
  type: string;
  from_name: string;
  to_name: string;
  original_width?: Num;
  original_height?: Num;
  image_rotation?: Num;
  origin?: string;
  value: {
    x?: Num;
    y?: Num;
    width?: Num;
    height?: Num;
    rotation?: Num;
    rectanglelabels?: string[];
    text?: string[];
    choices?: string[];
  };
}
export interface LsAnnotation {
  id?: Num;
  result: LsResult[];
  was_cancelled?: boolean;
  [k: string]: unknown;
}
export interface LsTask {
  id?: Num;
  data: { image: string; hash: string; setting: string; shelfIndex: Num | null; width?: Num; height?: Num };
  annotations?: LsAnnotation[];
  predictions?: unknown[];
  [k: string]: unknown;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Label Studio rotated rectangle (percent of image, rotation in degrees about the top-left) to four pixel corners. */
export function rectToPolygon(v: Required<Pick<LsResult["value"], "x" | "y" | "width" | "height">> & { rotation?: Num }, W: Num, H: Num): Polygon4 {
  const th = ((v.rotation ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(th), Math.sin(th)];
  const x0 = (v.x / 100) * W;
  const y0 = (v.y / 100) * H;
  const w = (v.width / 100) * W;
  const h = (v.height / 100) * H;
  const tr: [number, number] = [x0 + w * c, y0 + w * s];
  const bl: [number, number] = [x0 - h * s, y0 + h * c];
  const br: [number, number] = [tr[0] + bl[0] - x0, tr[1] + bl[1] - y0];
  return [[r3(x0), r3(y0)], [r3(tr[0]), r3(tr[1])], [r3(br[0]), r3(br[1])], [r3(bl[0]), r3(bl[1])]];
}

/** Inverse of `rectToPolygon`. Uses corners 0, 1 and 3, so a polygon that is not a rectangle loses its skew. */
export function polygonToRect(p: Polygon4, W: Num, H: Num) {
  const [dx, dy] = [p[1][0] - p[0][0], p[1][1] - p[0][1]];
  const [ex, ey] = [p[3][0] - p[0][0], p[3][1] - p[0][1]];
  return {
    x: r3((p[0][0] / W) * 100),
    y: r3((p[0][1] / H) * 100),
    width: r3((Math.hypot(dx, dy) / W) * 100),
    height: r3((Math.hypot(ex, ey) / H) * 100),
    rotation: r3((Math.atan2(dy, dx) * 180) / Math.PI),
  };
}

export interface ImportResult {
  labels: LabelSet;
  warnings: string[];
}

/** The annotation to import for a task: the last non-cancelled one with any result. Predictions are never imported. */
function chosenAnnotation(task: LsTask): LsAnnotation | undefined {
  return [...(task.annotations ?? [])].reverse().find((a) => !a.was_cancelled && a.result.length > 0);
}

/**
 * Label Studio export (the JSON format, one object per task) to a `LabelSet`.
 * `existing` supplies `catalogId`s by region id, so re-importing after V-3 does not lose them.
 */
export function fromLabelStudio(session: string, tasks: LsTask[], existing?: LabelSet): ImportResult {
  const warnings: string[] = [];
  const known = new Map<string, string | null>();
  for (const p of existing?.photos ?? []) for (const s of p.spines) known.set(`${p.hash}/${s.id}`, s.catalogId);

  const photos: Photo[] = [];
  for (const task of tasks) {
    const tag = task.data?.hash?.slice(0, 8) ?? `task ${task.id}`;
    const ann = chosenAnnotation(task);
    if (!ann) {
      warnings.push(`${tag}: no annotation, skipped`);
      continue;
    }
    const first = ann.result.find((r) => r.original_width && r.original_height);
    const W = task.data.width ?? first?.original_width;
    const H = task.data.height ?? first?.original_height;
    if (!W || !H) {
      warnings.push(`${tag}: image size unknown, skipped`);
      continue;
    }

    const byId = new Map<string, LsResult[]>();
    for (const r of ann.result) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
    const bands: ShelfBand[] = [];
    const draft: Omit<Spine, "shelf" | "ordinal">[] = [];
    for (const [id, parts] of byId) {
      const box = parts.find((r) => r.type === "rectanglelabels");
      if (!box || box.value.x === undefined) {
        warnings.push(`${tag}: region ${id} has no box, skipped`);
        continue;
      }
      const label = box.value.rectanglelabels?.[0];
      const polygon = rectToPolygon(box.value as never, W, H);
      if (label === BAND_LABEL) {
        bands.push({ id, polygon });
        continue;
      }
      if (!label || !KINDS.has(label)) {
        warnings.push(`${tag}: region ${id} has unknown label "${label}", skipped`);
        continue;
      }
      const text = Object.fromEntries(
        TEXT_FIELDS.map((f) => {
          const t = parts.find((r) => r.from_name === f)?.value.text;
          return [f, (t ?? []).join(" ").trim()];
        }),
      ) as Record<(typeof TEXT_FIELDS)[number], string>;
      const unreadable = parts.some((r) => r.from_name === "flags" && r.value.choices?.includes("unreadable"));
      draft.push({
        id,
        polygon,
        kind: label as SpineKind,
        text: { title: text.title, author: text.author, ...(text.series ? { series: text.series } : {}) },
        unreadable,
        catalogId: known.get(`${task.data.hash}/${id}`) ?? null,
        notes: text.notes,
      });
    }
    const placed = assignShelves(bands, draft);
    if (placed.outsideBands > 0) warnings.push(`${tag}: ${placed.outsideBands} spine(s) outside every shelf band, put on the nearest band`);
    if (bands.length === 0 && draft.length > 0) warnings.push(`${tag}: no shelf-band drawn, shelf and ordinal left null`);
    photos.push({
      hash: task.data.hash,
      setting: task.data.setting,
      shelfIndex: task.data.shelfIndex ?? null,
      width: W,
      height: H,
      shelfBands: placed.bands,
      spines: placed.spines,
    });
  }

  // Photos not in this export stay as they were; photos in it replace their old entry.
  const incoming = new Set(photos.map((p) => p.hash));
  const kept = (existing?.photos ?? []).filter((p) => !incoming.has(p.hash));
  const labels = LabelSet.parse({ schemaVersion: SCHEMA_VERSION, session, photos: [...kept, ...photos] });
  return { labels, warnings };
}

/**
 * `LabelSet` to Label Studio tasks with one annotation per photo, for re-opening labels in the tool.
 * `image` maps a photo to the URL or `/data/local-files/?d=` path the task should load.
 */
export function toLabelStudio(labels: LabelSet, image: (p: Photo) => string): LsTask[] {
  return labels.photos.map((photo) => {
    const common = { original_width: photo.width, original_height: photo.height, image_rotation: 0, origin: "manual" };
    const result: LsResult[] = [];
    const region = (id: string, polygon: Polygon4, label: string) => {
      const base = { id, to_name: "image", ...common, value: polygonToRect(polygon, photo.width, photo.height) };
      result.push({ ...base, type: "rectanglelabels", from_name: "label", value: { ...base.value, rectanglelabels: [label] } });
      return base;
    };
    for (const b of photo.shelfBands) region(b.id, b.polygon, BAND_LABEL);
    for (const s of photo.spines) {
      const base = region(s.id, s.polygon, s.kind);
      const texts: Record<string, string | undefined> = { title: s.text.title, author: s.text.author, series: s.text.series, notes: s.notes };
      for (const [name, text] of Object.entries(texts))
        if (text) result.push({ ...base, type: "textarea", from_name: name, value: { ...base.value, text: [text] } });
      if (s.unreadable) result.push({ ...base, type: "choices", from_name: "flags", value: { ...base.value, choices: ["unreadable"] } });
    }
    return {
      data: { image: image(photo), hash: photo.hash, setting: photo.setting, shelfIndex: photo.shelfIndex, width: photo.width, height: photo.height },
      annotations: [{ result }],
    };
  });
}
