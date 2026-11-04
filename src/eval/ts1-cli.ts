// TS-1 runner: the reader error-overlap audit (pre-registered in evals/TS1/report.md). CPU only, from caches.
//
//   node src/eval/ts1-cli.ts boxes <set>   # one record per kept box: reader outcomes, label, strata, rarity (private)
//   node src/eval/ts1-cli.ts analyse       # evals/TS1/{metrics.json,report.md}: aggregates only
//
// Sets (OC35, never merged): pilot-000 with F-0e's `bands+strips` boxes, the yardstick with F-0's B2 boxes; both Q-3's
// kept boxes with F-0's cached decisions (H-2's base decisions). Per-box records go under the data root's `private/ts1/`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { openStats, primarySurname, statsPathFor } from "../catalog/rarity.ts";
import { dataRoot } from "../ledger/images.ts";
import { READERS, readJsonl, type ReaderName } from "./f0.ts";
import { compactJson, yardstickTruth } from "./q1-cli.ts";
import {
  AGREEING,
  agreeingKey,
  isDark,
  isLabel,
  labelWrong,
  overlaps,
  ownTitleForm,
  pairMeasures,
  PAIRS,
  rarityOf,
  readBy,
  shareOf,
  strata,
  tallyBootstrap,
  thirdOf,
  thirdRead,
  THIRD_OUTCOMES,
  tierOf,
  TS1,
  WRONG_KINDS,
  wrongConf,
  wrongKindOf,
  type Agreeing,
  type BookKey,
  type Box,
  type ErrorKind,
  type Interval,
  type SetName,
} from "./ts1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const priv = (...p: string[]) => join(ROOT, "private", ...p);
const log = (s: string): void => console.error(`[ts1] ${new Date().toISOString().slice(11, 19)} ${s}`);
const NAMES: SetName[] = ["pilot-000", "yardstick"];
/** Each cache names the sets its own way. */
const CACHE: Record<SetName, { h2: string; features: string; catalog: string }> = {
  "pilot-000": { h2: "pilot-000", features: priv("q2b", "features", "pilot-000.jsonl"), catalog: catalogPaths().catalog },
  yardstick: {
    h2: "yardstick-library-b2",
    features: priv("q1", "features", "yardstick-library-b2.jsonl"),
    catalog: join(ROOT, "proxy", "library-dataset", "f0-inventory-catalog.sqlite"),
  },
};
const SCOPE: Record<SetName, string> = {
  "pilot-000": "real use (OC35): machine agreement, never accuracy (INV-17)",
  yardstick: "PROXY (library shelves): Library Dataset sample, box arm B2; truth = the image's annotated inventory works",
};
const boxesPath = (set: SetName) => priv("ts1", set, "boxes.jsonl");

interface BookRow { id: string; imageId: string; kind: string; elevation: string; case: string }
interface BaseDecision {
  id: string;
  imageId: string;
  top: Partial<Record<ReaderName, string | null>>;
  confirmed: Partial<Record<ReaderName, string | null>>;
  accepted: { workId: string } | null;
  agreeing: ReaderName[];
}
interface Features { id: string; mean: number | null; rmsContrast: number | null }

// --- boxes: one record per kept box ------------------------------------------------------------------------

