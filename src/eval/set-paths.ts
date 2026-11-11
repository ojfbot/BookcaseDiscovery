// NS-K2 · set paths: the one place that names a set's stage caches, and the one check of which sets a stage takes.
//
// A set is a session or the public yardstick (PROXY). A session is any name `SET_REGISTRY` declares with a role in
// `MANIFEST_ROLES` (a `training-source` or a `held-out` session, OC35); its caches follow one convention, the one
// `pilot-000` already used: `<data root>/<stage>/<session>/...` or `<data root>/private/<stage>/<session>/...`. The
// yardstick keeps the names each stage gave it before NS-K2 (some call it `yardstick`, others name it by its B2 run,
// `yardstick-library-b2`), so its paths are literals here. Nothing on disk is renamed or moved.
//
// Running a held-out session through a stage is allowed: detection and reading only measure it. Exporting or training
// on one is not; that guard is `assertTrainable` (src/eval/set-roles.ts), which TS-0 and TS-2 call before anything else.
// Pure apart from `sessionImages`, which reads a fixture manifest and the image store.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogPaths } from "../catalog/cli.ts";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import { manifestRefusal, MANIFEST_ROLES, roleOf, SET_REGISTRY, type SetRegistry } from "./set-roles.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

/** The yardstick's two names on the critical path: most stages say `yardstick`; F-0, Q-2b, H-2 and F-0i name its B2 run. */
export const YARDSTICK = "yardstick";
export const YARDSTICK_B2 = "yardstick-library-b2";
export const YARDSTICK_NAMES: readonly string[] = [YARDSTICK, YARDSTICK_B2];

/**
 * The stages on the critical path to TS-0 and TS-2 (docs/ingest.md, "Stage order"), and the yardstick names each one
 * took before NS-K2. Each also takes every declared session. Q-2b's and F-0h's yardstick runs stay inside their
 * two-set `analyse`; TS-0 refuses the yardstick (OC35), so it takes none.
 */
export const STAGES = {
  "F-0": [],
  "F-0e": [YARDSTICK],
  "F-0c": [YARDSTICK],
  "F-0f": [YARDSTICK],
  "Q-2b": [],
  "H-2": [YARDSTICK_B2],
  "F-0g": [YARDSTICK],
  "F-0h": [],
  "F-0i": [YARDSTICK_B2],
  "NB-3": [YARDSTICK],
  "RB-1": [YARDSTICK],
  "TS-0": [],
  "TS-2": [YARDSTICK],
} as const satisfies Record<string, readonly string[]>;
export type Stage = keyof typeof STAGES;

/** A declared session: its role is in `MANIFEST_ROLES` and its name does not read as an evaluation set. */
export const isSession = (set: string, registry: SetRegistry = SET_REGISTRY): boolean => manifestRefusal(set, registry) === null;

/**
 * A sample part (F-0 on frames, 2026-11-11): a fixed, evenly spaced sample of a declared session's image list, run
 * through the stages under its own name, `<session>.every-<n>`: the n-th, 2n-th, … photo of `sessionImages`, in list
 * order. Its caches sit beside the session's (`<stage>/<session>.every-<n>/…`), never among them, so a pilot run
 * cannot leave part of the whole run's caches written. It is not declared in the registry, so it is never manifested,
 * exported or trained on (`assertTrainable` refuses it as undeclared). Null for any other name.
 */
export function samplePart(set: string, registry: SetRegistry = SET_REGISTRY): { session: string; every: number } | null {
  const m = /^(.+)\.every-([1-9]\d*)$/.exec(set);
  if (!m || !isSession(m[1]!, registry)) return null;
  return { session: m[1]!, every: Number(m[2]) };
}

/** The sessions the registry declares (training sources and held-out sessions), sorted. */
export const sessions = (registry: SetRegistry = SET_REGISTRY): string[] => Object.keys(registry).filter((s) => isSession(s, registry)).sort();

/** Is this a real-use set, whose figures are machine agreement and never accuracy (INV-17)? Every session is. */
export const isRealUse = isSession;

/** The scope line a stage writes for a session (as it wrote for `pilot-000`): machine agreement, never accuracy. */
export const REAL_USE_SCOPE = "real use (OC35): machine agreement, never accuracy (INV-17)";

/**
 * The set a stage was given, or a clear refusal (fail closed): a declared session, or one of the yardstick names the
 * stage took before NS-K2. An undeclared name, a PROXY or audit set, and a yardstick name the stage does not take are
 * refused with what it does take.
 */
