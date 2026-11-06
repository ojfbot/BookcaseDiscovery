// KN-3 runner: the shelf signals in shadow mode on `pilot-000`'s confirmed books, measured label-free.
//
//   node src/eval/kn3-cli.ts analyse   # evals/KN3/metrics.json (aggregates only); the per-work signals under the
//                                      # data root's private/kn3/pilot-000/
//
// Confirmed books are TS-0's label ledger (latest version: `readers-agree`, `confirmed-by-copy`,
// `confirmed-by-context` on RB-1's box set). Rows are F-0h's (`buildRows` on F-0g's `loadBooks`, keys `<photo>|<k>`),
// as KN-2 and SC-1 key them; a case is one photo (`pilot-000` has no bookcase ids). Work features are KN-1's
// `workKnowledge` on `catalog-kn1.sqlite` through KN-2's adapter `termsOf`; SC-1's signs are its private row records.
// Nothing reads the reader's taste, seeds or lenses (INV-13). The yardstick is not used (evals/KN3/prereg.md). CPU only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCatalog } from "../catalog/cli.ts";
import { KN1_CATALOGS } from "./kn1-eval.ts";
import { hasWorkFeatures, workKnowledge } from "../catalog/work-features.ts";
import { readDatasetManifest } from "../capture/dataset.ts";
import { termsOf } from "./section-prior-cli.ts";
import type { SectionSign, WorkFeatureTerms } from "../identify/section-prior.ts";
import { dataRoot } from "../ledger/images.ts";
import { SHELF, shelfSignals, workShelfFeatures, type ConfirmedBox, type ShelfInput, type ShelfRow } from "../recommend/shelf-signals.ts";
import { readJsonl } from "./f0.ts";
import { buildRows } from "./f0h.ts";
import { loadBooks, loadDets } from "./f0g-cli.ts";
import { coverage, EVAL, H_FACETS, homophily, limits, onePerWorkPair, pairsOf, placeShuffle, scorePairs, stability, verdicts, type Facet, type Pair } from "./kn3.ts";
import { datasetDir } from "./ts0-cli.ts";
import { parseLabelRow } from "./ts0.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const SET = "pilot-000" as const;
const PRIV = join(ROOT, "private", "kn3", SET);
const log = (s: string): void => console.error(`[kn3] ${new Date().toISOString().slice(11, 19)} ${s}`);

interface Loaded {
  input: ShelfInput;
  version: string;
  groupOf: (photo: string) => string | null;
  nearDuplicatePairs: number;
  authors: Map<string, readonly string[]>;
}

function load(): Loaded {
  const dir = datasetDir(ROOT);
  const latest = join(dir, "latest.json");
  if (!existsSync(latest)) throw new Error("no label ledger: run `node bin/bookcase dataset build` first (TS-0)");
  const version = (JSON.parse(readFileSync(latest, "utf8")) as { version: string }).version;
  const labels = readJsonl<unknown>(join(dir, version, "labels.jsonl"))
    .map((l) => parseLabelRow(l))
    .filter((l) => l.set === SET);
  const manifest = readDatasetManifest(JSON.parse(readFileSync(join(dir, version, "manifest.json"), "utf8")));
  const group = new Map(manifest.photos.map((p) => [p.sha256, p.captureGroup]));
  const nearDuplicatePairs = manifest.photos.reduce((a, p) => a + p.nearDuplicates.length, 0) / 2;

  const dets = loadDets(SET);
  const books = loadBooks(SET, dets);
  const rows: ShelfRow[] = [];
  for (const d of dets.values()) {
    const isBook = (i: number) => books.get(d.id)![i]!;
    buildRows(d, isBook).forEach((r, k) => rows.push({ key: `${d.id}|${k}`, caseKey: d.id, band: r.band, members: r.members.map((i) => `${d.id}:${i}`) }));
  }
  const bookIds = new Set([...dets.values()].flatMap((d) => d.spines.map((_, i) => `${d.id}:${i}`).filter((_, i) => books.get(d.id)![i])));
  const missing = labels.filter((l) => !bookIds.has(l.boxId)).length;
  if (missing) throw new Error(`${missing} ledger labels name a box outside RB-1's book boxes; rebuild the ledger`);
  const confirmed = new Map<string, ConfirmedBox>(labels.map((l) => [l.boxId, { workId: l.workId, basis: l.basis }]));
  const authors = new Map(labels.map((l) => [l.workId, l.authors]));

  const db = openCatalog(join(ROOT, KN1_CATALOGS[SET].kn1));
  if (!hasWorkFeatures(db)) throw new Error("the catalog has no work_features table (KN-1)");
  const memo = new Map<string, WorkFeatureTerms | null>();
  const features = (id: string) => {
    if (!memo.has(id)) memo.set(id, termsOf(workKnowledge(db, id)));
    return memo.get(id)!;
  };
  const keys = new Set(rows.map((r) => r.key));
  const signPath = join(ROOT, "private", "sc1", SET, "rows.jsonl");
  if (!existsSync(signPath)) throw new Error("run node src/eval/sc1-cli.ts analyse first");
  const signs = new Map<string, SectionSign>(
    readJsonl<{ key: string; family: string | null; confidence: number }>(signPath)
      .filter((r) => r.family && keys.has(r.key))
      .map((r) => [r.key, { family: r.family!, confidence: r.confidence }]),
  );
  return { input: { rows, confirmed, features, signs }, version, groupOf: (p) => group.get(p) ?? null, nearDuplicatePairs, authors };
}