function boxes(set: SetName): void {
  const c = CACHE[set];
  const books = readJsonl<BookRow>(priv("q3", set, "books.jsonl")).filter((b) => b.kind === "box");
  const base = new Map(readJsonl<BaseDecision>(priv("h2", c.h2, "base-decisions.jsonl")).map((d) => [d.id, d]));
  const feats = new Map(readJsonl<Features>(c.features).map((f) => [f.id, f]));
  const truth = set === "yardstick" ? yardstickTruth() : null;
  const db = openCatalog(c.catalog);
  const stats = openStats(statsPathFor(c.catalog), c.catalog);
  const titleNorm = db.prepare("SELECT title_norm FROM works WHERE id = ?");
  const rarity = new Map<string, Box["rarity"]>();
  const rarityFor = (w: string): Box["rarity"] => {
    if (!rarity.has(w)) {
      const row = titleNorm.get(w) as { title_norm: string } | undefined;
      const form = row ? ownTitleForm(row.title_norm) : null;
      rarity.set(w, rarityOf(form, form === null ? 0 : stats.title(form).works));
    }
    return rarity.get(w)!;
  };
  // Exploratory book-level check (yardstick): every inventory record under one title form and primary surname.
  const keyOf = new Map<string, BookKey>();
  const records = new Map<string, string[]>();
  if (truth) {
    for (const w of db.prepare("SELECT id, title_norm, authors FROM works").iterate() as Iterable<{ id: string; title_norm: string; authors: string }>) {
      const k: BookKey = { title: ownTitleForm(w.title_norm), surname: primarySurname(JSON.parse(w.authors) as string[]) };
      keyOf.set(w.id, k);
      const s = `${k.title}\u0000${k.surname}`;
      records.set(s, [...(records.get(s) ?? []), w.id]);
    }
  }
  const sameBook = (ws: Iterable<string>) => new Set([...ws].flatMap((w) => records.get(`${keyOf.get(w)?.title}\u0000${keyOf.get(w)?.surname}`) ?? [w]));
  const bar = TS1.darkBar[set];
  const out: string[] = [];
  for (const b of books) {
    const d = base.get(b.id), f = feats.get(b.id);
    if (!d) throw new Error(`${set}: a kept box with no cached decision`);
    const accepted = d.accepted?.workId ?? null;
    const box: Box = {
      id: b.id,
      imageId: b.imageId,
      top: d.top,
      confirmed: d.confirmed,
      accepted,
      agreeing: d.agreeing,
      elevation: b.elevation ?? "unknown",
      dark: isDark(f?.mean ?? null, f?.rmsContrast ?? null, bar),
      side: b.case === "side",
      rarity: accepted ? rarityFor(accepted) : null,
    };
    if (!truth) {
      out.push(JSON.stringify(box));
      continue;
    }
    const t = truth.get(b.imageId) ?? new Set<string>();
    const wrongKind = accepted && !t.has(accepted) ? wrongKindOf(keyOf.get(accepted)!, [...t].map((w) => keyOf.get(w)!)) : null;
    out.push(JSON.stringify({ ...box, truth: [...t], truthBook: [...sameBook(t)], wrongKind }));
  }
  stats.close();
  db.close();
  mkdirSync(priv("ts1", set), { recursive: true });
  writeFileSync(boxesPath(set), out.join("\n") + "\n");
  log(`boxes: ${set} ${out.length} kept boxes`);
}

const loadBoxes = (set: SetName): Box[] =>
  readJsonl<Box & { truth?: string[]; truthBook?: string[] }>(boxesPath(set)).map((b) =>
    b.truth ? { ...b, truth: new Set(b.truth), truthBook: new Set(b.truthBook ?? b.truth) } : (b as Box),
  );
/** The exploratory book-level truth in place of the record-level one. */
const bookLevel = (bs: Box[]): Box[] => bs.map((b) => ({ ...b, truth: b.truthBook }));

// --- analyse ----------------------------------------------------------------------------------------------

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const iv = (x: Interval | null) => (x ? { value: r3(x.value), lo: r3(x.lo), hi: r3(x.hi), draws: x.draws } : null);
const pairKey = (a: ReaderName, b: ReaderName) => `${a}+${b}`;

function pairBlock(bs: Box[], k: ErrorKind) {
  return Object.fromEntries(
    PAIRS.map(([a, b]) => {
      const m = pairMeasures(bs, a, b, k);
      return [pairKey(a, b), { counts: m.counts, stats: m.stats ? Object.fromEntries(Object.entries(m.stats).map(([s, v]) => [s, iv(v as Interval | null)])) : null }];
    }),
  );
}

const shareJson = (s: ReturnType<typeof shareOf>) => ({ n: s.n, k: s.k, share: iv(s.share) });

/** M2 (yardstick) or the labels' count (pilot) per agreeing set. */
function labelsBlock(bs: Box[], yard: boolean) {
  const sets: (Agreeing | null)[] = [null, ...AGREEING];
  return Object.fromEntries(sets.map((s) => [s ?? "all", yard ? shareJson(shareOf(bs, isLabel(s), labelWrong)) : { n: bs.filter(isLabel(s)).length }]));
}

