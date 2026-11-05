// The shared lookup cache for live catalog calls (card C-10).
//
//   normalized key -> fresh entry? -> (budget left?) -> rate-limited call -> entry with an outcome and an expiry
//
// C-4's `LiveCache` keyed responses on the exact query URL, never expired, cached failures forever and had no
// limit on calls. This cache keys on a **normalized query** (the caller's `keyOf`, built from the query's title
// tokens and author surname), so reader variants of one spine share an entry; keeps positive entries, expires
// no-match and failed entries; holds a per-run call **budget**; and records every key a run asked for, so a plan
// step can say how many calls a run would make without making them. Version-1 (C-4) files are migrated into the
// version-2 store on first open and left in place. Entries hold query text and records: data root only.
// Design and results: evals/C10/prereg.md, evals/C10/report.md.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Source = "openlibrary" | "loc";
export const SOURCES: readonly Source[] = ["openlibrary", "loc"];

const DAY = 24 * 3600 * 1000;

/** Pre-registered constants (evals/C10/prereg.md). Changing one after the real-data run is a new run. */
export const LOOKUP = {
  /** C-4's URL-keyed files are version 1. */
  schema: 2,
  /** How long an entry is trusted before it is asked again. Positive entries never expire. */
  ttlMs: { "no-match": 30 * DAY, failed: 7 * DAY } as Record<Exclude<Outcome, "match">, number>,
  /** Live requests (retries included) one CLI run may make. */
  defaultBudget: 100,
  /** Works per local catalog tried as records. */
  localTopK: 10,
  /** Batching gate: attribution recall at least this, cross-attribution at most that (prereg § Batching). */
  attribution: { minRecall: 0.99, maxCross: 0.01 },
} as const;

/** Identifies the app; no email address (C-4's card brief), so Open Library's 1 request/s unidentified rate applies. */
export const USER_AGENT = "BookcaseDiscovery/0.0 (catalog coverage measurement, card C-4; +https://github.com/ojfbot/BookcaseDiscovery)";
/** Minimum spacing between calls: Open Library at most 1/s, LoC at most 10/min, each with a margin. */
export const SPACING_MS: Record<Source, number> = { openlibrary: 1100, loc: 6500 };

export type Outcome = "match" | "no-match" | "failed";

export interface CacheEntry {
  schema: number;
  key: string;
  source: Source;
  /** The URL that was called (private, data root only). */
  url: string;
  /** Other URLs answered by this entry: version-1 files that shared its key. */
  legacyUrls: string[];
  status: number;
  outcome: Outcome;
  fetchedAt: string;
  body: string | null;
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;

export interface LookupOptions {
  /** The normalized key of a query, from its URL. Two URLs with one key share an entry. */
  keyOf: (source: Source, url: string) => string;
  /** Record ids in a response body (top first), for the outcome and for migration's collision count. */
  recordIds: (source: Source, body: string) => string[];
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** C-4's meaning: a key with no entry at all is an error, never a call. A stale entry is served. */
  offline?: boolean;
  /** Live requests this cache may make (retries included). Default: no limit. */
  budget?: number;
  /** Make no call: record each key that would be called (the plan step). */
  plan?: boolean;
}

/** Where an answer came from. `planned`: plan mode, a call would be made. `skipped`: the budget was spent. */
export type From = "cache" | "stale" | "live" | "planned" | "skipped";

export interface Answer {
  body: string | null;
  from: From;
  key: string;
}

export interface MigrationReport {
  /** Version-1 files read, per source. */
  files: Record<Source, number>;
  /** Version-2 entries written (distinct keys). */
  keys: Record<Source, number>;
  /** Keys that more than one version-1 file mapped to, and those whose top-10 record ids differ. */
  collisions: Record<Source, number>;
  collisionsDiffering: Record<Source, number>;
}

const zero = (): Record<Source, number> => ({ openlibrary: 0, loc: 0 });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export class LookupCache {
  /** Live requests made (retries included). */
  calls = zero();
  /** Distinct keys answered from a fresh entry / served stale / called / planned / skipped, per source. */
  readonly keys: Record<From, Record<Source, Set<string>>> = {
    cache: { openlibrary: new Set(), loc: new Set() },
    stale: { openlibrary: new Set(), loc: new Set() },
    live: { openlibrary: new Set(), loc: new Set() },
    planned: { openlibrary: new Set(), loc: new Set() },
    skipped: { openlibrary: new Set(), loc: new Set() },
  };
  /** Answers given, per source (a key asked twice counts twice): C-4's `cacheHits`, plus served-stale. */
  hits = zero();
  /** Failed answers given (HTTP error on every try, cached or live). */
  errors = zero();
  readonly dir: string;
  readonly migration: MigrationReport | null;
  private last: Record<Source, number> = { openlibrary: -Infinity, loc: -Infinity };
  private readonly mem = new Map<string, CacheEntry>();
  private readonly opts: LookupOptions;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  /** `root` is C-4's cache directory (`catalog/coverage/`); the version-2 store is its `v2/`. */
  constructor(root: string, opts: LookupOptions) {
    this.dir = join(root, "v2");
    this.opts = opts;
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => Date.now());
    this.migration = existsSync(join(this.dir, "meta.json")) ? null : migrate(root, opts);
  }

