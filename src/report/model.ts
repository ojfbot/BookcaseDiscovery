// The report's view model (W-1): everything the page shows, read from the ledger's views and event log
// and nothing else. No state is re-derived here: the ledger's views say what each spine's status and
// band are; the event log is read only for what the views do not keep (a spine's status history).
import type { Band, Ledger, LedgerEvent, ObservationView, Payload, Polygon, RunView, Status, UnresolvedReason, WorkItemView } from "../ledger/index.ts";

export class ReportError extends Error {}

/** A point in the display derivative's pixel frame. */
export type Pt = [number, number];

export interface DisplayImage {
  /** `ImageAssetIngested.workingCopyHash`: the file the report reads. */
  workingCopyHash: string;
  /** The untouched original's hash (identity only: the report never opens that file). */
  imageHash: string;
  setting: Payload<"ImageAssetIngested">["setting"];
  shelfIndex?: number;
  flags: string[];
  /** Working-copy pixels: the frame every polygon is in. */
  width: number;
  height: number;
  /** The display derivative's size (long edge ≤ 3000). Set when the report is written. */
  display: { width: number; height: number };
  /** Path of the derivative relative to the report folder, or null when the working copy is not in the store. */
  src: string | null;
}

export interface HistoryRow {
  seq: number;
  ts: string;
  runId: string;
  kind: "status" | "band" | "correction";
  text: string;
}

export interface SpineModel {
  observationId: string;
  imageHash: string;
  shelf: number;
  ordinal: number;
  /** The polygon in display pixels: working-copy pixels × (display ÷ working). */
  points: Pt[];
  status: Status | null;
  band: Band | "none";
  reason: UnresolvedReason | null;
  /** The identity the band speaks for, when the band is not `unknown`. */
  identity: { workId: string; title: string | null; author: string | null } | null;
  obs: ObservationView;
  history: HistoryRow[];
  workItems: { workItemId: string; reason: UnresolvedReason; state: "open" | "fulfilled" | "withdrawn" }[];
}

export interface ReportModel {
  session: string;
  run: RunView;
  /** Timestamp of the newest event of the session's run, so a rebuilt report of the same ledger is byte-identical. */
  asOf: string;
  images: DisplayImage[];
  spines: SpineModel[];
  /** Counts by status then band, for the header strip. */
  counts: { total: number; status: Record<Status | "none", number>; band: Record<Band | "none", number> };
  recommendationCount: number;
  rejections: Payload<"ImageRejected">[];
}

export const REASON_TEXT: Record<UnresolvedReason, string> = {
  "missing-pixels": "Too few pixels on the spine to read it; a closer photo is needed.",
  "no-catalog-candidate": "Text was read, but no book in the catalog matches it.",
  "conflicting-evidence": "The evidence points at more than one book and does not settle between them.",
  "strategies-exhausted": "Every reading strategy has been tried; this spine stays open.",
};

/** The run to report: `--run <id>`, else the most recently started one. */
export function pickRun(ledger: Ledger, runId?: string): RunView {
  const runs = ledger.runs();
  if (runId !== undefined) {
    const run = ledger.run(runId);
    if (!run) throw new ReportError(`no run "${runId}" in the ledger (runs: ${runs.map((r) => r.runId).join(", ") || "none"})`);
    return run;
  }
  const last = runs[runs.length - 1];
  if (!last) throw new ReportError("the ledger has no run to report");
  return last;
}

/** Display size for a working-copy size: long edge at most `maxEdge`, never enlarged. */
export function displaySize(width: number, height: number, maxEdge = 3000): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Scale a polygon from working-copy pixels to display pixels (one decimal; the box is drawn, not measured). */
export function scalePolygon(polygon: Polygon, from: { width: number; height: number }, to: { width: number; height: number }): Pt[] {
  const kx = to.width / from.width;
  const ky = to.height / from.height;
  const r = (v: number) => Math.round(v * 10) / 10;
  return polygon.map(([x, y]) => [r(x * kx), r(y * ky)] as Pt);
}

const short = (hash: string) => hash.slice(0, 12);

function describeCause(cause: Payload<"StatusChanged">["cause"]): string {
  if (!cause) return "";
  if (cause.kind === "budget-spent") return " (budget spent)";
  if (cause.kind === "catalog-refresh") return " (catalog refresh)";
  return ` (${cause.kind}, event ${cause.eventSeq})`;
}