/** M5 per two-reader agreeing set: outcome counts, dissent share, and (yardstick) each outcome's wrong share. */
function thirdBlock(bs: Box[], yard: boolean) {
  const two = AGREEING.filter((a) => a.split("+").length === 2);
  return Object.fromEntries(
    two.map((a) => {
      const ls = bs.filter(isLabel(a));
      const outcomes = Object.fromEntries(THIRD_OUTCOMES.map((o) => [o, ls.filter((b) => thirdOf(b)!.outcome === o).length]));
      const wrongBy = yard ? Object.fromEntries(THIRD_OUTCOMES.map((o) => [o, shareJson(shareOf(ls, (b) => thirdOf(b)!.outcome === o, labelWrong))])) : undefined;
      return [a, { labels: ls.length, outcomes, dissent: shareJson(shareOf(ls, thirdRead, (b) => thirdOf(b)!.outcome === "dissents")), wrongBy }];
    }),
  );
}

/** M6: wrong share (yardstick) or dissent share (pilot) by agreeing set x rarity. */
function rarityBlock(bs: Box[], yard: boolean) {
  const out: Record<string, unknown> = {};
  for (const a of [null, ...AGREEING]) {
    for (const r of ["shared", "distinctive"] as const) {
      const ls = bs.filter((b) => isLabel(a)(b) && b.rarity === r);
      out[`${a ?? "all"}|${r}`] = yard
        ? shareJson(shareOf(ls, () => true, labelWrong))
        : { labels: ls.length, dissent: a && a.split("+").length === 2 ? shareJson(shareOf(ls, thirdRead, (b) => thirdOf(b)!.outcome === "dissents")) : null };
    }
  }
  return out;
}

/** M3: per reader, the share of its confirmations that are wrong; all its reads, and on Qwen-read crops. */
function readerBlock(bs: Box[]) {
  return Object.fromEntries(
    READERS.map((r) => [
      r,
      {
        all: shareJson(shareOf(bs, (b) => !!b.confirmed[r], (b) => wrongConf(b, r))),
        qwenRead: shareJson(shareOf(bs, (b) => readBy(b, "qwen") && !!b.confirmed[r], (b) => wrongConf(b, r))),
      },
    ]),
  );
}

/** Also reported: on boxes both readers read, how often both confirm a work, and how often those works differ. */
function coConfirm(bs: Box[]) {
  return Object.fromEntries(
    PAIRS.map(([a, b]) => {
      const read = bs.filter((x) => readBy(x, a) && readBy(x, b));
      const both = read.filter((x) => x.confirmed[a] && x.confirmed[b]);
      return [pairKey(a, b), { readByBoth: read.length, bothConfirm: both.length, differ: both.filter((x) => x.confirmed[a] !== x.confirmed[b]).length }];
    }),
  );
}

/** After the results, not pre-registered: what the wrong labels are, and the yardstick's figures at book level. */
function exploratory(bs: Box[]) {
  const wrongKinds = Object.fromEntries(
    [null, ...AGREEING].map((a) => [a ?? "all", Object.fromEntries(WRONG_KINDS.map((k) => [k, bs.filter((b) => isLabel(a)(b) && b.wrongKind === k).length]))]),
  );
  const book = bookLevel(bs);
  return { wrongKinds, bookLevel: { labels: labelsBlock(book, true), pairsE: pairBlock(book, "E"), readers: readerBlock(book), rarity: rarityBlock(book, true) } };
}

function analyseSet(set: SetName) {
  const bs = loadBoxes(set);
  const yard = set === "yardstick";
  const photos = new Set(bs.map((b) => b.imageId)).size;
  const ref = tallyBootstrap(bs, (b) => [+!!b.accepted], { count: (t) => t[0] ?? 0 });
  const byStratum = strata(bs).map((s) => ({
    stratum: s.stratum,
    value: s.value,
    boxCount: s.boxes.length,
    labels: labelsBlock(s.boxes, yard),
    third: thirdBlock(s.boxes, yard),
    ...(yard ? { pairsE: pairBlock(s.boxes, "E") } : {}),
  }));
  return {
    scope: SCOPE[set],
    photos,
    boxCount: bs.length,
    reference: { count: iv(ref.count), perPhoto: r3((ref.count?.value ?? 0) / photos), shareOfBoxes: r3((ref.count?.value ?? 0) / bs.length) },
    labels: labelsBlock(bs, yard),
    readBy: Object.fromEntries(READERS.map((r) => [r, bs.filter((b) => readBy(b, r)).length])),
    coConfirm: coConfirm(bs),
    third: thirdBlock(bs, yard),
    rarity: rarityBlock(bs, yard),
    ...(yard ? { pairsE: pairBlock(bs, "E"), pairsF: pairBlock(bs, "F"), readers: readerBlock(bs) } : {}),
    strata: byStratum,
    ...(yard ? { exploratory: exploratory(bs) } : {}),
  };
}