export function acceptSet(stage: Stage, set: string | undefined, registry: SetRegistry = SET_REGISTRY): string {
  const yard: readonly string[] = STAGES[stage];
  const takes = `a session declared in src/eval/set-roles.ts with a role in ${MANIFEST_ROLES.join(" or ")}${yard.length ? `, or ${yard.map((y) => `"${y}"`).join(" or ")}` : ""}`;
  if (!set) throw new Error(`${stage}: name a set (${takes})`);
  if (yard.includes(set)) return set;
  if (samplePart(set, registry)) return set;
  const why = manifestRefusal(set, registry);
  if (why === null) return set;
  if (why === "undeclared") throw new Error(`${stage}: "${set}" is not a declared set; it takes ${takes} (fail closed)`);
  const role = roleOf(set, registry);
  throw new Error(`${stage}: "${set}" is ${role === "yardstick" ? "a yardstick name this stage does not take" : `a ${role} set`}; it takes ${takes}`);
}

/**
 * Fail closed on a missing input (NS-K2): a stage run out of order on a new session would otherwise read nothing and
 * cache an empty file as if it had run. Names what is missing and the step that writes it; no path is printed.
 */
export function needs(stage: Stage, set: string, what: string, path: string, step: string): void {
  if (!existsSync(path)) throw new Error(`${stage}: ${set} has no ${what} yet; run \`${step}\` first (docs/ingest.md, "Stage order")`);
}

/** Every cache one set's stages read or write, under the data root. */
export interface SetPaths {
  set: string;
  kind: "session" | "yardstick";
  /** F-0's own run (`f0-cli.ts pilot --session`; the yardstick's B2 run): detect.jsonl, each reader's file, decisions.jsonl. */
  f0: string;
  /** F-0e's arms: `<f0e>/<arm>/detect.jsonl` and each reader's file (`f0e-cli.ts detect|read --set`). */
  f0e: string;
  /** The default boxes and their readings: F-0e's `bands+strips` on a session, F-0's own B2 run on the yardstick. */
  base: string;
  /** F-0e's private image list (`f0e-cli.ts render`). */
  f0eImages: string;
  /** F-0c: detect.jsonl (the cover pass), covers/ (cover readings), base-decisions.jsonl. */
  f0c: string;
  /** F-0f's private image list and pixel probe (`f0f-cli.ts probe`). */
  f0fImages: string;
  f0fProbe: string;
  /** Q-2b: Q-1's features on the default boxes, the image list they are measured on, Q-1's per-box table, Q-2's top seam. */
  q2bFeatures: string;
  q2bImages: string;
  q2bQ1Table: string;
  q2bGeometry: string;
  /** Q-2b's rung table (TS-0's rungs; F-0i's kept ids). */
  q2bTable: string;
  /** The box outlines F-0i partitions: Q-2b's SAM 2.1 outlines on a session, F-0b's on the yardstick. */
  outlines: string;
  /** H-2: images.jsonl, the depth stage, faces.jsonl, base-decisions.jsonl. */
  h2: string;
  /** F-0g: pairs, evidence, copies.jsonl. */
  f0g: string;
  /** F-0h: decisions.jsonl (confirmed-by-context). */
  f0h: string;
  /** F-0i: groups, logits, partition.jsonl. */
  f0i: string;
  /** NB-3: images, stage, shelf, probe, flags.jsonl. */
  nb3: string;
  /** TS-2's per-set student reads. */
  ts2: string;
  /** The catalog a set's boxes are identified against. */
  catalog: string;
  /** A photo's file by its id (a session's ids are working-copy hashes in the image store). */
  image: (id: string) => string | undefined;
}