  get budgetLeft(): number {
    const used = this.calls.openlibrary + this.calls.loc;
    return (this.opts.budget ?? Infinity) - used;
  }

  path(source: Source, key: string): string {
    return join(this.dir, source, `${sha(key)}.json`);
  }

  private read(source: Source, key: string): CacheEntry | null {
    const m = this.mem.get(`${source}|${key}`);
    if (m) return m;
    const p = this.path(source, key);
    if (!existsSync(p)) return null;
    const e = JSON.parse(readFileSync(p, "utf8")) as CacheEntry;
    this.mem.set(`${source}|${key}`, e);
    return e;
  }

  fresh(e: CacheEntry): boolean {
    if (e.outcome === "match") return true;
    return this.now() - Date.parse(e.fetchedAt) < LOOKUP.ttlMs[e.outcome];
  }

  /** The state of a query's entry, without counting or calling. */
  peek(source: Source, url: string): { key: string; state: "fresh" | "stale" | "missing"; entry: CacheEntry | null } {
    const key = this.opts.keyOf(source, url);
    const entry = this.read(source, key);
    return { key, entry, state: !entry ? "missing" : this.fresh(entry) ? "fresh" : "stale" };
  }

  private answer(source: Source, key: string, from: From, body: string | null): Answer {
    this.keys[from][source].add(key);
    if (from === "cache" || from === "stale") this.hits[source]++;
    return { body, from, key };
  }

  /**
   * The response body for a query: a fresh entry, else a live call (rate-limited, three tries, within the
   * budget), else a stale entry when no call may be made. An HTTP error on every try is cached as `failed`
   * (some queries make Open Library answer 500 every time); a network error is not cached.
   */
  async get(source: Source, url: string): Promise<Answer> {
    const { key, state, entry } = this.peek(source, url);
    if (state === "fresh") {
      if (entry!.outcome === "failed") this.errors[source]++;
      return this.answer(source, key, "cache", entry!.body);
    }
    const serveStale = () => {
      if (entry!.outcome === "failed") this.errors[source]++;
      return this.answer(source, key, "stale", entry!.body);
    };
    if (this.opts.plan) return this.answer(source, key, "planned", null);
    if (this.opts.offline) {
      if (entry) return serveStale();
      throw new Error(`offline: no cached ${source} response for a query (cache key ${sha(key).slice(0, 16)})`);
    }
    if (this.budgetLeft < 1) return entry ? serveStale() : this.answer(source, key, "skipped", null);
    let status: number | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (this.budgetLeft < 1) return entry ? serveStale() : this.answer(source, key, "skipped", null);
      status = null;
      const wait = this.last[source] + SPACING_MS[source] - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last[source] = this.now();
      this.calls[source]++;
      try {
        const res = await this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: source === "loc" ? "application/xml" : "application/json" } });
        status = res.status;
        if (res.status === 200) {
          const body = await res.text();
          this.write({ schema: LOOKUP.schema, key, source, url, legacyUrls: entry?.legacyUrls ?? [], status: 200, outcome: this.opts.recordIds(source, body).length > 0 ? "match" : "no-match", fetchedAt: new Date(this.now()).toISOString(), body });
          return this.answer(source, key, "live", body);
        }
        if (res.status !== 429 && res.status < 500) break;
      } catch {
        // network error: retry
      }
      await this.sleep(attempt * (source === "loc" ? 30000 : 10000));
    }
    this.errors[source]++;
    if (status !== null) this.write({ schema: LOOKUP.schema, key, source, url, legacyUrls: entry?.legacyUrls ?? [], status, outcome: "failed", fetchedAt: new Date(this.now()).toISOString(), body: null });
    return this.answer(source, key, "live", null);
  }

  private write(e: CacheEntry): void {
    mkdirSync(join(this.dir, e.source), { recursive: true });
    writeFileSync(this.path(e.source, e.key), JSON.stringify(e));
    this.mem.set(`${e.source}|${e.key}`, e);
  }

  /** Counts of distinct keys by where they were answered (no key text). */
  summary(): Record<From, Record<Source, number>> {
    const out = {} as Record<From, Record<Source, number>>;
    for (const [from, by] of Object.entries(this.keys) as [From, Record<Source, Set<string>>][]) out[from] = { openlibrary: by.openlibrary.size, loc: by.loc.size };
    return out;
  }
}