type SetMetrics = ReturnType<typeof analyseSet>;
type PairJson = { counts: { n: number }; stats: Record<string, ReturnType<typeof iv>> | null };
type ShareJson = ReturnType<typeof shareJson>;

/** The pre-registered recommendation rule applied to the results. */
function recommend(y: SetMetrics, p: SetMetrics) {
  const pairOf: Record<string, string | null> = { "vision+ppocr": "vision+ppocr", "vision+qwen": "vision+qwen", "ppocr+qwen": "ppocr+qwen", "vision+ppocr+qwen": null };
  const asIv = (x: ReturnType<typeof iv>): Interval | null => x;
  const rows = AGREEING.map((a) => {
    const wrong = asIv((y.labels as Record<string, ShareJson>)[a]!.share);
    const pk = pairOf[a];
    const pm = pk ? ((y.pairsE as Record<string, PairJson>)[pk] ?? null) : null;
    // Lift: undefined when not applicable (three readers) or when it is undefined because one reader is never wrong
    // (no overlap possible); null when the pair is under the cell minimum (unmeasured, so not strong).
    const liftLo = !pk ? undefined : !pm?.stats ? null : pm.stats.lift ? pm.stats.lift.lo : undefined;
    const third = a.split("+").length === 2 ? (p.third as Record<string, { outcomes: Record<string, number>; dissent: ShareJson }>)[a]! : null;
    // Dissent: not applicable where the third reader never reads (Vision+PP-OCR: Qwen is never sent those crops).
    const readable = third && third.outcomes["not-read"]! < Object.values(third.outcomes).reduce((s, n) => s + n, 0);
    const dissentHi = !readable ? undefined : third!.dissent.share ? third!.dissent.share.hi : null;
    let tier = tierOf(wrong, liftLo === undefined ? null : liftLo, dissentHi === undefined ? null : dissentHi);
    if (tier === "strong" && (liftLo === null || dissentHi === null)) tier = "weak";
    return { agreeing: a, wrong: iv(wrong), liftLo, dissentHi, tier };
  });
  // Overlapping intervals: the higher point estimate takes the more conservative tier.
  const order = ["strong", "weak", "exclude", "unmeasured"];
  const notSeparable: string[][] = [];
  for (const x of rows)
    for (const z of rows) {
      if (x.agreeing >= z.agreeing || !overlaps(x.wrong, z.wrong)) continue;
      notSeparable.push([x.agreeing, z.agreeing]);
      const [hi, lo] = x.wrong!.value >= z.wrong!.value ? [x, z] : [z, x];
      if (order.indexOf(hi.tier) < order.indexOf(lo.tier) && hi.tier !== "unmeasured" && lo.tier !== "unmeasured") hi.tier = lo.tier;
    }
  // Qwen plus one OCR: extra support when not strong, or when its wrong labels / dissents sit mostly in shared titles.
  const qwenOcr = (["vision+qwen", "ppocr+qwen"] as const).map((a) => {
    const yr = y.rarity as Record<string, ShareJson>;
    const pr = p.rarity as Record<string, { dissent: ShareJson | null }>;
    const wrongShared = yr[`${a}|shared`]!.k, wrongDistinct = yr[`${a}|distinctive`]!.k;
    const disShared = pr[`${a}|shared`]!.dissent?.k ?? 0, disDistinct = pr[`${a}|distinctive`]!.dissent?.k ?? 0;
    const tier = rows.find((r) => r.agreeing === a)!.tier;
    const mostlyShared = wrongShared > wrongDistinct || disShared > disDistinct;
    return { agreeing: a, tier, wrongShared, wrongDistinct, dissentShared: disShared, dissentDistinct: disDistinct, extraSupport: tier !== "strong" || mostlyShared };
  });
  return { rows, notSeparable, qwenOcr };
}

