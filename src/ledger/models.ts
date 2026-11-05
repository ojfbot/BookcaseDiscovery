// The model-weights manifest (DL-3): `$BOOKCASE_DATA/models/manifest.json` names every model folder under
// `models/` by its name, its Hugging Face revision (from the download's own metadata beside the weights, when
// there is one) and a content hash of its files, so a lineage stamp (src/ledger/lineage.ts) can say which weights
// produced a derived file and a reader can tell when they changed. Every regular file of a model folder counts
// (weights, configs, tokenizers), except the download cache under `.cache/`.
//
// Hashing is done once: the manifest keeps a per-file record keyed by size and mtime, and a refresh re-hashes only
// a file whose size or mtime moved (the catalog stamp of DL-1 uses the same rule). The weights and the manifest are
// private; the repository gets this code and a test on a synthetic models folder.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { dataRoot } from "./images.ts";
import { writeFileDurable } from "./durable.ts";

export const MODELS_MANIFEST_VERSION = 1;
export const MANIFEST_COMMAND = "bookcase models manifest";

export interface ModelEntry {
  name: string;
  /** The Hugging Face revision(s) recorded by the download, `+`-joined when the folder holds several; null when none. */
  revision: string | null;
  /** `sha256:<hex>` over every file's relative path and content hash, in path order. */
  hash: string;
  files: number;
  bytes: number;
}

export interface FileRecord {
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface ModelsManifest {
  schemaVersion: number;
  writtenAt: string;
  models: Record<string, ModelEntry>;
  /** `<model>/<relative path>` -> its record, so a refresh hashes only what moved. */
  files: Record<string, FileRecord>;
}

export const modelsDir = (root: string = dataRoot()): string => join(root, "models");
export const manifestPath = (root: string = dataRoot()): string => join(modelsDir(root), "manifest.json");

const SKIP_DIRS = new Set([".cache"]);

/** Every regular file under `dir`, as paths relative to it, sorted; `.cache/` folders are left out. */
export function modelFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(d, e.name));
      } else if (e.isFile()) out.push(relative(dir, join(d, e.name)).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/** The download's recorded revisions: the first line of each `.cache/huggingface/download/*.metadata` file. */
export function recordedRevisions(dir: string): string[] {
  const revs = new Set<string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".metadata") && p.includes(`${sep}.cache${sep}`)) {
        const first = readFileSync(p, "utf8").split("\n")[0]!.trim();
        if (/^[0-9a-f]{40}$/.test(first)) revs.add(first);
      }
    }
  };
  walk(dir);
  return [...revs].sort();
}

export function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (c) => h.update(c))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

export interface BuildResult {
  manifest: ModelsManifest;
  /** Files hashed on this run. */
  hashed: number;
  /** Files whose record was reused (same size and mtime). */
  reused: number;
  bytesHashed: number;
  seconds: number;
}

/**
 * Build or refresh the manifest for every folder under `models/` and write it. A file whose size and mtime match its
 * record keeps its hash; anything else is hashed. A model folder that is gone is dropped.
 */
export async function buildModelsManifest(root: string = dataRoot(), opts: { log?: (s: string) => void; now?: Date } = {}): Promise<BuildResult> {
  const t0 = Date.now();
  const dir = modelsDir(root);
  if (!existsSync(dir)) throw new Error(`no models folder at the data root: ${dir}`);
  const previous = readModelsManifest(root, { fresh: true });
  const files: Record<string, FileRecord> = {};
  const models: Record<string, ModelEntry> = {};
  let hashed = 0, reused = 0, bytesHashed = 0;
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const mdir = join(dir, name);
    const rels = modelFiles(mdir);
    const parts: string[] = [];
    let bytes = 0;
    for (const rel of rels) {
      const key = `${name}/${rel}`;
      const st = statSync(join(mdir, rel));
      const old = previous?.files[key];
      let sha: string;
      if (old && old.size === st.size && old.mtimeMs === Math.round(st.mtimeMs)) {
        sha = old.sha256;
        reused++;
      } else {
        sha = await sha256OfFile(join(mdir, rel));
        hashed++;
        bytesHashed += st.size;
      }
      files[key] = { size: st.size, mtimeMs: Math.round(st.mtimeMs), sha256: sha };
      parts.push(`${rel}\t${sha}\n`);
      bytes += st.size;
    }
    const revs = recordedRevisions(mdir);
    models[name] = { name, revision: revs.length ? revs.join("+") : null, hash: `sha256:${createHash("sha256").update(parts.join("")).digest("hex")}`, files: rels.length, bytes };
    opts.log?.(`models: ${name}: ${rels.length} files, ${(bytes / 1e6).toFixed(0)} MB`);
  }
  const manifest: ModelsManifest = { schemaVersion: MODELS_MANIFEST_VERSION, writtenAt: (opts.now ?? new Date()).toISOString(), models, files };
  writeFileDurable(manifestPath(root), `${JSON.stringify(manifest, null, 1)}\n`, { mode: 0o600 });
  manifestCache.set(root, manifest);
  return { manifest, hashed, reused, bytesHashed, seconds: (Date.now() - t0) / 1000 };
}

const manifestCache = new Map<string, ModelsManifest | null>();

/** The manifest at `root`, read once per process (null when there is none). `fresh` reads the file again. */
export function readModelsManifest(root: string = dataRoot(), opts: { fresh?: boolean } = {}): ModelsManifest | null {
  if (!opts.fresh && manifestCache.has(root)) return manifestCache.get(root)!;
  const p = manifestPath(root);
  let m: ModelsManifest | null = null;
  if (existsSync(p)) {
    m = JSON.parse(readFileSync(p, "utf8")) as ModelsManifest;
    if (m.schemaVersion !== MODELS_MANIFEST_VERSION) throw new Error(`${p}: manifest schema ${m.schemaVersion}, expected ${MODELS_MANIFEST_VERSION}: run \`${MANIFEST_COMMAND}\``);
  }
  manifestCache.set(root, m);
  return m;
}

/** For tests: forget the cached manifests. */
export function resetModelsManifestCache(): void {
  manifestCache.clear();
}

/**
 * The content hashes of the named models, for a lineage stamp or a reader's expectation. Throws, naming the
 * command, when there is no manifest or a model is not in it: a stage never runs on weights nothing has named.
 */
export function modelHashes(names: readonly string[], root: string = dataRoot()): Record<string, string> {
  if (names.length === 0) return {};
  const m = readModelsManifest(root);
  if (!m) throw new Error(`no models manifest at the data root: run \`${MANIFEST_COMMAND}\` first`);
  const out: Record<string, string> = {};
  for (const n of [...names].sort()) {
    const e = m.models[n];
    if (!e) throw new Error(`model "${n}" is not in the models manifest: put its weights under models/${n}/ and run \`${MANIFEST_COMMAND}\``);
    out[n] = e.hash;
  }
  return out;
}
