// A synthetic scan session for the report (W-1): a generated "shelf" of coloured rectangles with invented
// titles, a ledger that has every status and band on it, and the working copies in a data dir's image
// store. Nothing here is a photo and nothing is committed: the images are drawn at test time.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ImageStore, MemoryLedger } from "../../src/ledger/index.ts";
import type { EventType, NewEvent, Payload, Polygon } from "../../src/ledger/index.ts";
import { png } from "./synth.ts";

export const SESSION = "synthetic-shelf-001";
export const RUN = "run-synthetic-001";
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

interface SpineDef {
  id: string;
  shelf: number;
  ordinal: number;
  x: number;
  w: number;
  colour: [number, number, number];
}

const WIDTH = 3200;
const HEIGHT = 2400;
const SHELF_Y: [number, number][] = [
  [320, 1020],
  [1360, 2060],
];
const COLOURS: [number, number, number][] = [
  [122, 62, 54], [58, 92, 110], [196, 160, 78], [84, 112, 84], [140, 96, 132], [48, 56, 82], [170, 98, 52], [92, 92, 92],
];

function layout(shelf: number, count: number): SpineDef[] {
  const out: SpineDef[] = [];
  let x = 240;
  for (let i = 0; i < count; i++) {
    const w = 150 + ((i * 37 + shelf * 11) % 5) * 22;
    out.push({ id: `obs-s${shelf}-${i}`, shelf, ordinal: i, x, w, colour: COLOURS[(i * 3 + shelf) % COLOURS.length]! });
    x += w + 40;
  }
  return out;
}

const SPINES = [...layout(0, 7), ...layout(1, 5)];
const polygonOf = (s: SpineDef): Polygon => {
  const [y0, y1] = SHELF_Y[s.shelf]!;
  return [[s.x, y0], [s.x + s.w, y0], [s.x + s.w, y1], [s.x, y1]];
};

/** The whole-case image: wall, two shelf boards, one coloured rectangle per spine. */
function shelfPng(): Buffer {
  return png(WIDTH, HEIGHT, (x, y) => {
    for (const s of SPINES) {
      const [y0, y1] = SHELF_Y[s.shelf]!;
      if (x >= s.x && x < s.x + s.w && y >= y0 && y < y1) return s.colour;
    }
    for (const [, y1] of SHELF_Y) if (y >= y1 && y < y1 + 36) return [96, 70, 48];
    return [226, 219, 202];
  });
}

/** A closer shelf-48 photo of the one spine that needed it: three bold rectangles. */
function closerPng(): Buffer {
  return png(1600, 1200, (x, y) => {
    if (y > 150 && y < 1050) {
      if (x > 200 && x < 480) return [58, 92, 110];
      if (x > 560 && x < 760) return [196, 160, 78];
    }
    return [226, 219, 202];
  });
}

function toJpeg(pngBytes: Buffer, work: string, name: string): Buffer {
  const src = join(work, `${name}.png`);
  const out = join(work, `${name}.jpg`);
  writeFileSync(src, pngBytes);
  execFileSync("sips", ["-s", "format", "jpeg", src, "--out", out], { stdio: "pipe" });
  const bytes = readFileSync(out);
  rmSync(src);
  rmSync(out);
  return bytes;
}

export interface SyntheticReport {
  ledger: MemoryLedger;
  dataDir: string;
  session: string;
  run: string;
  /** Hash of the original that was never stored: the report must work without it. */
  originalHash: string;
  /** The whole-case working copy's hash, then the closer photo's. */
  workingCopyHashes: [string, string];
}