function historyOf(events: LedgerEvent[]): Map<string, HistoryRow[]> {
  const by = new Map<string, HistoryRow[]>();
  const add = (id: string, row: HistoryRow) => by.set(id, [...(by.get(id) ?? []), row]);
  for (const e of events) {
    const at = { seq: e.seq, ts: e.ts, runId: e.runId };
    if (e.type === "StatusChanged") {
      const p = e.payload;
      add(p.observationId, { ...at, kind: "status", text: `${p.from ?? "(new)"} → ${p.to}${describeCause(p.cause)}` });
    } else if (e.type === "BandAssigned") {
      const p = e.payload;
      add(p.observationId, {
        ...at,
        kind: "band",
        text: p.band === "unknown" ? `band unknown: ${p.reason}` : `band ${p.band}: ${p.workId}`,
      });
    } else if (e.type === "IdentityCorrected") {
      const c = e.payload.correction;
      add(e.payload.observationId, { ...at, kind: "correction", text: c.kind === "unreadable" ? "corrected: unreadable" : `corrected: ${c.kind} ${c.workId}` });
    }
  }
  return by;
}

/**
 * Build the model for `session`. Each image's `display` size starts as the planned one (long edge ≤ 3000);
 * `prepareImage` may set the real derivative's `display` and `src` before the polygons are scaled to it.
 */
export function buildModel(ledger: Ledger, session: string, runId?: string, prepareImage?: (image: DisplayImage) => void): ReportModel {
  const run = pickRun(ledger, runId);
  const imageEvents = ledger.images(session);
  if (imageEvents.length === 0) throw new ReportError(`the ledger has no images for session "${session}"`);

  const images: DisplayImage[] = [];
  for (const i of imageEvents) {
    if (images.some((x) => x.imageHash === i.imageHash)) continue;
    images.push({
      workingCopyHash: i.workingCopyHash,
      imageHash: i.imageHash,
      setting: i.setting,
      ...(i.shelfIndex !== undefined ? { shelfIndex: i.shelfIndex } : {}),
      flags: i.flags ?? [],
      width: i.width,
      height: i.height,
      display: displaySize(i.width, i.height),
      src: null,
    });
    prepareImage?.(images[images.length - 1]!);
  }

  const events = [...ledger.events()];
  const history = historyOf(events);
  const itemsBy = new Map<string, WorkItemView[]>();
  for (const w of ledger.workItems()) itemsBy.set(w.opened.observationId, [...(itemsBy.get(w.opened.observationId) ?? []), w]);

  const spines: SpineModel[] = [];
  for (const obs of ledger.observations({ sessionId: session })) {
    const image = images.find((i) => i.imageHash === obs.spine.imageHash);
    if (!image) throw new ReportError(`spine "${obs.observationId}" is on image ${short(obs.spine.imageHash)}, which session "${session}" never ingested`);
    const band = obs.band;
    const hit =
      band && band.band !== "unknown"
        ? obs.hypotheses?.candidates.find((c) => c.workId === band.workId)
        : undefined;
    spines.push({
      observationId: obs.observationId,
      imageHash: obs.spine.imageHash,
      shelf: obs.spine.shelf,
      ordinal: obs.spine.ordinal,
      points: scalePolygon(obs.spine.polygon, image, image.display),
      status: obs.status,
      band: band?.band ?? "none",
      reason: band?.band === "unknown" ? band.reason : null,
      identity: band && band.band !== "unknown" ? { workId: band.workId, title: hit?.title ?? null, author: hit?.author ?? null } : null,
      obs,
      history: history.get(obs.observationId) ?? [],
      workItems: (itemsBy.get(obs.observationId) ?? []).map((w) => ({
        workItemId: w.workItemId,
        reason: w.opened.reason,
        state: w.resolution ?? "open",
      })),
    });
  }
  spines.sort((a, b) => a.shelf - b.shelf || a.ordinal - b.ordinal || a.observationId.localeCompare(b.observationId));

  const ids = new Set(spines.map((s) => s.observationId));
  const counts: ReportModel["counts"] = {
    total: spines.length,
    status: { unresolved: 0, resolved: 0, paused: 0, "needs-pixels": 0, none: 0 },
    band: { verified: 0, probable: 0, candidate: 0, unknown: 0, none: 0 },
  };
  for (const s of spines) {
    counts.status[s.status ?? "none"] += 1;
    counts.band[s.band] += 1;
  }

  return {
    session,
    run,
    asOf: events.filter((e) => e.runId === run.runId).map((e) => e.ts).sort().pop() ?? events.map((e) => e.ts).sort().pop() ?? "",
    images,
    spines,
    counts,
    recommendationCount: ledger.recommendations().filter((r) => ids.has(r.current.observationId)).length,
    rejections: ledger.rejections(session),
  };
}
