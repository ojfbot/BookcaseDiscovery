// F-0h runner: neighbour context on each set's cached default boxes, readings and F-0 decisions (F-0g's base).
//
//   node src/eval/f0h-cli.ts stats              # the yardstick's inventory catalog gets C-7's statistics sidecar (once)
//   node src/eval/f0h-cli.ts analyse            # both sets: evals/F0h/{metrics.json,report.md} tables (aggregates only)
//   node src/eval/f0h-cli.ts render             # the data root's private/f0h/renders/pilot-000/index.html (private)
//
// Cached stage folders are read, never written; everything per box (decisions, hypotheses, detection-gap flags) stays
// under the data root's private/f0h/<set>/. Nothing here changes F-0's decision or default catalog:
// `confirmed-by-context` is a separate, recorded basis that can be switched off. No profile input (INV-13).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { openCatalog } from "../catalog/cli.ts";
import { sameBook as sameBookWith } from "../catalog/lookalike.ts";
import { buildStats, counterCheck, openStats, rarityBasis, statsPathFor, type RarityBasis } from "../catalog/rarity.ts";
import { retrieve, scoreWorks, type Candidate } from "../catalog/retrieve.ts";
import { LOOKALIKE } from "../catalog/lookalike.ts";
import { dataRoot } from "../ledger/images.ts";
import { confirms, loadReadings, readJsonl, READERS, variantsOf, type Detection, type Reading, type ReaderName } from "./f0.ts";
import { imagesOf, meanCI, SETS, type SetName, type Slim } from "./f0c-cli.ts";
import { boxRows, type Tri } from "./f0e.ts";
import { kinds } from "./f0c.ts";
import { evidenceFor } from "./f0f-cli.ts";
import { loadBooks, loadDets, yardstickCopies } from "./f0g-cli.ts";
import {
  buildRows,
  CONTEXT,
  contexts,
  decideContext,
  drawAnchor,
  halves,
  KEEP,
  misfiles,
  ordered,
  orderPairs,
  rankHypothesis,
  readerTrial,
  sameAuthor,
  sameWork,
  stripContext,
  stripCue,
  stripLabels,
  surnameKey,
  titleFit,
  tokensOf,
  usableText,
  wilson,
  worksBucket,
  type Context,
  type ContextDecision,
  type ProposalFit,
  type ReaderTrial,
  type Row,
  type RowContext,
  type TitleFit,
  type WorkRef,
} from "./f0h.ts";
import { clusterBootstrap, quantile, rate, rng } from "./q1.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = dataRoot();
const PRIV = join(ROOT, "private", "f0h");
const REPS = 2000;
const SEED = 20261103;
const log = (s: string): void => console.error(`[f0h] ${s}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const triOf = (b: { value: number; lo: number; hi: number } | null): Tri => (b ? [r4(b.value), r4(b.lo), r4(b.hi)] : null);
const SET_NAMES: SetName[] = ["pilot-000", "yardstick"];

const stage = (set: string): string => {
  const dir = join(PRIV, set);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// --- catalog side ------------------------------------------------------------------------------------------------

interface WorkRow extends WorkRef {
  editions: number;
  /** Whole and main title forms (kinds T, M, V, W), tokenised. */
  forms: string[][];
}

/** Catalog facts F-0h needs, memoised: works, an author's and a series' works, and the author-works count. */
class Catalog {
  readonly db: DatabaseSync;
  readonly basis: RarityBasis;
  readonly works: number;
  private memo = new Map<string, WorkRow | null>();
  private p1 = new Map<string, string[]>();
  private p2 = new Map<string, string[]>();
  private authorN = new Map<string, number>();
  private qWork;
  private qP1;
  private qP2;
  private qAuthorN;

  constructor(path: string) {
    this.db = openCatalog(path);
    const stats = openStats(statsPathFor(path), path);
    this.basis = rarityBasis(this.db, stats);
    this.works = stats.works;
    this.qWork = this.db.prepare("SELECT id, title, authors, edition_count, title_norm FROM works WHERE id = ?");
    this.qP1 = this.db.prepare("SELECT DISTINCT b.work_id AS id FROM work_authors a JOIN work_authors b ON b.author_id = a.author_id WHERE a.work_id = ?");
    this.qP2 = this.db.prepare("SELECT DISTINCT b.work_id AS id FROM work_series a JOIN work_series b ON b.series_id = a.series_id AND b.depth = 0 WHERE a.work_id = ? AND a.depth = 0");
    this.qAuthorN = this.db.prepare("SELECT count(*) AS n FROM work_authors wa JOIN authors a ON a.id = wa.author_id WHERE a.name = ?");
  }

  work(id: string): WorkRow {
    if (!this.memo.has(id)) {
      const r = this.qWork.get(id) as { id: string; title: string; authors: string; edition_count: number; title_norm: string } | undefined;
      this.memo.set(
        id,
        r
          ? {
              workId: r.id,
              title: r.title,
              authors: JSON.parse(r.authors) as string[],
              editions: r.edition_count,
              forms: [...new Set(r.title_norm.split("|").filter((f) => /^[TMVW]:/.test(f)).map((f) => f.slice(2)))].map((f) => f.split(" ").filter(Boolean)),
            }
          : null,
      );
    }
    const w = this.memo.get(id);
    if (!w) throw new Error("a cached decision names a work the catalog does not hold");
    return w;
  }
  authorWorks(id: string): string[] {
    if (!this.p1.has(id)) this.p1.set(id, (this.qP1.all(id) as { id: string }[]).map((r) => r.id).sort());
    return this.p1.get(id)!;
  }
  seriesWorks(id: string): string[] {
    if (!this.p2.has(id)) this.p2.set(id, (this.qP2.all(id) as { id: string }[]).map((r) => r.id).sort());
    return this.p2.get(id)!;
  }
  /** Catalog works of a work's primary author (the shuffle's bucket). */
  primaryAuthorWorks(id: string): number {
    const name = this.work(id).authors[0] ?? "";
    if (!this.authorN.has(name)) this.authorN.set(name, (this.qAuthorN.get(name) as { n: number }).n);
    return this.authorN.get(name)!;
  }
  /** Distinctive: few catalog works carry the token (C-7's sidecar), at least 3 letters, not a stopword. */
  distinctive = (t: string): boolean => this.basis.stats.word(t).works < CONTEXT.distinctiveShare * this.works;
  sameBook = (a: WorkRef, b: WorkRef): boolean => sameBookWith(a, b, this.basis.forms);
}

// --- one set's data ------------------------------------------------------------------------------------------------

interface Slot {
  /** Box id `<image>:<i>`. */
  id: string;
  imageId: string;
  rowKey: string;
  pos: number;
  accepted: WorkRef | null;
  copy: WorkRef | null;
}

interface SetData {
  set: SetName;
  dets: Map<string, Detection>;
  books: Map<string, boolean[]>;
  base: Map<string, Slim>;
  readings: Map<string, Partial<Record<ReaderName, Reading>>>;
  cat: Catalog;
  rows: Map<string, (Row & { key: string })[]>;
  /** Every row member by box id. */
  slots: Map<string, Slot>;
  /** Box ids per row, in order. */
  rowIds: Map<string, string[]>;
  photos: string[];
  half: { a: Set<string>; b: Set<string> } | null;
}

function loadSet(set: SetName): SetData {
  const dets = loadDets(set);
  const books = loadBooks(set, dets);
  const basePath = join(ROOT, "f0c", set, "base-decisions.jsonl");
  if (!existsSync(basePath)) throw new Error(`run node src/eval/f0c-cli.ts base ${set} first`);
  const base = new Map(readJsonl<Slim>(basePath).map((d) => [d.id, d]));
  const readings = loadReadings(SETS[set].base);
  const cat = new Catalog(SETS[set].catalog);
  const copiesPath = join(ROOT, "private", "f0g", set, "copies.jsonl");
  const copies = new Map(readJsonl<{ id: string; basis: string | null; workId: string | null }>(copiesPath).filter((c) => c.basis === "confirmed-by-copy" && c.workId).map((c) => [c.id, c.workId!]));
  const rows = new Map<string, (Row & { key: string })[]>();
  const slots = new Map<string, Slot>();
  const rowIds = new Map<string, string[]>();
  for (const d of dets.values()) {
    const rs = buildRows(d, (i) => books.get(d.id)![i]!).map((r, k) => ({ ...r, key: `${d.id}|${k}` }));
    rows.set(d.id, rs);
    for (const r of rs) {
      const ids = r.members.map((i) => `${d.id}:${i}`);
      rowIds.set(r.key, ids);
      ids.forEach((id, pos) => {
        const acc = base.get(id)?.accepted ?? null;
        const cp = copies.get(id) ?? null;
        slots.set(id, { id, imageId: d.id, rowKey: r.key, pos, accepted: acc ? cat.work(acc) : null, copy: cp ? cat.work(cp) : null });
      });
    }
  }
  const photos = [...dets.keys()].sort();
  return { set, dets, books, base, readings, cat, rows, slots, rowIds, photos, half: set === "pilot-000" ? halves(photos) : null };
}

// --- the context engine ----------------------------------------------------------------------------------------------

/** One anchor role for a target: a work that proposes, and how. */
interface AnchorUse {
  work: WorkRef;
  source: "anchor" | "bracket";
  /** The anchor spines (box ids) behind it. */
  from: string[];
}

interface Proposal {
  workId: string;
  sources: Set<"P1" | "P2" | "bracket">;
}

function proposalsFor(cat: Catalog, uses: readonly AnchorUse[]): Map<string, Proposal> {
  const out = new Map<string, Proposal>();
  const add = (id: string, s: "P1" | "P2" | "bracket") => {
    const p = out.get(id) ?? { workId: id, sources: new Set() };
    p.sources.add(s);
    out.set(id, p);
  };
  for (const u of uses) {
    for (const id of cat.authorWorks(u.work.workId)) add(id, u.source === "bracket" ? "bracket" : "P1");
    if (u.source === "anchor") for (const id of cat.seriesWorks(u.work.workId)) add(id, "P2");
  }
  return out;
}

/** Per (spine, reader): variants, tokens, ranked candidates (depth 50) and memoised `scoreWorks`. */
class ReaderSide {
  private ranked = new Map<string, Candidate[]>();
  private scored = new Map<string, Map<string, Candidate>>();
  private cat: Catalog;
  private readings: SetData["readings"];
  constructor(cat: Catalog, readings: SetData["readings"]) {
    this.cat = cat;
    this.readings = readings;
  }
  variants(id: string, r: ReaderName): string[] {
    return variantsOf(this.readings.get(id)?.[r]);
  }
  rankedFor(id: string, r: ReaderName): Candidate[] {
    const key = `${id}\u0000${r}`;
    if (!this.ranked.has(key)) {
      const v = this.variants(id, r);
      this.ranked.set(key, v.length ? retrieve(this.cat.db, v, LOOKALIKE.depth) : []);
    }
    return this.ranked.get(key)!;
  }
  score(id: string, r: ReaderName, workIds: string[]): Map<string, Candidate> {
    const key = `${id}\u0000${r}`;
    const m = this.scored.get(key) ?? new Map<string, Candidate>();
    const need = workIds.filter((w) => !m.has(w));
    if (need.length) for (const [w, c] of scoreWorks(this.cat.db, this.variants(id, r), need)) m.set(w, c);
    this.scored.set(key, m);
    return m;
  }
}

const titleEv = (c: Candidate) => c.evidence.find((e) => e.field === "title")?.score ?? 0;

/** The best title fit of a work on a reader's variants: a passing fit first, then the cheapest. */
function bestFit(w: WorkRow, variants: string[], distinctive: (t: string) => boolean): TitleFit {
  let best: TitleFit | null = null;
  for (const v of variants) {
    const toks = tokensOf(v);
    for (const f of w.forms) {
      const fit = titleFit(f, toks, distinctive);
      if (!best || (fit.pass && !best.pass) || (fit.pass === best.pass && fit.cost < best.cost)) best = fit;
    }
  }
  return best ?? { pass: false, cost: Infinity, cover: 0, distinctive: 0, distinctiveMatched: 0, failed: "token" };
}

interface TargetRun {
  decision: ContextDecision;
  /** Proposal-set size before the cap, per reader tried (max), and the winning work's sources. */
  k: number;
  sources: string[];
  usable: boolean;
}

/** F-0h on one target with given anchor uses and given readers (the others hidden). */
function runTarget(sd: SetData, rs: ReaderSide, id: string, uses: readonly AnchorUse[], readers: readonly ReaderName[]): TargetRun {
  const cat = sd.cat;
  const props = proposalsFor(cat, uses);
  const ids = [...props.keys()];
  const withText = readers.filter((r) => rs.variants(id, r).length > 0);
  const usable = withText.some((r) => usableText(rs.variants(id, r)));
  const trials: ReaderTrial[] = [];
  for (const r of withText) {
    const variants = rs.variants(id, r);
    if (!usableText(variants)) continue;
    const scored = rs.score(id, r, ids);
    let kept = ids;
    if (ids.length > CONTEXT.maxProposals) kept = [...ids].sort((a, b) => (scored.get(b)?.score ?? 0) - (scored.get(a)?.score ?? 0) || (a < b ? -1 : 1)).slice(0, CONTEXT.maxProposals);
    const fits: ProposalFit[] = kept.map((w) => {
      const c = scored.get(w)!;
      return { work: cat.work(w), fit: bestFit(cat.work(w), variants, cat.distinctive), score: c.score, titleEvidence: titleEv(c), coverage: c.queryCoverage };
    });
    const ranked = rs.rankedFor(id, r);
    const top = ranked[0];
    trials.push(
      readerTrial(r, fits, {
        sameBook: cat.sameBook,
        openTop: top ? { workId: top.workId, title: top.title, authors: top.authors, score: top.score, passes: confirms(top) } : null,
        counter: (f) => counterCheck(cat.basis, scored.get(f.work.workId)!, ranked, variants),
      }),
    );
  }
  const confirmedBy: Partial<Record<ReaderName, WorkRef | null>> = {};
  const slim = sd.base.get(id);
  for (const r of readers) {
    const w = slim?.confirmed[r];
    confirmedBy[r] = w ? cat.work(w) : null;
  }
  const decision = decideContext(id, trials, confirmedBy, cat.sameBook, (w) => cat.work(w));
  const win = decision.workId ? props.get(decision.workId) : undefined;
  return { decision, k: ids.length, sources: win ? [...win.sources].sort() : [], usable };
}

/** Anchor uses for position `pos` of a row under a context (anchors, brackets). */
function usesOf(ids: string[], ctx: Context, workAt: (p: number) => WorkRef | null): AnchorUse[] {
  const uses: AnchorUse[] = ctx.anchors.map((q) => ({ work: workAt(q)!, source: "anchor", from: [ids[q]!] }));
  for (const [l, r] of ctx.brackets) uses.push({ work: workAt(l)!, source: "bracket", from: [ids[l]!, ids[r]!] }, { work: workAt(r)!, source: "bracket", from: [ids[l]!, ids[r]!] });
  return uses;
}

/** Targets of a set: unconfirmed row members with an anchor or a bracket, under an anchor rule. */
function targetsOf(sd: SetData, withCopies: boolean): { id: string; rowKey: string; pos: number; ctx: Context; uses: AnchorUse[] }[] {
  const out: { id: string; rowKey: string; pos: number; ctx: Context; uses: AnchorUse[] }[] = [];
  for (const [key, ids] of sd.rowIds) {
    const slots = ids.map((id) => sd.slots.get(id)!);
    const workAt = (p: number) => slots[p]!.accepted ?? (withCopies ? slots[p]!.copy : null);
    const ctxs = contexts(ids.length, workAt, (p) => !slots[p]!.accepted && !slots[p]!.copy);
    for (const [pos, ctx] of ctxs) out.push({ id: ids[pos]!, rowKey: key, pos, ctx, uses: usesOf(ids, ctx, workAt) });
  }
  return out;
}

// --- order statistics (label-free) -----------------------------------------------------------------------------------

interface StripRow {
  rowKey: string;
  ordering: boolean;
  context: RowContext;
}

/**
 * Row contexts from F-0f's `shelf-strip` boxes (the only source today; SC-1 replaces it): each strip labels the row(s)
 * standing just above it. Also counts not-a-book boxes of other kinds whose text carries strip wording, which this
 * source leaves out (F-0c's flat-strip flags claim them first).
 */
function strips(sd: SetData): { strips: number; ordering: number; rows: StripRow[]; otherKindsWithStripWording: number } {
  let n = 0;
  let ord = 0;
  let other = 0;
  const rows: StripRow[] = [];
  const ev = evidenceFor(sd.set);
  for (const d of sd.dets.values()) {
    const geo = boxRows(d);
    const k = kinds({ ...d, covers: [] }, ev.get(d.id));
    d.spines.forEach((_, i) => {
      if (sd.books.get(d.id)![i]) return;
      const texts = READERS.flatMap((r) => variantsOf(sd.readings.get(`${d.id}:${i}`)?.[r]));
      if (k.spines[i]!.why !== "shelf-strip") {
        if (stripCue(texts).strip) other++;
        return;
      }
      const context = stripContext(texts);
      n++;
      if (context.ordering) ord++;
      const g = geo[i]!.g;
      for (const r of sd.rows.get(d.id) ?? []) if (stripLabels(g, r)) rows.push({ rowKey: r.key, ordering: context.ordering !== null, context });
    });
  }
  return { strips: n, ordering: ord, rows, otherKindsWithStripWording: other };
}

function orderStats(sd: SetData, photos: Set<string>, stripRows: StripRow[]) {
  let adj = 0, adjSameWork = 0, adjSameAuthor = 0, near = 0, nearSameAuthor = 0;
  let anchored = 0, anchoredSame = 0, bracketed = 0, bracketPure = 0;
  const rowStats: { imageId: string; pairs: number; inOrder: number; ordered: boolean; misfiles: number; confirmed: number; strip: boolean }[] = [];
  for (const [key, ids] of sd.rowIds) {
    const imageId = key.split("|")[0]!;
    if (!photos.has(imageId)) continue;
    const w = ids.map((id) => sd.slots.get(id)!.accepted);
    for (let p = 0; p < w.length; p++) {
      if (!w[p]) continue;
      for (let d = 1; d <= CONTEXT.anchorReach; d++) {
        const q = w[p + d];
        if (!q) continue;
        if (d === 1) {
          adj++;
          if (sameWork(w[p]!, q)) adjSameWork++;
          else if (sameAuthor(w[p]!, q)) adjSameAuthor++;
        }
        if (!sameWork(w[p]!, q)) {
          near++;
          if (sameAuthor(w[p]!, q)) nearSameAuthor++;
        }
      }
      // A confirmed spine with a confirmed neighbour within reach: does it share an author with one of them?
      const others = [-2, -1, 1, 2].map((o) => w[p + o]).filter((x): x is WorkRef => Boolean(x));
      if (others.length) {
        anchored++;
        if (others.some((o) => sameAuthor(o, w[p]!))) anchoredSame++;
      }
      // Bracket purity: the nearest confirmed spines on each side share an author, within a bracket's span.
      let l = p - 1;
      while (l >= 0 && !w[l]) l--;
      let r = p + 1;
      while (r < w.length && !w[r]) r++;
      if (l >= 0 && r < w.length && r - l - 1 <= CONTEXT.bracketMaxGap && sameAuthor(w[l]!, w[r]!)) {
        bracketed++;
        if (sameAuthor(w[l]!, w[p]!)) bracketPure++;
      }
    }
    const keys = w.filter((x): x is WorkRef => Boolean(x)).map(surnameKey);
    const o = orderPairs(keys);
    rowStats.push({ imageId, pairs: o.pairs, inOrder: o.inOrder, ordered: ordered(keys), misfiles: ordered(keys) ? misfiles(keys).length : 0, confirmed: keys.length, strip: stripRows.some((s) => s.rowKey === key) });
  }
  const scored = rowStats.filter((r) => r.pairs >= CONTEXT.orderedMinPairs);
  const ord = scored.filter((r) => r.ordered);
  const pairsAll = scored.reduce((s, r) => s + r.pairs, 0);
  return {
    adjacentConfirmedPairs: adj,
    adjacentSameWork: adj ? r4(adjSameWork / adj) : null,
    adjacentSameAuthorOtherWork: adj - adjSameWork ? r4(adjSameAuthor / (adj - adjSameWork)) : null,
    withinTwoPairsOtherWork: near,
    withinTwoSameAuthor: near ? r4(nearSameAuthor / near) : null,
    anchorSameAuthorRate: anchored ? r4(anchoredSame / anchored) : null,
    anchorSameAuthorN: anchored,
    bracketPurity: bracketed ? r4(bracketPure / bracketed) : null,
    bracketedN: bracketed,
    rowsScored: scored.length,
    consecutivePairs: pairsAll,
    inOrderShare: pairsAll ? r4(scored.reduce((s, r) => s + r.inOrder, 0) / pairsAll) : null,
    inOrderShareCI: triOf(clusterBootstrap(scored, (rs) => { const p = rs.reduce((s, r) => s + r.pairs, 0); return p ? rs.reduce((s, r) => s + r.inOrder, 0) / p : null; }, REPS, SEED)),
    rowsOrdered: ord.length,
    rowsOrderedShare: scored.length ? r4(ord.length / scored.length) : null,
    rowsWithBreak: scored.filter((r) => r.inOrder < r.pairs).length,
    rowConsistencyP50: scored.length ? r4(quantile(scored.map((r) => r.inOrder / r.pairs).sort((a, b) => a - b), 0.5)) : null,
    misfileCandidates: ord.reduce((s, r) => s + r.misfiles, 0),
    misfileShareOfConfirmedInOrderedRows: ord.reduce((s, r) => s + r.confirmed, 0) ? r4(ord.reduce((s, r) => s + r.misfiles, 0) / ord.reduce((s, r) => s + r.confirmed, 0)) : null,
    rowsWithStrip: rowStats.filter((r) => r.strip).length,
  };
}

// --- S-1's outline gaps inside brackets (for F-0k) ---------------------------------------------------------------------

interface S1Row {
  band: number;
  voids?: { booksW: [number, number]; line: [number, number][]; stretches: { from: number; to: number; kind: string; dominant?: string }[] };
}

/** Arc length along a polyline of the nearest point to (x, y). */
function arcOf(line: [number, number][], x: number, y: number): number {
  let best = { d: Infinity, s: 0 };
  let cum = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i]!;
    const [bx, by] = line[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len)));
    const d = Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y);
    if (d < best.d) best = { d, s: cum + t * len };
    cum += len;
  }
  return best.s;
}

function detectionGaps(sd: SetData, brackets: { rowKey: string; l: number; r: number; author: string }[]): { flags: object[]; boxGaps: number; s1Front: number; bracketsWithFlag: number } {
  const s1Path = join(ROOT, "private", "s1", sd.set, "shelf.jsonl");
  const s1 = new Map(readJsonl<{ id: string; rows: S1Row[] }>(s1Path).map((x) => [x.id, x.rows]));
  const flags: object[] = [];
  let boxGaps = 0;
  let s1Front = 0;
  const flagged = new Set<string>();
  for (const b of brackets) {
    const imageId = b.rowKey.split("|")[0]!;
    const row = sd.rows.get(imageId)!.find((r) => r.key === b.rowKey)!;
    const det = sd.dets.get(imageId)!;
    const geo = boxRows(det);
    const mw = det.gaps.medianWidth || 1;
    for (let p = b.l; p < b.r; p++)
      if (row.gaps[p]! >= CONTEXT.gapWidths) {
        boxGaps++;
        flagged.add(`${b.rowKey}:${b.l}`);
        flags.push({ kind: "box-gap", imageId, band: row.band, between: [row.members[p], row.members[p + 1]], widths: row.gaps[p] });
      }
    const s1row = s1.get(imageId)?.find((r) => r.band === row.band && r.voids);
    if (!s1row?.voids) continue;
    const { line, booksW, stretches } = s1row.voids;
    // S-1's positions count median widths from the row's start; the books' first edge anchors them on the line.
    const bandBooks = det.spines.flatMap((s, i) => (sd.books.get(imageId)![i] && geo[i]!.band === row.band ? s.polygon : []));
    if (!bandBooks.length) continue;
    const start = Math.min(...bandBooks.map(([x, y]) => arcOf(line, x, y)));
    const lo = arcOf(line, geo[row.members[b.l]!]!.g.cx, geo[row.members[b.l]!]!.g.cy);
    const hi = arcOf(line, geo[row.members[b.r]!]!.g.cx, geo[row.members[b.r]!]!.g.cy);
    for (const st of stretches) {
      if (st.kind !== "outline-gap" || st.dominant !== "front") continue;
      const mid = start + ((st.from + st.to) / 2 - booksW[0]) * mw;
      if (mid > Math.min(lo, hi) && mid < Math.max(lo, hi)) {
        s1Front++;
        flagged.add(`${b.rowKey}:${b.l}`);
        flags.push({ kind: "s1-front-outline-gap", imageId, band: row.band, between: [row.members[b.l], row.members[b.r]], widths: r4(st.to - st.from), author: b.author });
      }
    }
  }
  return { flags, boxGaps, s1Front, bracketsWithFlag: flagged.size };
}

// --- one set's run ---------------------------------------------------------------------------------------------------

interface PhotoCount {
  imageId: string;
  boxes: number;
  confirmed: number;
  byContext: number;
  byContextCopyArm: number;
  wrongBase?: number;
  wrongWith?: number;
}

function analyseSet(set: SetName) {
  const t0 = Date.now();
  const sd = loadSet(set);
  const rs = new ReaderSide(sd.cat, sd.readings);
  const evalPhotos = sd.half ? sd.half.b : new Set(sd.photos);
  const inEval = (id: string) => evalPhotos.has(id.split(":")[0]!);
  const readersOf = (id: string): ReaderName[] => READERS.filter((r) => sd.readings.get(id)?.[r]);

  // The real arm, on every photo (the keep rule reads half B on pilot-000).
  const targets = targetsOf(sd, false);
  const runs = new Map<string, TargetRun & { t: (typeof targets)[number] }>();
  for (const t of targets) runs.set(t.id, { ...runTarget(sd, rs, t.id, t.uses, readersOf(t.id)), t });
  log(`${set}: ${targets.length} targets, ${[...runs.values()].filter((r) => r.decision.basis).length} confirmed-by-context (${Math.round((Date.now() - t0) / 1000)} s)`);

  // The copy-anchor arm (reported apart): confirmed-by-copy spines may anchor too.
  const copyTargets = targetsOf(sd, true);
  const copyRuns = new Map<string, TargetRun>();
  for (const t of copyTargets) copyRuns.set(t.id, runs.has(t.id) && JSON.stringify(runs.get(t.id)!.t.uses.map((u) => u.work.workId)) === JSON.stringify(t.uses.map((u) => u.work.workId)) ? runs.get(t.id)! : runTarget(sd, rs, t.id, t.uses, readersOf(t.id)));

  // Hypotheses for targets with no usable text, and their half-B check on accepted spines with every reader hidden.
  const orderPhotos = sd.half ? sd.half.a : new Set(sd.photos);
  const stripInfo = strips(sd);
  const orderA = orderStats(sd, orderPhotos, stripInfo.rows);
  const priorBracket = orderA.bracketPurity;
  const priorAnchor = orderA.anchorSameAuthorRate;
  const rowOrdered = new Map<string, boolean>();
  for (const [key, ids] of sd.rowIds) rowOrdered.set(key, ordered(ids.map((id) => sd.slots.get(id)!.accepted).filter((x): x is WorkRef => Boolean(x)).map(surnameKey)) || stripInfo.rows.some((s) => s.rowKey === key && s.ordering));
  const hypothesise = (id: string, uses: AnchorUse[], rowKey: string) => {
    const props = proposalsFor(sd.cat, uses);
    const br = uses.find((u) => u.source === "bracket");
    const left = br ? sd.slots.get(br.from[0]!)!.accepted! : null;
    const right = br ? sd.slots.get(br.from[1]!)!.accepted! : null;
    const works = [...props.keys()].map((w) => ({ workId: w, title: sd.cat.work(w).title, editions: sd.cat.work(w).editions }));
    return {
      id,
      kind: br ? "bracket" : "adjacent",
      author: (br ? left! : uses[0]!.work).authors,
      authorPrior: br ? priorBracket : priorAnchor,
      works: rankHypothesis(works, left && right ? { left: left.title, right: right.title, ordered: rowOrdered.get(rowKey) ?? false } : undefined),
      anchors: [...new Set(uses.flatMap((u) => u.from))],
    };
  };
  const hypotheses = [...runs.values()].filter((r) => !r.usable).map((r) => hypothesise(r.t.id, r.t.uses, r.t.rowKey));
  // Hidden-reader check: accepted spines in the evaluation photos with context of their own.
  const hidden: { imageId: string; kind: string; top1: boolean; top5: boolean }[] = [];
  const loroCtx: { id: string; imageId: string; uses: AnchorUse[]; accepted: WorkRef }[] = [];
  for (const [key, ids] of sd.rowIds) {
    const slots = ids.map((id) => sd.slots.get(id)!);
    slots.forEach((s, p) => {
      const accepted = s.accepted;
      if (!accepted || !inEval(s.id)) return;
      const workAt = (q: number) => (q === p ? null : slots[q]!.accepted);
      const ctx = contexts(ids.length, workAt, (q) => q === p || (!slots[q]!.accepted && !slots[q]!.copy)).get(p);
      if (!ctx) return;
      const uses = usesOf(ids, ctx, workAt);
      loroCtx.push({ id: s.id, imageId: s.imageId, uses, accepted });
      const h = hypothesise(s.id, uses, key);
      hidden.push({ imageId: s.imageId, kind: h.kind, top1: h.works[0] ? sameWork(sd.cat.work(h.works[0].workId), accepted) : false, top5: h.works.some((w) => sameWork(sd.cat.work(w.workId), accepted)) });
    });
  }

  // Leave one reader out.
  type View = { imageId: string; outcome: "recovered" | "wrong" | "abstain"; weak: boolean; stress: boolean; why: string | null };
  const views: View[] = [];
  for (const x of loroCtx) {
    const stress = x.uses.some((u) => sameAuthor(u.work, x.accepted));
    for (const r of readersOf(x.id)) {
      if (!rs.variants(x.id, r).length) continue;
      const run = runTarget(sd, rs, x.id, x.uses, [r]);
      const w = run.decision.workId ? sd.cat.work(run.decision.workId) : null;
      views.push({ imageId: x.imageId, outcome: !w ? "abstain" : sameWork(w, x.accepted) ? "recovered" : "wrong", weak: !sd.base.get(x.id)?.confirmed[r], stress, why: run.decision.why });
    }
  }
  log(`${set}: ${views.length} leave-one-reader-out views (${Math.round((Date.now() - t0) / 1000)} s)`);

  // Neighbour shuffle on the evaluation photos.
  const pool = [...sd.slots.values()].filter((s) => s.accepted).map((s) => ({ rowKey: s.rowKey, bucket: worksBucket(sd.cat.primaryAuthorWorks(s.accepted!.workId)), work: s.accepted! }));
  const evalTargets = targets.filter((t) => inEval(t.id));
  const realAccepts = evalTargets.filter((t) => runs.get(t.id)!.decision.basis).length;
  const shuffled: { seed: number; accepts: number; sameAuthorDraws: number; draws: number }[] = [];
  for (let s = 0; s < CONTEXT.shuffleSeeds; s++) {
    const rand = rng(CONTEXT.seed + s);
    let accepts = 0, same = 0, draws = 0;
    for (const t of evalTargets) {
      const swap = new Map<string, WorkRef>();
      const uses: AnchorUse[] = [];
      for (const u of t.uses) {
        const key = u.source === "bracket" ? `b:${u.from.join(",")}` : `a:${u.from[0]}`;
        if (!swap.has(key)) {
          const d = drawAnchor(pool, t.rowKey, worksBucket(sd.cat.primaryAuthorWorks(u.work.workId)), rand);
          if (!d) continue;
          draws++;
          if (sameAuthor(d.work, u.work)) same++;
          swap.set(key, d.work);
        }
        if (u.source === "bracket" && uses.some((x) => x.source === "bracket" && x.from.join() === u.from.join())) continue;
        uses.push({ ...u, work: swap.get(key)! });
      }
      if (runTarget(sd, rs, t.id, uses, readersOf(t.id)).decision.basis) accepts++;
    }
    shuffled.push({ seed: CONTEXT.seed + s, accepts, sameAuthorDraws: same, draws });
  }
  log(`${set}: shuffle done (${Math.round((Date.now() - t0) / 1000)} s)`);

  // Detection-gap flags inside brackets (any bracket in the set's rows).
  const brackets = new Map<string, { rowKey: string; l: number; r: number; author: string }>();
  for (const t of targets) for (const [l, r] of t.ctx.brackets) brackets.set(`${t.rowKey}:${l}:${r}`, { rowKey: t.rowKey, l, r, author: "" });
  const gaps = detectionGaps(sd, [...brackets.values()]);

  // Per-photo counts and the yardstick's judge.
  const truth = set === "yardstick" ? yardstickCopies() : null;
  const photos: PhotoCount[] = sd.photos.map((imageId) => {
    const ids = sd.dets.get(imageId)!.spines.flatMap((_, i) => (sd.books.get(imageId)![i] ? [`${imageId}:${i}`] : []));
    const acc = ids.map((id) => sd.base.get(id)?.accepted ?? null);
    const ctx = ids.map((id) => runs.get(id)?.decision.workId ?? null);
    const row: PhotoCount = {
      imageId,
      boxes: ids.length,
      confirmed: acc.filter(Boolean).length,
      byContext: ctx.filter(Boolean).length,
      byContextCopyArm: ids.filter((id) => copyRuns.get(id)?.decision.workId).length,
    };
    if (truth) {
      const t = truth.get(imageId) ?? new Map<string, number>();
      row.wrongBase = acc.filter((w) => w && !t.has(w)).length;
      row.wrongWith = row.wrongBase + ctx.filter((w) => w && !t.has(w)).length;
    }
    return row;
  });

  // Private per-box record: every case with its anchors, switchable off by basis.
  const dir = stage(set);
  writeFileSync(
    join(dir, "decisions.jsonl"),
    [...runs.values()].map((r) => JSON.stringify({ id: r.t.id, basis: r.decision.basis, workId: r.decision.workId, why: r.decision.why, readers: r.decision.readers, sources: r.sources, k: r.k, anchors: [...new Set(r.t.uses.flatMap((u) => u.from))], brackets: r.t.ctx.brackets.length, trials: r.decision.trials, usable: r.usable, f0Reason: sd.base.get(r.t.id)?.reason ?? null })).join("\n") + "\n",
  );
  writeFileSync(join(dir, "hypotheses.jsonl"), hypotheses.map((h) => JSON.stringify(h)).join("\n") + "\n");
  writeFileSync(join(dir, "detection-gaps.jsonl"), gaps.flags.map((f) => JSON.stringify(f)).join("\n") + (gaps.flags.length ? "\n" : ""));

  return summarise(sd, { runs, copyRuns, photos, views, shuffled, realAccepts, hypotheses, hidden, gaps, stripInfo, orderA, evalPhotos, inEval, seconds: (Date.now() - t0) / 1000 });
}

// --- aggregates ------------------------------------------------------------------------------------------------------

function count(xs: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
}

const kBucket = (k: number) => (k <= 10 ? "1-10" : k <= 30 ? "11-30" : k <= 60 ? "31-60" : "61+ (capped)");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarise(sd: SetData, x: any) {
  const { runs, copyRuns, photos, views, shuffled, realAccepts, hypotheses, hidden, gaps, stripInfo, orderA, evalPhotos, inEval } = x as {
    runs: Map<string, TargetRun & { t: { id: string } }>;
    copyRuns: Map<string, TargetRun>;
    photos: PhotoCount[];
    views: { imageId: string; outcome: string; weak: boolean; stress: boolean; why: string | null }[];
    shuffled: { seed: number; accepts: number; sameAuthorDraws: number; draws: number }[];
    realAccepts: number;
    hypotheses: { kind: string }[];
    hidden: { imageId: string; kind: string; top1: boolean; top5: boolean }[];
    gaps: { boxGaps: number; s1Front: number; bracketsWithFlag: number; flags: object[] };
    stripInfo: { strips: number; ordering: number; rows: StripRow[]; otherKindsWithStripWording: number };
    orderA: ReturnType<typeof orderStats>;
    evalPhotos: Set<string>;
    inEval: (id: string) => boolean;
  };
  const scope = (only: boolean) => {
    const rs = [...runs.values()].filter((r) => !only || inEval(r.t.id));
    const ps = photos.filter((p) => !only || evalPhotos.has(p.imageId));
    const acc = rs.filter((r) => r.decision.basis);
    const by = (k: keyof PhotoCount) => ps.map((p) => Number(p[k] ?? 0));
    const paired = (a: number[], b: number[]) => meanCI(b.map((v, i) => v - a[i]!));
    const copyAcc = [...copyRuns.entries()].filter(([id, r]) => r.decision.basis && (!only || inEval(id)));
    return {
      photos: ps.length,
      bookBoxes: ps.reduce((s, p) => s + p.boxes, 0),
      confirmedBase: ps.reduce((s, p) => s + p.confirmed, 0),
      targets: rs.length,
      targetsByF0Reason: count(rs.map((r) => sd.base.get(r.t.id)?.reason ?? "none")),
      targetsWithUsableText: rs.filter((r) => r.usable).length,
      targetsInBracket: rs.filter((r) => (r.t as unknown as { ctx: Context }).ctx.brackets.length > 0).length,
      confirmedByContext: acc.length,
      extraConfirmedPerPhoto: paired(by("confirmed"), ps.map((p) => p.confirmed + p.byContext)),
      extraConfirmedSharePts: triOf(clusterBootstrap(ps, (xs) => xs.reduce((s, p) => s + p.byContext, 0) / Math.max(1, xs.reduce((s, p) => s + p.boxes, 0)), REPS, SEED)),
      acceptsByF0Reason: count(acc.map((r) => sd.base.get(r.t.id)?.reason ?? "none")),
      acceptsBySource: count(acc.map((r) => r.sources.join("+"))),
      acceptsByK: count(acc.map((r) => kBucket(r.k))),
      acceptsByReaders: count(acc.map((r) => r.decision.readers.join("+"))),
      // Did a supporting reader already pass F-0's bar alone on this work (context as the second reader), or none (the
      // misread title context lets the reader's text reach)?
      acceptsReaderAtBar: count(acc.map((r) => (r.decision.readers.some((x) => sd.base.get(r.t.id)?.confirmed[x] === r.decision.workId) ? "a supporting reader at F-0's bar" : "no supporting reader at F-0's bar"))),
      outcomes: count(rs.filter((r) => r.usable).map((r) => r.decision.why ?? "confirmed-by-context")),
      counterWithdrawals: count(rs.flatMap((r) => r.decision.trials.flatMap((t) => (t.why?.startsWith("counter:") ? [t.why.slice(8)] : [])))),
      copyArm: { confirmedByContext: copyAcc.length, extraPerPhoto: paired(by("confirmed"), ps.map((p) => p.confirmed + p.byContextCopyArm)) },
    };
  };
  const loro = (vs: typeof views) => {
    const acc = vs.filter((v) => v.outcome !== "abstain");
    const wrong = acc.filter((v) => v.outcome === "wrong").length;
    const wi = wilson(wrong, acc.length);
    return {
      views: vs.length,
      accepted: acc.length,
      recovered: acc.length - wrong,
      wrong,
      abstained: vs.length - acc.length,
      recoveredShareOfViews: vs.length ? r4((acc.length - wrong) / vs.length) : null,
      wrongShareOfAccepts: acc.length ? r4(wrong / acc.length) : null,
      wrongWilson: wi ? [r4(wi[0]), r4(wi[1])] : null,
      abstainWhy: count(vs.filter((v) => v.outcome === "abstain").map((v) => v.why ?? "none")),
    };
  };
  const shuffleRatio = shuffled.map((s) => (realAccepts ? s.accepts / realAccepts : s.accepts > 0 ? Infinity : 0)).sort((a, b) => a - b);
  const yard =
    sd.set === "yardstick"
      ? {
          wrongAcceptsBase: photos.reduce((s, p) => s + p.wrongBase!, 0),
          wrongAcceptsWith: photos.reduce((s, p) => s + p.wrongWith!, 0),
          contextAccepts: photos.reduce((s, p) => s + p.byContext, 0),
          wrongPerImageDelta: meanCI(photos.map((p) => p.wrongWith! - p.wrongBase!)),
          wrongShareBase: wrongShare(photos, false),
          wrongShareWith: wrongShare(photos, true),
        }
      : null;
  const hid = (k?: string) => {
    const hs = hidden.filter((h) => !k || h.kind === k);
    return { n: hs.length, top1: triOf(clusterBootstrap(hs, rate((h) => h.top1), REPS, SEED)), top5: triOf(clusterBootstrap(hs, rate((h) => h.top5), REPS, SEED)) };
  };
  return {
    scope: SETS[sd.set].scope,
    evaluation: sd.half ? "half B (16 photos)" : "all photos",
    eval: scope(Boolean(sd.half)),
    all: sd.half ? scope(false) : null,
    shuffle: {
      realAccepts,
      seeds: shuffled.map((s) => s.accepts),
      meanAccepts: r4(shuffled.reduce((s, v) => s + v.accepts, 0) / shuffled.length),
      meanRatio: realAccepts ? r4(shuffled.reduce((s, v) => s + v.accepts, 0) / shuffled.length / realAccepts) : null,
      p95Ratio: shuffleRatio.length ? r4(quantile(shuffleRatio, 0.95)) : null,
      sameAuthorDrawShare: r4(shuffled.reduce((s, v) => s + v.sameAuthorDraws, 0) / Math.max(1, shuffled.reduce((s, v) => s + v.draws, 0))),
    },
    loro: { all: loro(views), weak: loro(views.filter((v) => v.weak)), stress: loro(views.filter((v) => v.stress)) },
    hypotheses: { total: hypotheses.length, byKind: count(hypotheses.map((h) => h.kind)), hiddenCheck: { all: hid(), bracket: hid("bracket"), adjacent: hid("adjacent") } },
    detectionGaps: { brackets: gaps.bracketsWithFlag, boxGaps: gaps.boxGaps, s1FrontOutlineGaps: gaps.s1Front },
    strips: { source: "f0f-shelf-strip", found: stripInfo.strips, statingOrder: stripInfo.ordering, rows: sd.rowIds.size, rowsLabelled: new Set(stripInfo.rows.map((r) => r.rowKey)).size, rowsSetOrdered: new Set(stripInfo.rows.filter((r) => r.ordering).map((r) => r.rowKey)).size, rowsWithGenre: new Set(stripInfo.rows.filter((r) => r.context.genre).map((r) => r.rowKey)).size, otherKindsWithStripWording: stripInfo.otherKindsWithStripWording },
    order: orderA,
    orderOther: sd.half ? orderStats(sd, sd.half.b, stripInfo.rows) : null,
    yardstick: yard,
    seconds: Math.round(x.seconds),
  };
}

function wrongShare(photos: PhotoCount[], withCtx: boolean): Tri {
  return triOf(
    clusterBootstrap(
      photos,
      (ps) => {
        const acc = ps.reduce((s, p) => s + p.confirmed + (withCtx ? p.byContext : 0), 0);
        return acc ? ps.reduce((s, p) => s + (withCtx ? p.wrongWith! : p.wrongBase!), 0) / acc : null;
      },
      REPS,
      SEED,
    ),
  );
}

/** The point estimate `a` sits inside interval `b`. */
const within = (a: Tri, b: Tri): boolean => a !== null && b !== null && a[0] >= b[1] && a[0] <= b[2];

function analyse(): void {
  const t0 = Date.now();
  const sets = Object.fromEntries(SET_NAMES.map((s) => [s, analyseSet(s)])) as Record<SetName, ReturnType<typeof analyseSet>>;
  const p = sets["pilot-000"];
  const y = sets.yardstick;
  const yd = y.yardstick!;
  const lift = p.eval.extraConfirmedPerPhoto;
  // Keep rule, pre-registered in evals/F0h/report.md before the first context decision.
  const k4 = (l: { accepted: number; wrongShareOfAccepts: number | null }) => l.accepted === 0 || (l.wrongShareOfAccepts ?? 0) <= KEEP.loroWrong;
  const keep = {
    k1PilotLift: lift !== null && lift[1] > 0,
    k2Shuffle: p.shuffle.meanRatio !== null && p.shuffle.meanRatio <= KEEP.shuffleMean && (p.shuffle.p95Ratio ?? Infinity) <= KEEP.shuffleP95,
    k3Yardstick: yd.wrongPerImageDelta !== null && yd.wrongPerImageDelta[1] <= 0 && within(yd.wrongShareWith, yd.wrongShareBase),
    k4Loro: k4(p.loro.all) && (p.loro.stress.accepted === 0 || (p.loro.stress.wrongShareOfAccepts ?? 0) <= KEEP.stressWrong),
    k4Vacuous: p.loro.all.accepted === 0,
  };
  const metrics = {
    card: "F-0h",
    run: "2026-11-03",
    note: "Aggregates only. pilot-000 is machine agreement, never accuracy (INV-17); the yardstick is PROXY (library shelves). Never pooled (OC35). No profile input (INV-13).",
    boxSet: "each set's default boxes (pilot-000: F-0e bands+strips; yardstick: F-0's B2 run) less F-0c's and F-0f's not-a-book boxes, as on main d37d2c0",
    context: CONTEXT,
    keepConstants: KEEP,
    sets,
    keep: { ...keep, ship: keep.k1PilotLift && keep.k2Shuffle && keep.k3Yardstick && keep.k4Loro },
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  const dir = join(REPO, "evals", "F0h");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  const reportPath = join(dir, "report.md");
  const report = readFileSync(reportPath, "utf8");
  const marker = "<!-- tables -->";
  const at = report.indexOf(marker);
  if (at < 0) throw new Error("report.md has no tables marker");
  writeFileSync(reportPath, report.slice(0, at + marker.length) + "\n" + tables(metrics));
  log(`analyse: ${metrics.seconds} s -> evals/F0h/`);
}

// --- report tables -----------------------------------------------------------------------------------------------------

const pc = (t: Tri | number | null, d = 1) => (t === null ? "–" : typeof t === "number" ? `${(t * 100).toFixed(d)} %` : `${(t[0] * 100).toFixed(d)} % (${(t[1] * 100).toFixed(d)}–${(t[2] * 100).toFixed(d)})`);
const num = (t: Tri, d = 2) => (t ? `${t[0].toFixed(d)} (${t[1].toFixed(d)} to ${t[2].toFixed(d)})` : "–");
const kv = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tables(m: any): string {
  const out: string[] = [];
  for (const set of SET_NAMES) {
    const s = m.sets[set];
    out.push(`### ${set === "pilot-000" ? "pilot-000 (real use): machine agreement, never accuracy" : "yardstick (PROXY, library shelves)"}\n`);
    for (const [label, e] of [[s.evaluation, s.eval], ["all photos (secondary)", s.all]] as const) {
      if (!e) continue;
      out.push(`**${label}:** ${e.photos} photos, ${e.bookBoxes} book boxes, ${e.confirmedBase} confirmed by F-0. Intervals: 95 % photo bootstrap.\n`);
      out.push("| measure | value |\n|---|---|");
      out.push(`| targets (unknown, not copy-confirmed, with an anchor or bracket) | ${e.targets} (${kv(e.targetsByF0Reason)}); usable text ${e.targetsWithUsableText}; in a bracket ${e.targetsInBracket} |`);
      out.push(`| **confirmed-by-context** | **${e.confirmedByContext}**; extra per photo **${num(e.extraConfirmedPerPhoto)}**; +${pc(e.extraConfirmedSharePts, 2).replace(/ %/g, "").replace(/^(\S+)/, "$1 pts")} of boxes |`);
      out.push(`| accepts by F-0 reason | ${kv(e.acceptsByF0Reason)} |`);
      out.push(`| accepts by source | ${kv(e.acceptsBySource)} |`);
      out.push(`| accepts by K (proposals before the cap) | ${kv(e.acceptsByK)} |`);
      out.push(`| accepts by supporting readers | ${kv(e.acceptsByReaders)} |`);
      out.push(`| accepts: supporting reader already at F-0's bar alone | ${kv(e.acceptsReaderAtBar)} |`);
      out.push(`| targets with usable text: outcome (first failing rule) | ${kv(e.outcomes)} |`);
      out.push(`| C-7 counter-evidence withdrawals (reader trials) | ${kv(e.counterWithdrawals)} |`);
      out.push(`| copy-anchor arm (confirmed-by-copy may anchor; not in the keep rule) | ${e.copyArm.confirmedByContext} accepts; extra per photo ${num(e.copyArm.extraPerPhoto)} |`);
      out.push("");
    }
    const sh = s.shuffle;
    const l = s.loro;
    out.push("| control | value |\n|---|---|");
    out.push(`| **neighbour shuffle** (${sh.seeds.length} seeds, ${s.evaluation}) | real ${sh.realAccepts}; shuffled mean ${sh.meanAccepts} (seeds ${sh.seeds.join(", ")}); ratio mean ${pc(sh.meanRatio)}, p95 seed ${pc(sh.p95Ratio)}; draws sharing the real anchor's author ${pc(sh.sameAuthorDrawShare)} |`);
    for (const [k, v] of [["**leave one reader out**", l.all], ["reader below F-0's bar alone", l.weak], ["same-author stress", l.stress]] as const)
      out.push(`| ${k} | ${v.views} views: recovered ${v.recovered}, wrong ${v.wrong}, abstained ${v.abstained}; wrong share of accepts ${pc(v.wrongShareOfAccepts)} (Wilson ${v.wrongWilson ? `${(v.wrongWilson[0] * 100).toFixed(1)}–${(v.wrongWilson[1] * 100).toFixed(1)} %` : "–"}); recovered share of views ${pc(v.recoveredShareOfViews)} |`);
    out.push(`| leave one reader out: why abstained | ${kv(l.all.abstainWhy)} |`);
    const h = s.hypotheses;
    out.push(`| hypotheses (no usable text) | ${h.total} (${kv(h.byKind)}) |`);
    out.push(`| hypothesis check: accepted spines, every reader hidden | ${h.hiddenCheck.all.n} spines: top-1 ${pc(h.hiddenCheck.all.top1)}, top-5 ${pc(h.hiddenCheck.all.top5)}; bracketed ${h.hiddenCheck.bracket.n}: top-1 ${pc(h.hiddenCheck.bracket.top1)}, top-5 ${pc(h.hiddenCheck.bracket.top5)} |`);
    out.push(`| detection-gap flags (inside brackets, for F-0k) | ${s.detectionGaps.brackets} brackets flagged; box gaps ≥ ${CONTEXT.gapWidths} widths ${s.detectionGaps.boxGaps}; S-1 front outline gaps ${s.detectionGaps.s1FrontOutlineGaps} |`);
    out.push(`| **row context from signage** (source: F-0f \`shelf-strip\` boxes; SC-1's baseline) | ${s.strips.found} strips, ${s.strips.statingOrder} stating an ordering; rows covered ${s.strips.rowsLabelled} of ${s.strips.rows} (ordering ${s.strips.rowsSetOrdered}, genre ${s.strips.rowsWithGenre}); other not-a-book boxes with strip wording, not read ${s.strips.otherKindsWithStripWording} |`);
    if (s.yardstick) {
      const y = s.yardstick;
      out.push(`| **yardstick wrong accepts** (accepted work not annotated in the image) | ${y.wrongAcceptsBase} → ${y.wrongAcceptsWith} (context accepts ${y.contextAccepts}); per image Δ ${num(y.wrongPerImageDelta)}; share of accepts ${pc(y.wrongShareBase)} → ${pc(y.wrongShareWith)} |`);
    }
    out.push(`| runtime | ${s.seconds} s (CPU) |\n`);
    for (const [label, o] of [[set === "pilot-000" ? "half A" : "all photos", s.order], ["half B (descriptive)", s.orderOther]] as const) {
      if (!o) continue;
      out.push(`**Order statistics, ${set}, ${label}** (F-0's confirmed spines in rows; label-free):\n`);
      out.push("| statistic | value |\n|---|---|");
      out.push(`| adjacent confirmed pairs | ${o.adjacentConfirmedPairs}; same work (copies) ${pc(o.adjacentSameWork)}; other work, same author ${pc(o.adjacentSameAuthorOtherWork)} |`);
      out.push(`| confirmed pairs ≤ 2 places apart, different works: same author | ${pc(o.withinTwoSameAuthor)} of ${o.withinTwoPairsOtherWork} |`);
      out.push(`| confirmed spine shares an author with a confirmed spine ≤ 2 places away (hypothesis prior, adjacent) | ${pc(o.anchorSameAuthorRate)} of ${o.anchorSameAuthorN} |`);
      out.push(`| bracket purity (between two same-author confirmed spines: same author; hypothesis prior, bracket) | ${pc(o.bracketPurity)} of ${o.bracketedN} |`);
      out.push(`| consecutive confirmed pairs in surname order (rows with ≥ ${CONTEXT.orderedMinPairs} pairs) | ${pc(o.inOrderShareCI)} of ${o.consecutivePairs} pairs in ${o.rowsScored} rows (random order: about 50 %); row median ${pc(o.rowConsistencyP50)} |`);
      out.push(`| rows ordered by author (≥ ${CONTEXT.orderedShare * 100} % in order) | ${o.rowsOrdered} of ${o.rowsScored} (${pc(o.rowsOrderedShare)}); rows with a break ${o.rowsWithBreak} |`);
      out.push(`| misfile candidates in ordered rows | ${o.misfileCandidates} (${pc(o.misfileShareOfConfirmedInOrderedRows)} of their confirmed spines) |`);
      out.push(`| rows labelled by a shelf strip | ${o.rowsWithStrip} |\n`);
    }
  }
  const k = m.keep;
  out.push(`### Keep rule\n\n| part | met |\n|---|---|`);
  out.push(`| K1 pilot-000 half B: extra confirmed boxes per photo, interval excluding 0 | ${k.k1PilotLift ? "yes" : "no"} |`);
  out.push(`| K2 shuffle: mean ≤ ${KEEP.shuffleMean * 100} % and p95 seed ≤ ${KEEP.shuffleP95 * 100} % of real accepts | ${k.k2Shuffle ? "yes" : "no"} |`);
  out.push(`| K3 yardstick wrong accepts do not rise beyond their interval | ${k.k3Yardstick ? "yes" : "no"} |`);
  out.push(`| K4 leave one reader out: wrong ≤ ${KEEP.loroWrong * 100} % of accepts, same-author stress ≤ ${KEEP.stressWrong * 100} % | ${k.k4Loro ? (k.k4Vacuous ? "yes (vacuous)" : "yes") : "no"} |`);
  out.push(`| **confirmed-by-context on** | **${k.ship ? "yes" : "no"}** |\n`);
  return out.join("\n") + "\n";
}