/** Build the ledger and put both working copies in `dataDir`'s image store. `dataDir` must exist. */
export function syntheticReport(dataDir: string): SyntheticReport {
  mkdirSync(dataDir, { recursive: true });
  const work = join(dataDir, ".work");
  mkdirSync(work, { recursive: true });
  const store = new ImageStore(dataDir);
  const whole = store.put(toJpeg(shelfPng(), work, "whole"), "jpg");
  const closer = store.put(toJpeg(closerPng(), work, "closer"), "jpg");
  rmSync(work, { recursive: true, force: true });
  const originalHash = sha("original: whole case, never stored");
  const closerOriginal = sha("original: closer photo, never stored");

  const ledger = new MemoryLedger({ crossCheck: true });
  let tick = 0;
  const ts = () => `2026-11-02T10:${String(Math.floor(tick / 60)).padStart(2, "0")}:${String(tick++ % 60).padStart(2, "0")}Z`;
  const add = <T extends EventType>(type: T, payload: Payload<T>) => ledger.append({ type, ts: ts(), runId: RUN, payload } as NewEvent);

  const detector = { backend: "synthetic-detector 0.0.0", weightsSha256: "d".repeat(64) };
  const ocr = { helper: "synthetic-ocr 0.0.0", os: "synthetic-os 1.0", requestRevision: 3 };

  add("RunStarted", {
    codeCommit: "5108a5c0000000000000000000000000000000ff",
    helperVersions: { detect: "synthetic-detector 0.0.0", "ocr-vision": "synthetic-ocr 0.0.0" },
    modelIds: ["synthetic-model"],
    budget: { maxAdjudications: 2, maxSpendUsd: 1.5 },
  });
  add("ScanSessionOpened", { sessionId: SESSION, minPixels: 1_000_000 });
  add("ImageAssetIngested", { sessionId: SESSION, imageHash: originalHash, workingCopyHash: whole.hash, format: "jpeg", width: WIDTH, height: HEIGHT, setting: "whole-12", capturedAt: "2026-11-02T09:00:00Z" });
  add("ImageAssetIngested", { sessionId: SESSION, imageHash: closerOriginal, workingCopyHash: closer.hash, format: "jpeg", width: 1600, height: 1200, setting: "shelf-48", shelfIndex: 0, capturedAt: "2026-11-02T09:02:00Z", flags: ["edited-derivative"] });
  add("ImageRejected", { sessionId: SESSION, fileName: "IMG_0003.HEIC", reasons: ["below-min-resolution"] });

  for (const s of SPINES) {
    add("SpineObserved", { observationId: s.id, sessionId: SESSION, imageHash: originalHash, setting: "whole-12", polygon: polygonOf(s), score: 0.9 - s.ordinal * 0.02, shelf: s.shelf, ordinal: s.ordinal, detector });
  }
  const text = (id: string, t: string, confidence = 0.8, rotation: 0 | 90 | 180 | 270 = 90, langCorrection = false) =>
    add("TextObserved", { observationId: id, rotation, langCorrection, text: t, confidence, ocr });
  const evidence = (kind: Payload<"HypothesesProposed">["candidates"][number]["evidence"][number]["kind"], score: number, detail?: string) => ({ kind, score, ...(detail ? { detail } : {}) });
  const hypotheses = (id: string, candidates: [string, string, string, number][], unknown = 0.1) =>
    add("HypothesesProposed", {
      observationId: id,
      candidates: candidates.map(([workId, title, author, score]) => ({ workId, title, author, score, evidence: [evidence("title-fragment", score, "trigram overlap"), evidence("author-fragment", score * 0.8)] })),
      unknown: { score: unknown, evidence: [evidence("threshold", unknown)] },
    });
  const status = (id: string, from: Payload<"StatusChanged">["from"], to: Payload<"StatusChanged">["to"], cause?: Payload<"StatusChanged">["cause"]) =>
    add("StatusChanged", { observationId: id, from, to, ...(cause ? { cause } : {}) });
  const adjudicate = (id: string, choice: string | null, cached = false) =>
    add("AdjudicationRecorded", { observationId: id, model: "synthetic-model", cropHash: "e".repeat(64), candidateSetHash: "f".repeat(64), choice, readText: "invented", cached, inputTokens: cached ? 0 : 900, outputTokens: cached ? 0 : 40 });
  const open = (id: string) => status(id, null, "unresolved");

  // shelf 0, ordinal 0: verified, resolved, adjudicated
  open("obs-s0-0");
  text("obs-s0-0", "THE LANTERN YEARS", 0.93);
  text("obs-s0-0", "THE LANTERN YEARS", 0.88, 90, true);
  hypotheses("obs-s0-0", [["work-lantern", "The Lantern Years", "Ilse Marrow", 0.94], ["work-lantern-2", "Lantern Years II", "Ilse Marrow", 0.31]]);
  adjudicate("obs-s0-0", "work-lantern");
  add("BandAssigned", { observationId: "obs-s0-0", band: "verified", workId: "work-lantern" });
  status("obs-s0-0", "unresolved", "resolved");

  // 1: probable, resolved
  open("obs-s0-1");
  text("obs-s0-1", "CLOCKMAKERS ATLAS", 0.71);
  hypotheses("obs-s0-1", [["work-atlas", "A Clockmaker's Atlas", "Tobias Venn", 0.72]], 0.25);
  add("BandAssigned", { observationId: "obs-s0-1", band: "probable", workId: "work-atlas" });
  status("obs-s0-1", "unresolved", "resolved");

  // 2: candidate, unresolved: two candidates close together
  open("obs-s0-2");
  text("obs-s0-2", "SALT AND ORBIT", 0.62);
  hypotheses("obs-s0-2", [["work-salt-1", "Salt and Orbit", "Mara Quill", 0.55], ["work-salt-2", "Salt & Orbits", "Dov Anselm", 0.52]], 0.3);
  add("BandAssigned", { observationId: "obs-s0-2", band: "candidate", workId: "work-salt-1" });

  // 3: unknown, conflicting evidence
  open("obs-s0-3");
  text("obs-s0-3", "NORTH WIND", 0.58);
  hypotheses("obs-s0-3", [["work-nw-1", "North Wind", "Eda Fenn", 0.41], ["work-nw-2", "The North Wind Papers", "Hal Oste", 0.4]], 0.35);
  add("BandAssigned", { observationId: "obs-s0-3", band: "unknown", reason: "conflicting-evidence" });

  // 4: needs a closer photo (and one came: the work item is fulfilled on the other image's spines)
  open("obs-s0-4");
  text("obs-s0-4", "~ ~ ~", 0.12);
  hypotheses("obs-s0-4", [], 0.9);
  add("BandAssigned", { observationId: "obs-s0-4", band: "unknown", reason: "missing-pixels" });
  status("obs-s0-4", "unresolved", "needs-pixels");
  add("WorkItemOpened", { workItemId: "wi-001", kind: "closer-photo", observationId: "obs-s0-4", shelf: 0, ordinal: 4, reason: "missing-pixels" });

  // 5: resolved, then a correction reopened it
  open("obs-s0-5");
  text("obs-s0-5", "THE GLASS MERIDIAN", 0.9);
  hypotheses("obs-s0-5", [["work-meridian", "The Glass Meridian", "Pell Arden", 0.86]]);
  add("BandAssigned", { observationId: "obs-s0-5", band: "verified", workId: "work-meridian" });
  status("obs-s0-5", "unresolved", "resolved");
  const corrected = add("IdentityCorrected", { observationId: "obs-s0-5", correction: { kind: "not", workId: "work-meridian" } });
  status("obs-s0-5", "resolved", "unresolved", { kind: "correction", eventSeq: corrected.seq });
  add("BandAssigned", { observationId: "obs-s0-5", band: "unknown", reason: "no-catalog-candidate" });
  add("WorkItemOpened", { workItemId: "wi-002", kind: "closer-photo", observationId: "obs-s0-5", shelf: 0, ordinal: 5, reason: "no-catalog-candidate" });

  // 6: detected, nothing else yet: no status, no band
  // shelf 1, ordinal 0: adjudicated, then paused when the run's budget (2 adjudications) was spent
  open("obs-s1-0");
  text("obs-s1-0", "ORCHARD OF SMALL HOURS", 0.66);
  hypotheses("obs-s1-0", [["work-orchard", "Orchard of Small Hours", "Wren Tamsin", 0.6]], 0.3);
  adjudicate("obs-s1-0", null);
  open("obs-s1-1");
  status("obs-s1-0", "unresolved", "paused", { kind: "budget-spent" });
  status("obs-s1-1", "unresolved", "paused", { kind: "budget-spent" });

  // 2: probable, resolved by a cached adjudication (free)
  open("obs-s1-2");
  text("obs-s1-2", "RIVERS OF GLASS", 0.7);
  hypotheses("obs-s1-2", [["work-rivers", "Rivers of Glass", "Oda Linnet", 0.7]], 0.2);
  adjudicate("obs-s1-2", "work-rivers", true);
  add("BandAssigned", { observationId: "obs-s1-2", band: "probable", workId: "work-rivers" });
  status("obs-s1-2", "unresolved", "resolved");

  // 3: verified by ISBN
  open("obs-s1-3");
  text("obs-s1-3", "A FIELD GUIDE TO SILENCE", 0.95);
  add("HypothesesProposed", {
    observationId: "obs-s1-3",
    candidates: [{ workId: "work-silence", title: "A Field Guide to Silence", author: "Nuala Brisk", year: 2009, series: "Field Guides", score: 0.97, evidence: [evidence("title-fragment", 0.97), evidence("isbn", 1, "spine barcode"), evidence("series", 0.6)] }],
    unknown: { score: 0.02, evidence: [evidence("threshold", 0.02)] },
  });
  add("BandAssigned", { observationId: "obs-s1-3", band: "verified", workId: "work-silence" });
  status("obs-s1-3", "unresolved", "resolved");

  // 4: a closer photo was asked for, came, and the spine is open again
  open("obs-s1-4");
  text("obs-s1-4", "—", 0.2, 0);
  add("BandAssigned", { observationId: "obs-s1-4", band: "unknown", reason: "missing-pixels" });
  status("obs-s1-4", "unresolved", "needs-pixels");
  add("WorkItemOpened", { workItemId: "wi-003", kind: "closer-photo", observationId: "obs-s1-4", shelf: 1, ordinal: 4, reason: "missing-pixels" });
  add("WorkItemClosed", { workItemId: "wi-003", resolution: "fulfilled" });
  status("obs-s1-4", "needs-pixels", "unresolved");

  // the closer photo: two spines at working-copy size 1600×1200 (scale 1, no downscaling)
  const closerSpines: [string, number, number, string, string, string][] = [
    ["obs-c-0", 200, 480, "work-lantern", "The Lantern Years", "Ilse Marrow"],
    ["obs-c-1", 560, 760, "work-atlas", "A Clockmaker's Atlas", "Tobias Venn"],
  ];
  closerSpines.forEach(([id, x0, x1, workId, title, author], i) => {
    add("SpineObserved", { observationId: id, sessionId: SESSION, imageHash: closerOriginal, setting: "shelf-48", polygon: [[x0, 150], [x1, 150], [x1, 1050], [x0, 1050]], score: 0.95, shelf: 0, ordinal: i, detector });
    open(id);
    text(id, title.toUpperCase(), 0.97);
    hypotheses(id, [[workId, title, author, 0.95]], 0.03);
    add("BandAssigned", { observationId: id, band: "verified", workId });
    status(id, "unresolved", "resolved");
  });

  add("RecommendationIssued", { recommendationId: "rec-001", rankingVersion: "synthetic-ranker 0", recommendation: { workId: "work-lantern", observationId: "obs-s0-0", rank: 1, band: "verified", lens: "reading taste", rationale: "Synthetic rationale." } });
  add("RunFinished", { outcome: "paused", usage: { adjudications: 2, inputTokens: 1800, outputTokens: 80 } });
  return { ledger, dataDir, session: SESSION, run: RUN, originalHash, workingCopyHashes: [whole.hash, closer.hash] };
}
