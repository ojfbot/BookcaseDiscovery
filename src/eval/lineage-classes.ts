// The derived file classes under the data root that carry a lineage stamp (DL-3), in one place, so the writers,
// the readers and the re-stamp pass (`bookcase lineage restamp`) agree on each class's schema and on the models it
// depends on. The graph itself is docs/lineage.md. F-0's stage classes are in src/eval/f0.ts (`STAGE_SCHEMAS`).
import { basename, sep } from "node:path";
import type { LineageSchema } from "../ledger/lineage.ts";
import { TS0 } from "./ts0.ts";
import { STAGE_SCHEMAS, type StageKind } from "./f0.ts";

/** H-2's depth stage (MoGe-2): `private/h2/<set>/stage-<tag>.jsonl` and `faces.jsonl`. */
export const DEPTH_MODELS = ["moge-2-vitl-normal"] as const;
export const DEPTH_STAGE_SCHEMA: LineageSchema = { name: "h2/depth-stage", version: 1 };
export const FACES_SCHEMA: LineageSchema = { name: "h2/faces", version: 1 };

/** F-0i's partition (SAM 2.1 conflict tiles, H-2's depth for the override): `private/f0i/<set>/partition.jsonl`. */
export const PARTITION_MODELS = ["sam2.1-hiera-base-plus", "moge-2-vitl-normal"] as const;
export const PARTITION_SCHEMA: LineageSchema = { name: "f0i/partition", version: 1 };

/** TS-0's label ledger: `datasets/label-ledger/<version>/{manifest.json,labels.jsonl,build.json}`. */
export const DATASET_SCHEMA: LineageSchema = { name: "ts0/label-ledger", version: TS0.schemaVersion };
export const DATASET_FILES = ["manifest.json", "labels.jsonl", "build.json"] as const;

export type FileClass = { kind: "stage"; stage: StageKind } | { kind: "depth-stage" } | { kind: "faces" } | { kind: "partition" } | { kind: "dataset" };

const STAGE_NAMES = new Set(Object.keys(STAGE_SCHEMAS));

/**
 * The class of a file by its name and folder, or null for a file no class covers. Paths are read relative to the
 * data root. F-0's stage files are known by name alone, since stage folders sit under many cards' folders.
 */
export function classOf(relPath: string): FileClass | null {
  const parts = relPath.split(sep);
  const name = basename(relPath);
  const stem = name.replace(/\.jsonl$/, "");
  if (name.endsWith(".jsonl") && STAGE_NAMES.has(stem)) return { kind: "stage", stage: stem as StageKind };
  if (parts.includes("h2") && /^stage-[^/]+\.jsonl$/.test(name)) return { kind: "depth-stage" };
  if (parts.includes("h2") && name === "faces.jsonl") return { kind: "faces" };
  if (parts.includes("f0i") && name === "partition.jsonl") return { kind: "partition" };
  if (parts[0] === "datasets" && parts[1] === TS0.dataset && parts.length === 4 && (DATASET_FILES as readonly string[]).includes(name)) return { kind: "dataset" };
  return null;
}

/** Folder names the re-stamp walk never enters: inputs, facts, caches of bytes, and renders. */
export const SKIP_DIRS = new Set(["models", "images", "raw", "ledger", "catalog", "labels", "jobs", "proxy", "cache", "logits", "renders", "node_modules", ".git"]);