// --- stats and render ------------------------------------------------------------------------------------------------

/** C-7's statistics sidecar for the yardstick's inventory catalog (the default catalog's exists). */
function stats(): void {
  for (const set of SET_NAMES) {
    const cat = SETS[set].catalog;
    if (existsSync(statsPathFor(cat))) continue;
    const c = buildStats(cat, statsPathFor(cat), log);
    log(`${set}: sidecar built, ${c.works} works in ${c.seconds} s`);
  }
}

/** pilot-000 photos, the owner's example photos first (ids in the private examples-order.json), per-book mask fills. */
async function render(): Promise<void> {
  const sd = loadSet("pilot-000");
  const decisions = new Map(readJsonl<{ id: string; basis: string | null; workId: string | null; why: string | null; anchors: string[]; usable: boolean }>(join(stage("pilot-000"), "decisions.jsonl")).map((d) => [d.id, d]));
  const hyps = new Map(readJsonl<{ id: string; author: string[]; authorPrior: number | null; works: { title: string; share: number }[]; anchors: string[] }>(join(stage("pilot-000"), "hypotheses.jsonl")).map((h) => [h.id, h]));
  const gaps = readJsonl<{ kind: string; imageId: string; between: number[] }>(join(stage("pilot-000"), "detection-gaps.jsonl"));
  const paths = new Map(imagesOf("pilot-000").map((i) => [i.id, i.path]));
  const firstPath = join(PRIV, "examples-order.json");
  const first: { id: string; example: string }[] = existsSync(firstPath) ? (JSON.parse(readFileSync(firstPath, "utf8")) as { first: { id: string; example: string }[] }).first : [];
  const firstIds = first.map((f) => f.id);
  const ids = [...sd.photos].sort((a, b) => (firstIds.indexOf(a) + 1 || 999) - (firstIds.indexOf(b) + 1 || 999));
  const name = (w: WorkRef | null | undefined) => (w ? `${w.title} — ${w.authors.join(", ")}` : null);
  const lines = ids.map((id, n) => {
    const d = sd.dets.get(id)!;
    return JSON.stringify({
      n: n + 1,
      example: first.find((f) => f.id === id)?.example ?? null,
      half: sd.half!.a.has(id) ? "A" : "B",
      image: paths.get(id),
      spines: d.spines.map((s, i) => {
        const bid = `${id}:${i}`;
        const slot = sd.slots.get(bid);
        const dec = decisions.get(bid);
        const h = hyps.get(bid);
        const state = !sd.books.get(id)![i] ? "not-a-book" : slot?.accepted ? "anchor" : slot?.copy ? "copy" : dec?.basis ? "context" : h ? "hypothesis" : dec ? "tried" : "other";
        return {
          polygon: s.outline ?? s.polygon,
          state,
          work: name(slot?.accepted ?? slot?.copy ?? (dec?.workId ? sd.cat.work(dec.workId) : null) ?? null),
          why: dec?.why ?? null,
          anchors: dec?.anchors ?? h?.anchors ?? [],
          hypothesis: h ? { author: h.author.join(", "), prior: h.authorPrior, works: h.works.map((w) => `${w.title} (${Math.round(w.share * 100)} %)`) } : null,
        };
      }),
      gaps: gaps.filter((g) => g.imageId === id).map((g) => ({ kind: g.kind, between: g.between })),
    });
  });
  const spec = join(stage("pilot-000"), "render.jsonl");
  writeFileSync(spec, lines.join("\n") + "\n");
  const helper = join(REPO, "helpers", "label");
  const out = join(PRIV, "renders", "pilot-000");
  const args = ["run", "--project", helper, "python", "-I", join(helper, "render_f0h.py"), "--spec", spec, "--out", out, "--examples", join(ROOT, "private", "examples")];
  await new Promise<void>((resolve, reject) => spawn("uv", args, { stdio: ["ignore", "ignore", "inherit"] }).once("close", (c) => (c === 0 ? resolve() : reject(new Error(`render exited ${c}`)))));
  log("render written under the data root's private/f0h/renders/pilot-000/");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "stats") stats();
  else if (cmd === "analyse") analyse();
  else if (cmd === "render") await render();
  else {
    console.error("usage: node src/eval/f0h-cli.ts stats | analyse | render");
    process.exit(2);
  }
}