/** A set's paths: by the convention for a declared session, by the literals each stage used for the yardstick. */
export function setPaths(set: string, root: string = dataRoot(), registry: SetRegistry = SET_REGISTRY): SetPaths {
  const at = (...p: string[]) => join(root, ...p);
  const priv = (...p: string[]) => join(root, "private", ...p);
  if (YARDSTICK_NAMES.includes(set)) {
    const proxy = at("proxy", "library-dataset");
    return {
      set,
      kind: "yardstick",
      f0: at("f0", YARDSTICK_B2),
      f0e: at("f0e", YARDSTICK),
      base: at("f0", YARDSTICK_B2),
      f0eImages: priv("f0e", `images-${YARDSTICK}.jsonl`),
      f0c: at("f0c", YARDSTICK),
      f0fImages: priv("f0f", `images-${YARDSTICK}.jsonl`),
      f0fProbe: priv("f0f", `probe-${YARDSTICK}.jsonl`),
      // Q-2b reads Q-2's yardstick inputs unchanged (Q-1's features on F-0's own boxes).
      q2bFeatures: priv("q1", "features", `${YARDSTICK_B2}.jsonl`),
      q2bImages: priv("q1", "features", `${YARDSTICK_B2}.images.jsonl`),
      q2bQ1Table: priv("q1", "table", `${YARDSTICK_B2}.jsonl`),
      q2bGeometry: priv("q2b", "geometry", `${YARDSTICK_B2}.jsonl`),
      q2bTable: priv("q2b", "table", `${YARDSTICK_B2}.jsonl`),
      outlines: priv("f0b", YARDSTICK_B2, "outline.jsonl"),
      h2: priv("h2", YARDSTICK_B2),
      f0g: priv("f0g", YARDSTICK),
      f0h: priv("f0h", YARDSTICK),
      f0i: priv("f0i", YARDSTICK_B2),
      nb3: priv("nb3", YARDSTICK),
      ts2: priv("ts2", YARDSTICK),
      catalog: join(proxy, "f0-inventory-catalog.sqlite"),
      image: (id) => join(proxy, "images", `${id}.jpg`),
    };
  }
  const why = samplePart(set, registry) ? null : manifestRefusal(set, registry);
  if (why !== null) throw new Error(`"${set}" has no stage paths: it is ${why === "undeclared" ? "not declared in src/eval/set-roles.ts" : `a ${roleOf(set, registry)} set, not a session`} (fail closed)`);
  const store = new ImageStore(root);
  return {
    set,
    kind: "session",
    f0: at("f0", set),
    f0e: at("f0e", set),
    base: at("f0e", set, "bands+strips"),
    f0eImages: priv("f0e", `images-${set}.jsonl`),
    f0c: at("f0c", set),
    f0fImages: priv("f0f", `images-${set}.jsonl`),
    f0fProbe: priv("f0f", `probe-${set}.jsonl`),
    q2bFeatures: priv("q2b", "features", `${set}.jsonl`),
    // pilot-000's Q-2b features were measured on Q-1's list of the same working copies; a new session writes its own.
    q2bImages: set === "pilot-000" ? priv("q1", "features", "pilot-000.images.jsonl") : priv("q2b", "features", `${set}.images.jsonl`),
    q2bQ1Table: priv("q2b", "q1table", `${set}.jsonl`),
    q2bGeometry: priv("q2b", "geometry", `${set}.jsonl`),
    q2bTable: priv("q2b", "table", `${set}.jsonl`),
    outlines: priv("q2b", "outlines", `${set}.jsonl`),
    h2: priv("h2", set),
    f0g: priv("f0g", set),
    f0h: priv("f0h", set),
    f0i: priv("f0i", set),
    nb3: priv("nb3", set),
    ts2: priv("ts2", set),
    catalog: catalogPaths().catalog,
    image: (id) => store.find(id),
  };
}

/**
 * A session's photos from its public manifest (`fixtures/<session>/manifest.json`) and the image store: one entry per
 * manifest row, `id` the working-copy hash, `image` its file. No pixel size, EXIF or capture tier is assumed, so it
 * serves stills and video frames alike. Throws when the manifest is missing or a working copy is not in the store.
 * A sample part's list is its session's every n-th photo, in list order (`samplePart`).
 */
export function sessionImages(session: string, root: string = dataRoot(), repo: string = REPO, registry: SetRegistry = SET_REGISTRY): { id: string; image: string }[] {
  const part = samplePart(session, registry);
  if (part) return sessionImages(part.session, root, repo, registry).filter((_, i) => (i + 1) % part.every === 0);
  if (!isSession(session, registry)) throw new Error(`"${session}" is not a declared session (src/eval/set-roles.ts)`);
  const path = join(repo, "fixtures", session, "manifest.json");
  if (!existsSync(path)) throw new Error(`${session}: no public manifest at fixtures/${session}/manifest.json (run \`bookcase manifest ${session}\`)`);
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { session: string; photos: { workingCopyHash: string }[] };
  if (manifest.session !== session) throw new Error(`fixtures/${session}/manifest.json names another session`);
  const store = new ImageStore(root);
  return manifest.photos.map((p) => {
    const image = store.find(p.workingCopyHash);
    if (!image) throw new Error(`${session}: a manifest photo's working copy is missing from the image store`);
    return { id: p.workingCopyHash, image };
  });
}