function analyse(): void {
  const t0 = Date.now();
  const { input, version, groupOf, nearDuplicatePairs, authors } = load();
  log(`loaded ${input.rows.length} rows, ${input.confirmed.size} confirmed boxes, ${input.signs.size} signs (${Math.round((Date.now() - t0) / 1000)} s)`);

  // The signals themselves, in shadow: per work, privately (they name works).
  const signals = shelfSignals("shadow", input)!;
  mkdirSync(PRIV, { recursive: true });
  const works = [...new Set([...input.confirmed.values()].map((c) => c.workId))].sort();
  writeFileSync(join(PRIV, "signals.jsonl"), works.map((w) => JSON.stringify(workShelfFeatures(signals, w))).join("\n") + "\n");

  // H: term sharing, primary and secondary arms.
  const all = pairsOf(signals.sightings);
  const pool = signals.sightings;
  const isPrimary = (p: Pair) => EVAL.primaryBases.includes(p.a.basis) && EVAL.primaryBases.includes(p.b.basis);
  const sameAuthor = (p: Pair) => {
    const [a, b] = [authors.get(p.a.workId) ?? [], authors.get(p.b.workId) ?? []];
    return a.some((x) => b.includes(x));
  };
  const arm = (f: Facet, ps: Pair[]) => homophily(f, scorePairs(f, ps, pool, input.features));
  const row = all.filter((p) => p.scope === "row");
  const rowPrimary = row.filter(isPrimary);
  const primary = arm("either", rowPrimary);
  const facets = Object.fromEntries(H_FACETS.map((f) => [f, arm(f, rowPrimary)])) as Record<Facet, ReturnType<typeof arm>>;
  const H = {
    primary,
    secondary: {
      genre: facets.genre,
      form: facets.form,
      allBases: arm("either", row),
      noSameAuthor: arm("either", rowPrimary.filter((p) => !sameAuthor(p))),
      sameAuthorPairs: rowPrimary.filter(sameAuthor).length,
      onePerWorkPair: arm("either", onePerWorkPair(rowPrimary)),
      byDistance: {
        "1": arm("either", rowPrimary.filter((p) => p.distance === 1)),
        "2": arm("either", rowPrimary.filter((p) => p.distance === 2)),
        "3+": arm("either", rowPrimary.filter((p) => p.distance >= 3)),
      },
      case: arm("either", all.filter((p) => p.scope === "case" && isPrimary(p))),
      caseGenre: arm("genre", all.filter((p) => p.scope === "case" && isPrimary(p))),
    },
  };
  log(`H: primary D ${JSON.stringify(primary.D)} over ${primary.pairs} pairs (${Math.round((Date.now() - t0) / 1000)} s)`);

  const C = coverage(input);
  const O = placeShuffle(input);
  log(`O: real ${O.real.share.either} against shuffled p05 ${O.shuffled.either.p05} (${Math.round((Date.now() - t0) / 1000)} s)`);
  const S = { nearDuplicatePairs, captureGroup: stability(input, groupOf) };
  const L = limits(input);

  const metrics = {
    card: "KN-3",
    mode: "shadow",
    set: SET,
    scope: "real use (OC35): machine agreement, never accuracy (INV-17); no recommendation ground truth; the yardstick is not used",
    ledger: version,
    catalog: KN1_CATALOGS[SET].kn1.split("/").at(-1),
    shelf: SHELF,
    eval: EVAL,
    coverage: C,
    homophily: H,
    outOfPlace: O,
    stability: S,
    limits: L,
    verdicts: verdicts({ coverage: C, primary, place: O }),
  };
  const out = join(REPO, "evals", "KN3");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  log(`evals/KN3/metrics.json written (${Math.round((Date.now() - t0) / 1000)} s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "analyse") analyse();
  else {
    console.error("usage: node src/eval/kn3-cli.ts analyse");
    process.exit(2);
  }
}