function analyse(): void {
  const sets = Object.fromEntries(NAMES.map((s) => [s, analyseSet(s)])) as Record<SetName, SetMetrics>;
  const m = {
    card: "TS-1",
    question: "Are F-0's readers' errors uncorrelated enough for two-of-three agreement to serve as a training label?",
    constants: TS1,
    sets,
    recommendation: recommend(sets.yardstick, sets["pilot-000"]),
  };
  const out = join(REPO, "evals", "TS1");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "metrics.json"), compactJson(m) + "\n");
  const rp = join(out, "report.md");
  const MARK = "<!-- generated by src/eval/ts1-cli.ts analyse: edit above this line -->";
  const text = readFileSync(rp, "utf8");
  const head = text.includes(MARK) ? text.slice(0, text.indexOf(MARK)) : text.trimEnd() + "\n\n";
  writeFileSync(rp, head + MARK + "\n\n" + tablesMd(m));
  log("analyse: evals/TS1/{metrics.json,report.md}");
}

// --- report tables -----------------------------------------------------------------------------------------

const pct = (x: ReturnType<typeof iv>) => (x ? `${r1(x.value * 100)} % (${r1(x.lo * 100)}–${r1(x.hi * 100)})` : "—");
const num = (x: ReturnType<typeof iv>, d = 2) => (x ? `${x.value.toFixed(d)} (${x.lo.toFixed(d)} to ${x.hi.toFixed(d)})` : "—");
const r1 = (x: number) => Math.round(x * 10) / 10;
const sh = (s: ShareJson) => (s.share ? `${s.k}/${s.n}, ${pct(s.share)}` : `${s.k}/${s.n}`);
const NAME: Record<string, string> = { vision: "Vision", ppocr: "PP-OCR", qwen: "Qwen" };
const nice = (k: string) => k.split("+").map((r) => NAME[r] ?? r).join("+");

function pairTable(pairs: Record<string, PairJson>, k: ErrorKind): string[] {
  const out = [
    `| pair (${k}) | boxes read by both | P(A wrong) | P(B wrong) | P(both) | P(A)·P(B) | lift | phi | Yule's Q | P(same wrong work) | same of joint | agreement wrong share |`,
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const [p, v] of Object.entries(pairs)) {
    const c = v.counts as PairJson["counts"] & { a: number; agree: number; agreeWrong: number; sameWrong: number; haldane: boolean };
    const s = v.stats;
    if (!s) {
      out.push(`| ${nice(p)} | ${c.n} | counts only: both ${c.a}, same wrong ${c.sameWrong}, agreements ${c.agree} (${c.agreeWrong} wrong) |||||||||||`);
      continue;
    }
    out.push(
      `| ${nice(p)} | ${c.n} | ${pct(s.pA!)} | ${pct(s.pB!)} | ${pct(s.pBoth!)} (${c.a}) | ${pct(s.product!)} | ${num(s.lift!, 1)} | ${num(s.phi!)} | ${num(s.yuleQ!)}${c.haldane ? " †" : ""} | ${pct(s.pSameWrong!)} (${c.sameWrong}) | ${pct(s.sameOfJoint!)} | ${pct(s.agreeWrongShare!)} (${c.agreeWrong}/${c.agree}) |`,
    );
  }
  return out;
}