/**
 * Version-1 store (C-4: `<root>/<source>/<sha256(url)>.json`, `{ url, status, fetchedAt, body }`) into
 * version 2 under normalized keys. The version-1 files are read, never changed or removed. When several share
 * a key, the positive one wins, then the earliest fetched; the others' URLs are kept on the entry.
 */
export function migrate(root: string, opts: Pick<LookupOptions, "keyOf" | "recordIds">, now = () => Date.now()): MigrationReport {
  const report: MigrationReport = { files: zero(), keys: zero(), collisions: zero(), collisionsDiffering: zero() };
  const dir = join(root, "v2");
  for (const source of SOURCES) {
    const v1 = join(root, source);
    if (!existsSync(v1)) continue;
    const byKey = new Map<string, { url: string; status: number; fetchedAt: string; body: string | null; ids: string[] }[]>();
    for (const f of readdirSync(v1).filter((n) => n.endsWith(".json")).sort()) {
      const c = JSON.parse(readFileSync(join(v1, f), "utf8")) as { url: string; status: number; fetchedAt: string; body: string | null };
      report.files[source]++;
      const key = opts.keyOf(source, c.url);
      const ids = c.body === null ? [] : opts.recordIds(source, c.body);
      byKey.set(key, [...(byKey.get(key) ?? []), { ...c, ids }]);
    }
    mkdirSync(join(dir, source), { recursive: true });
    for (const [key, all] of byKey) {
      const ranked = [...all].sort((a, b) => Number(b.ids.length > 0) - Number(a.ids.length > 0) || a.fetchedAt.localeCompare(b.fetchedAt) || a.url.localeCompare(b.url));
      const win = ranked[0]!;
      if (all.length > 1) {
        report.collisions[source]++;
        const top = (ids: string[]) => ids.slice(0, 10).join("\n");
        if (all.some((e) => e.body === null || top(e.ids) !== top(win.ids))) report.collisionsDiffering[source]++;
      }
      const outcome: Outcome = win.body === null ? "failed" : win.ids.length > 0 ? "match" : "no-match";
      const entry: CacheEntry = { schema: LOOKUP.schema, key, source, url: win.url, legacyUrls: ranked.slice(1).map((e) => e.url), status: win.status, outcome, fetchedAt: win.fetchedAt, body: win.body };
      writeFileSync(join(dir, source, `${sha(key)}.json`), JSON.stringify(entry));
      report.keys[source]++;
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify({ schema: LOOKUP.schema, migratedFrom: 1, migratedAt: new Date(now()).toISOString(), report }, null, 2)}\n`);
  return report;
}

/**
 * Records already resolved for a copy group or a work, in this run or an earlier one (persisted beside the
 * cache as `v2/known.json`). A known record is evidence to try against another copy's own reads, never a
 * merge of copies (INV-4).
 */
export class KnownIndex<T> {
  private byCopy = new Map<string, T>();
  private byWork = new Map<string, T>();
  readonly path: string | null;

  constructor(path: string | null = null) {
    this.path = path;
    if (path && existsSync(path)) {
      const j = JSON.parse(readFileSync(path, "utf8")) as { schema: number; byCopy: Record<string, T>; byWork: Record<string, T> };
      if (j.schema === LOOKUP.schema) {
        this.byCopy = new Map(Object.entries(j.byCopy));
        this.byWork = new Map(Object.entries(j.byWork));
      }
    }
  }

  /** Records for a box's copy group and its work, the copy group's first. */
  recordsFor(copy: string | null, work: string | null): T[] {
    const out: T[] = [];
    if (copy && this.byCopy.has(copy)) out.push(this.byCopy.get(copy)!);
    if (work && this.byWork.has(work) && !out.includes(this.byWork.get(work)!)) out.push(this.byWork.get(work)!);
    return out;
  }

  has(copy: string | null, work: string | null): boolean {
    return (copy !== null && this.byCopy.has(copy)) || (work !== null && this.byWork.has(work));
  }

  /** The first record resolved for a copy group or work is kept; a later one does not replace it. */
  add(copy: string | null, work: string | null, rec: T): void {
    if (copy && !this.byCopy.has(copy)) this.byCopy.set(copy, rec);
    if (work && !this.byWork.has(work)) this.byWork.set(work, rec);
  }

  get size(): { copies: number; works: number } {
    return { copies: this.byCopy.size, works: this.byWork.size };
  }

  save(): void {
    if (!this.path) return;
    writeFileSync(this.path, JSON.stringify({ schema: LOOKUP.schema, byCopy: Object.fromEntries(this.byCopy), byWork: Object.fromEntries(this.byWork) }));
  }
}

/** A copy group's key: its member box ids, sorted and hashed, so renumbering groups cannot point it elsewhere. */
export function copyKey(memberIds: string[]): string {
  return `copy:${sha([...memberIds].sort().join("\n")).slice(0, 24)}`;
}
