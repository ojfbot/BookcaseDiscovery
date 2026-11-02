// `report` module (W-1): a static site of one scan session's ledger state, under
// `<data dir>/reports/<session>/<run>/`. It lives in the data dir because it holds photos (INV-12, OC9).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pixelSize } from "../capture/working-copy.ts";
import { ImageStore, dataRoot } from "../ledger/index.ts";
import type { Ledger } from "../ledger/index.ts";
import { buildModel, ReportError } from "./model.ts";
import type { ReportModel } from "./model.ts";
import { renderReport } from "./render.ts";

export const moduleName = "report";

export { buildModel, displaySize, scalePolygon, pickRun, ReportError, REASON_TEXT } from "./model.ts";
export type { DisplayImage, ReportModel, SpineModel } from "./model.ts";
export { renderReport } from "./render.ts";
export { reportCommand, reportUsage } from "./cli.ts";

/** The display derivative's long edge, in pixels. */
export const DISPLAY_MAX_EDGE = 3000;

/** Ids become folder names: refuse anything that could climb out of `reports/`. */
function safeName(kind: string, value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes("..")) throw new ReportError(`${kind} "${value}" cannot be a folder name`);
  return value;
}

/**
 * Write the display derivative of `source` to `dest` with `sips`: JPEG, long edge at most `maxEdge`, never
 * enlarged. `source` is read, never written (the image store keeps it read-only). Returns the derivative's size.
 */
export function makeDerivative(source: string, dest: string, size: { width: number; height: number }, maxEdge = DISPLAY_MAX_EDGE): { width: number; height: number } {
  const shrink = Math.max(size.width, size.height) > maxEdge ? ["-Z", String(maxEdge)] : [];
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", ...shrink, source, "--out", dest], { stdio: "pipe" });
  return pixelSize(dest);
}

export interface WriteReportOptions {
  ledger: Ledger;
  session: string;
  runId?: string;
  /** The data root (`$BOOKCASE_DATA`): working copies are read from its image store, the report goes under `reports/`. */
  dataDir?: string;
}

export interface WrittenReport {
  /** `<data dir>/reports/<session>/<run>/`. */
  dir: string;
  index: string;
  model: ReportModel;
  /** Things that look wrong but did not stop the report (a working copy missing from the store, a size mismatch). */
  warnings: string[];
}

export function writeReport(options: WriteReportOptions): WrittenReport {
  const dataDir = options.dataDir ?? dataRoot();
  const store = new ImageStore(dataDir);
  const warnings: string[] = [];
  // Resolve the run first so the folder is known before anything is written.
  const probe = buildModel(options.ledger, options.session, options.runId);
  const dir = join(dataDir, "reports", safeName("session", probe.session), safeName("run", probe.run.runId));
  // A rebuilt report replaces the old one whole: no derivative from an earlier ledger state stays behind.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "images"), { recursive: true });

  const model = buildModel(options.ledger, options.session, options.runId, (img) => {
    const source = store.find(img.workingCopyHash); // the working copy, never the original behind `imageHash` (INV-12)
    const tag = img.workingCopyHash.slice(0, 12);
    if (!source) {
      warnings.push(`working copy ${tag} is not in the image store; its boxes are drawn on a blank frame`);
      return;
    }
    const name = `${img.workingCopyHash.slice(0, 16)}.jpg`;
    const size = makeDerivative(source, join(dir, "images", name), img);
    // Polygons scale by derivative ÷ ledger size; a file of another shape would put every box off.
    if (Math.abs(size.width / size.height - img.width / img.height) > 0.01) {
      warnings.push(`working copy ${tag} is ${size.width}×${size.height} on disk but the ledger says ${img.width}×${img.height}; boxes may be misplaced`);
    }
    img.display = size; // sips rounds its own way: the overlay's frame is the derivative's real size
    img.src = `images/${name}`;
  });

  const index = join(dir, "index.html");
  writeFileSync(index, renderReport(model));
  return { dir, index, model, warnings };
}