function tablesMd(m: { sets: Record<SetName, SetMetrics>; recommendation: ReturnType<typeof recommend> }): string {
  const out: string[] = [];
  for (const set of NAMES) {
    const s = m.sets[set];
    const yard = set === "yardstick";
    out.push(`## ${set} (${s.scope})\n`);
    out.push(`${s.photos} photos, ${s.boxCount} kept boxes. Read by: ${READERS.map((r) => `${NAME[r]} ${(s.readBy as Record<string, number>)[r]}`).join(", ")}. Intervals are 95 % photo-cluster bootstraps (${TS1.reps} draws); cells under ${TS1.minCell} boxes are counts only.\n`);
    out.push(`### Reference set and labels (M4${yard ? ", M2" : ""})\n`);
    out.push(`Catalog-confirmed (F-0 accepted) boxes: **${s.reference.count ? `${s.reference.count.value} (${Math.round(s.reference.count.lo)}–${Math.round(s.reference.count.hi)})` : "0"}**, ${s.reference.perPhoto} a photo, ${r1(s.reference.shareOfBoxes * 100)} % of kept boxes.\n`);
    out.push(yard ? "| agreeing readers | labels wrong / labels, share wrong |\n|---|---:|" : "| agreeing readers | labels |\n|---|---:|");
    for (const [a, v] of Object.entries(s.labels)) out.push(`| ${a === "all" ? "all" : nice(a)} | ${yard ? sh(v as ShareJson) : (v as { n: number }).n} |`);
    out.push("\n**Also reported (not in a rule): co-confirmation.** Boxes both readers read; both confirm a work; those works differ (at least one reader is wrong).\n");
    out.push("| pair | read by both | both confirm | differ |\n|---|---:|---:|---:|");
    for (const [p, v] of Object.entries(s.coConfirm)) out.push(`| ${nice(p)} | ${v.readByBoth} | ${v.bothConfirm} | ${v.differ} |`);
    if (yard) {
      out.push("\n### Pair error overlap (M1)\n");
      out.push("E = wrong confirmation (primary); F = fails to confirm an annotated work (secondary). Qwen pairs are over Qwen-read crops only, where Vision and PP-OCR did not co-confirm one work. † Haldane-corrected Yule's Q (a zero cell).\n");
      out.push(...pairTable(s.pairsE as Record<string, PairJson>, "E"), "");
      out.push(...pairTable(s.pairsF as Record<string, PairJson>, "F"));
      out.push("\n### Reader wrong share (M3)\n");
      out.push("| reader | of its confirmations, wrong (all reads) | on Qwen-read crops |\n|---|---:|---:|");
      for (const [r, v] of Object.entries(s.readers as Record<string, { all: ShareJson; qwenRead: ShareJson }>)) out.push(`| ${NAME[r]} | ${sh(v.all)} | ${sh(v.qwenRead)} |`);
    }
    if (yard) {
      const x = s.exploratory as ReturnType<typeof exploratory>;
      out.push("\n### Exploratory, after the results (not pre-registered): what the wrong labels are\n");
      out.push("The library's inventory holds some books under two records. A wrong label is **same book, other record** when its title form and primary surname match an annotated book in the image; **namesake** when only the title matches; **same author** when only the surname does.\n");
      out.push(`| agreeing | ${WRONG_KINDS.join(" | ")} |\n|---|${WRONG_KINDS.map(() => "---:").join("|")}|`);
      for (const [a, v] of Object.entries(x.wrongKinds)) out.push(`| ${a === "all" ? "all" : nice(a)} | ${WRONG_KINDS.map((k) => v[k]).join(" | ")} |`);
      out.push("\nAt book level (every record of an annotated book counts right):\n");
      out.push("| agreeing readers | labels wrong / labels, share wrong | shared title | distinctive title |\n|---|---:|---:|---:|");
      const br = x.bookLevel.rarity as Record<string, ShareJson>;
      for (const [a, v] of Object.entries(x.bookLevel.labels)) out.push(`| ${a === "all" ? "all" : nice(a)} | ${sh(v as ShareJson)} | ${sh(br[`${a}|shared`]!)} | ${sh(br[`${a}|distinctive`]!)} |`);
      out.push("");
      out.push(...pairTable(x.bookLevel.pairsE as Record<string, PairJson>, "E"));
      out.push("\n| reader | of its confirmations, wrong (all reads) | on Qwen-read crops |\n|---|---:|---:|");
      for (const [r, v] of Object.entries(x.bookLevel.readers as Record<string, { all: ShareJson; qwenRead: ShareJson }>)) out.push(`| ${NAME[r]} | ${sh(v.all)} | ${sh(v.qwenRead)} |`);
    }
    out.push("\n### Third-reader dissent (M5)\n");
    out.push(`Per two-reader label, the reader outside the agreement. Dissent share is over labels whose third reader read the crop.${yard ? " Wrong share of the labels with each outcome in brackets." : ""}\n`);
    out.push(`| agreeing | labels | ${THIRD_OUTCOMES.join(" | ")} | dissent share |\n|---|---:|${THIRD_OUTCOMES.map(() => "---:").join("|")}|---:|`);
    for (const [a, v] of Object.entries(s.third as Record<string, { labels: number; outcomes: Record<string, number>; dissent: ShareJson; wrongBy?: Record<string, ShareJson> }>)) {
      const cells = THIRD_OUTCOMES.map((o) => `${v.outcomes[o]}${v.wrongBy && v.outcomes[o] ? ` [${v.wrongBy[o]!.k} wrong]` : ""}`);
      out.push(`| ${nice(a)} | ${v.labels} | ${cells.join(" | ")} | ${sh(v.dissent)} |`);
    }
    out.push(`\n### Title rarity of the label (M6)\n`);
    out.push(yard ? "| agreeing | shared title: wrong | distinctive title: wrong |\n|---|---:|---:|" : "| agreeing | shared: labels, dissent | distinctive: labels, dissent |\n|---|---:|---:|");
    const rr = s.rarity as Record<string, ShareJson | { labels: number; dissent: ShareJson | null }>;
    for (const a of ["all", ...AGREEING]) {
      const cell = (r: string) => {
        const v = rr[`${a}|${r}`]!;
        return yard ? sh(v as ShareJson) : `${(v as { labels: number }).labels}${(v as { dissent: ShareJson | null }).dissent ? `, ${sh((v as { dissent: ShareJson }).dissent)}` : ""}`;
      };
      out.push(`| ${a === "all" ? "all" : nice(a)} | ${cell("shared")} | ${cell("distinctive")} |`);
    }
    out.push("\n### Strata\n");
    out.push(yard ? "| stratum | value | boxes | labels wrong (all) | V+P wrong | V+Q wrong | P+Q wrong | V–P E lift | V–Q E lift | P–Q E lift |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|" : "| stratum | value | boxes | labels | V+P | V+Q | P+Q | V+Q dissent | P+Q dissent |\n|---|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const st of s.strata) {
      if (yard) {
        const L = st.labels as Record<string, ShareJson>;
        const P = (st as { pairsE: Record<string, PairJson> }).pairsE;
        const lf = (k: string) => (P[k]!.stats?.lift ? num(P[k]!.stats!.lift!, 1) : `n ${P[k]!.counts.n}`);
        out.push(`| ${st.stratum} | ${st.value} | ${st.boxCount} | ${sh(L.all!)} | ${sh(L["vision+ppocr"]!)} | ${sh(L["vision+qwen"]!)} | ${sh(L["ppocr+qwen"]!)} | ${lf("vision+ppocr")} | ${lf("vision+qwen")} | ${lf("ppocr+qwen")} |`);
      } else {
        const L = st.labels as Record<string, { n: number }>;
        const T = st.third as Record<string, { dissent: ShareJson }>;
        out.push(`| ${st.stratum} | ${st.value} | ${st.boxCount} | ${L.all!.n} | ${L["vision+ppocr"]!.n} | ${L["vision+qwen"]!.n} | ${L["ppocr+qwen"]!.n} | ${sh(T["vision+qwen"]!.dissent)} | ${sh(T["ppocr+qwen"]!.dissent)} |`);
      }
    }
    out.push("");
  }
  out.push("## Recommendation rule, applied\n");
  out.push("| agreeing | yardstick labels wrong | E lift lower bound | pilot dissent upper bound | tier |\n|---|---:|---:|---:|---|");
  const f = (x: number | null | undefined) => (x === undefined ? "n/a" : x === null ? "unmeasured" : x.toFixed(2));
  for (const r of m.recommendation.rows) out.push(`| ${nice(r.agreeing)} | ${pct(r.wrong)} | ${f(r.liftLo)} | ${f(r.dissentHi)} | **${r.tier}** |`);
  out.push(`\nNot separable at this sample size (overlapping intervals): ${m.recommendation.notSeparable.map((p) => p.map(nice).join(" vs ")).join("; ") || "none"}.\n`);
  out.push("| Qwen plus one OCR | tier | yardstick wrong: shared / distinctive | pilot dissent: shared / distinctive | extra support |\n|---|---|---:|---:|---|");
  for (const q of m.recommendation.qwenOcr) out.push(`| ${nice(q.agreeing)} | ${q.tier} | ${q.wrongShared} / ${q.wrongDistinct} | ${q.dissentShared} / ${q.dissentDistinct} | ${q.extraSupport ? "yes" : "no"} |`);
  return out.join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "boxes" && (arg === "pilot-000" || arg === "yardstick")) boxes(arg);
  else if (cmd === "analyse") analyse();
  else {
    process.stderr.write("usage: ts1-cli.ts boxes <pilot-000|yardstick> | analyse\n");
    process.exit(2);
  }
}
