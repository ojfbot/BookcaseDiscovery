// The reading profile (card R-1; docs/recommend/taste-model.md §2.3 and §3; INV-18, OC9, OC22, OC33).
//
// What we know of the reader, with provenance, kept apart from identity. Two kinds of record:
//   - entries: what the owner has said of an author, work, series or tag (relation + provenance);
//   - nodes: taste in terms of the vocabulary (a term on a facet, pulled toward or pushed away from).
//
// At run time the profile is the public `profile/seeds.json` plus an optional private overlay
// (`<data root>/private/profile-overlay.json`). The overlay can only add `inferred-interest` and
// `unknown` entries and nodes: it never changes or promotes a seed, and never reaches `read` or
// `liked` (INV-18). Nothing private is ever written to the seeds: `writeSeeds` refuses it, and the
// privacy guard (Z-1) catches what a hand edit gets past. The ChatGPT-export importer that would fill
// the overlay is post-MVP (OC22): this file ships the merge and the refusal rule, not the importer.
//
// `identify/` must not import this file (INV-13).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Vocabulary } from "./vocabulary.ts";

// ---- enums (values mirror contracts/profile.schema.json) ----

export const RELATIONS = ["read", "liked", "cooler", "not-for-me", "inferred-interest", "unknown"] as const;
export const SUBJECT_KINDS = ["author", "work", "series", "tag"] as const;
export const SCOPES = ["all-works", "one-work"] as const;
export const PROVENANCE_SOURCES = ["owner-statement", "owner-correction", "owner-preference", "taste-tree", "chatgpt-export", "selfco"] as const;
export const NODE_KINDS = ["theme", "subtheme", "topos", "idea", "question", "style", "pattern"] as const;
export const STANCES = ["pull", "push"] as const;
export const NODE_STATUSES = ["hypothesis", "asserted", "rejected"] as const;
export const EVIDENCE_KINDS = ["SYNTH", "ASSERTED"] as const;
export const SUPPORT_TYPES = ["seed", "asserted-event"] as const;

/** Sources that may appear in the public seeds: the owner's own words. Everything else is private (OC9). */
export const PUBLIC_SOURCES = ["owner-statement", "owner-correction", "owner-preference"] as const;
/** Relations that are owner statements. `inferred-interest` and `unknown` are never stated, so never public. */
export const STATED_RELATIONS = ["read", "liked", "cooler", "not-for-me"] as const;
/** The only relations an overlay entry may carry. Read and liked can only come from the owner (INV-18). */
export const OVERLAY_RELATIONS = ["inferred-interest", "unknown"] as const;

export type Relation = (typeof RELATIONS)[number];
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

// ---- shapes (contracts/profile.schema.json is the source of truth; test/profile.test.ts proves they agree) ----

const ID = /^[a-z0-9][a-z0-9._:-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TERM_ID = /^(theme|topos|idea|question|style|pattern|form|author):[a-z0-9]+(-[a-z0-9]+)*$/;

const IdSchema = z.string().regex(ID);
const TermIdSchema = z.string().regex(TERM_ID);

export const ProvenanceSchema = z.object({ source: z.enum(PROVENANCE_SOURCES), ref: z.string().min(1), date: z.string().regex(DATE) }).strict();

export const SubjectSchema = z
  .object({ kind: z.enum(SUBJECT_KINDS), name: z.string().min(1), id: z.string().min(1).optional() })
  .strict();

export const EntrySchema = z
  .object({
    id: IdSchema,
    subject: SubjectSchema,
    relation: z.enum(RELATIONS),
    scope: z.enum(SCOPES).optional(),
    expanded: z.literal(true).optional(),
    expandedFrom: IdSchema.optional(),
    provenance: ProvenanceSchema,
  })
  .strict();

export const SupportSchema = z.object({ type: z.enum(SUPPORT_TYPES), id: z.string().min(1) }).strict();

export const TermNodeSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(NODE_KINDS),
    termId: TermIdSchema,
    stance: z.enum(STANCES),
    status: z.enum(NODE_STATUSES),
    evidence: z.enum(EVIDENCE_KINDS),
    support: z.array(SupportSchema).min(1),
    qualifiers: z.array(z.string().min(1)),
    provenance: ProvenanceSchema,
  })
  .strict();

export const OpenQuestionSchema = z
  .object({
    id: IdSchema,
    kind: z.literal("open-question"),
    about: IdSchema,
    options: z.array(TermIdSchema).min(1),
    status: z.literal("open"),
    evidence: z.literal("SYNTH"),
    provenance: ProvenanceSchema,
  })
  .strict();

export const NodeSchema = z.union([TermNodeSchema, OpenQuestionSchema]);

export const ProfileFileSchema = z
  .object({ schemaVersion: z.literal(1), entries: z.array(EntrySchema), nodes: z.array(NodeSchema) })
  .strict();

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type Support = z.infer<typeof SupportSchema>;
export type TermNode = z.infer<typeof TermNodeSchema>;
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type ProfileFile = z.infer<typeof ProfileFileSchema>;

// ---- weights (taste-model.md §2.3 and §3; starting values for O-7, all configuration) ----

export interface SeedWeights {
  /** A liked author or work: an owner statement of liking. */
  liked: number;
  /** `read` with scope all-works. The owner confirms at O-4 whether "read all of Gibson" also means liked. */
  readAll: number;
  /** `read` of one work. */
  readOne: number;
}

export const DEFAULT_SEED_WEIGHTS: Readonly<SeedWeights> = { liked: 1.0, readAll: 0.6, readOne: 0.3 };

/**
 * A seed's weight in the centre of taste. `cooler` and `not-for-me` add nothing: we don't know why the
 * owner is cooler, and that reason is an open question with zero weight until answered. (`cooler` still
 * costs the author a score penalty in R-2, which reads `coolerAuthors`.) `inferred-interest` and
 * `unknown` add nothing either: inferred, not stated (INV-18).
 */
export function seedWeight(entry: Pick<Entry, "relation" | "scope">, w: SeedWeights = DEFAULT_SEED_WEIGHTS): number {
  switch (entry.relation) {
    case "liked":
      return w.liked;
    case "read":
      return entry.scope === "all-works" ? w.readAll : w.readOne;
    default:
      return 0;
  }
}

/** Node weights in the centre: asserted pull 1.0, hypothesis pull 0.5, rejected -1.0, open question 0. A push is the same weight, negated. */
export const NODE_WEIGHTS = { asserted: 1.0, hypothesis: 0.5, rejected: -1.0 } as const;

export function nodeWeight(node: Node): number {
  if (node.kind === "open-question") return 0;
  if (node.status === "rejected") return NODE_WEIGHTS.rejected;
  const w = node.status === "asserted" ? NODE_WEIGHTS.asserted : NODE_WEIGHTS.hypothesis;
  return node.stance === "push" ? -w : w;
}

// ---- the run-time profile ----

export type Origin = "seeds" | "overlay";
export type ResolvedEntry = Entry & { origin: Origin };
export type ResolvedNode = Node & { origin: Origin };

export type RefusalReason =
  | "relation-not-allowed-in-overlay"
  | "owner-source-in-overlay"
  | "expanded-in-overlay"
  | "id-collision"
  | "unknown-seed-reference";

export interface Refusal {
  where: "entry" | "node";
  id: string;
  reason: RefusalReason;
  detail: string;
}

/** Seeds plus overlay, with what the overlay was not allowed to say. */
export interface ResolvedProfile {
  entries: ResolvedEntry[];
  nodes: ResolvedNode[];
  refused: Refusal[];
}

export interface CentreSeed {
  id: string;
  subject: Subject;
  relation: Relation;
  scope: Entry["scope"];
  weight: number;
}

/** The seeds that build the centre: not expanded, weight above zero. Cooler and not-for-me are absent by construction. */
export function centreSeeds(profile: Pick<ResolvedProfile, "entries">, w: SeedWeights = DEFAULT_SEED_WEIGHTS): CentreSeed[] {
  return profile.entries
    .filter((e) => !e.expanded)
    .map((e) => ({ id: e.id, subject: e.subject, relation: e.relation, scope: e.scope, weight: seedWeight(e, w) }))
    .filter((s) => s.weight > 0);
}

/** Authors the owner is cooler on: a score penalty in R-2, nothing in the centre. */
export function coolerAuthors(profile: Pick<ResolvedProfile, "entries">): Subject[] {
  return profile.entries.filter((e) => !e.expanded && e.relation === "cooler" && e.subject.kind === "author").map((e) => e.subject);
}

// ---- semantic checks the schemas cannot express ----

const FACET_OF_KIND: Record<(typeof NODE_KINDS)[number], string> = {
  theme: "theme",
  subtheme: "theme",
  topos: "topos",
  idea: "idea",
  question: "question",
  style: "style",
  pattern: "pattern",
};

export interface CheckOptions {
  /** Ids a node's `seed` support may name. Default: the non-expanded entries of the file itself. */
  seedIds?: ReadonlySet<string>;
  /** When given, term ids must exist and a theme/subtheme must agree with its parent. */
  vocabulary?: Vocabulary;
}

/** Problems with a profile file beyond its shape. Empty when sound. */
export function checkProfileFile(file: ProfileFile, opts: CheckOptions = {}): string[] {
  const problems: string[] = [];
  const seedIds = opts.seedIds ?? new Set(file.entries.filter((e) => !e.expanded).map((e) => e.id));
  const seen = new Set<string>();
  for (const id of [...file.entries.map((e) => e.id), ...file.nodes.map((n) => n.id)]) {
    if (seen.has(id)) problems.push(`duplicate id "${id}"`);
    seen.add(id);
  }
  for (const e of file.entries) {
    if (e.expanded && !e.expandedFrom) problems.push(`entry "${e.id}": expanded without expandedFrom`);
    if (e.expandedFrom && !e.expanded) problems.push(`entry "${e.id}": expandedFrom without expanded: true`);
    if (e.expanded && e.subject.kind !== "work") problems.push(`entry "${e.id}": an expanded entry names one work`);
    if (e.scope === "all-works" && e.subject.kind !== "author" && e.subject.kind !== "series") problems.push(`entry "${e.id}": scope all-works needs an author or series`);
    if (e.scope === "one-work" && e.subject.kind !== "work") problems.push(`entry "${e.id}": scope one-work needs a work`);
    if (e.subject.id !== undefined && e.subject.kind !== "work") problems.push(`entry "${e.id}": only a work carries a catalog id`);
  }
  for (const n of file.nodes) {
    if (n.kind === "open-question") {
      if (!seedIds.has(n.about)) problems.push(`node "${n.id}": about "${n.about}" is not a seed`);
      for (const o of n.options) problems.push(...termProblems(n.id, o, opts.vocabulary));
      continue;
    }
    if (!TERM_ID.test(n.termId) || n.termId.split(":")[0] !== FACET_OF_KIND[n.kind]) problems.push(`node "${n.id}": kind ${n.kind} does not sit on ${n.termId}`);
    problems.push(...termProblems(n.id, n.termId, opts.vocabulary));
    if (opts.vocabulary && (n.kind === "theme" || n.kind === "subtheme")) {
      const term = opts.vocabulary.terms.find((t) => t.id === n.termId);
      if (term && n.kind === "theme" && term.parent) problems.push(`node "${n.id}": ${n.termId} has a parent, so it is a subtheme`);
      if (term && n.kind === "subtheme" && !term.parent) problems.push(`node "${n.id}": ${n.termId} has no parent, so it is a theme`);
    }
    for (const s of n.support) {
      if (s.type === "seed" && !seedIds.has(s.id)) problems.push(`node "${n.id}": support names seed "${s.id}", which is not a seed`);
      if (s.type === "asserted-event" && !ID.test(s.id)) problems.push(`node "${n.id}": support event id "${s.id}" is malformed`);
    }
  }
  return problems;
}

function termProblems(nodeId: string, termId: string, vocabulary: Vocabulary | undefined): string[] {
  return vocabulary && !vocabulary.terms.some((t) => t.id === termId) ? [`node "${nodeId}": ${termId} is not in the vocabulary`] : [];
}

// ---- the public seeds: what may be written ----

/** Things a public `ref` must never name: the private data folder, the vault, an export. */
const PRIVATE_REF = /selfco|chatgpt|conversations\.json|bookcase_data|\/private\/|^\/|^~|\.\.\//i;

function publicProvenanceProblems(where: string, p: Provenance): string[] {
  const problems: string[] = [];
  if (!(PUBLIC_SOURCES as readonly string[]).includes(p.source)) problems.push(`${where}: provenance source "${p.source}" is private, not an owner statement`);
  if (PRIVATE_REF.test(p.ref)) problems.push(`${where}: provenance ref looks like a private path or source`);
  return problems;
}

/**
 * Why this file may not be `profile/seeds.json`. The seeds are exactly what the owner stated (OC9, taste
 * tree ruling Q4): no entry from a ChatGPT export, SelfCo or the taste tree, no inferred or unknown
 * relation, nothing generated by expansion, no hypothesis, no open question, no SYNTH node. Empty when
 * publishable.
 */
export function publishProblems(file: ProfileFile, opts: CheckOptions = {}): string[] {
  const problems = checkProfileFile(file, opts);
  for (const e of file.entries) {
    if (!(STATED_RELATIONS as readonly string[]).includes(e.relation)) problems.push(`entry "${e.id}": relation "${e.relation}" is not an owner statement`);
    if (e.expanded) problems.push(`entry "${e.id}": expanded entries are generated at build time, not stored`);
    problems.push(...publicProvenanceProblems(`entry "${e.id}"`, e.provenance));
  }
  for (const n of file.nodes) {
    if (n.kind === "open-question") {
      problems.push(`node "${n.id}": an open question is not an owner statement`);
      continue;
    }
    if (n.evidence !== "ASSERTED") problems.push(`node "${n.id}": evidence ${n.evidence}; only what the owner stated (ASSERTED) is public`);
    if (n.status === "hypothesis") problems.push(`node "${n.id}": a hypothesis stays private until the owner states it`);
    problems.push(...publicProvenanceProblems(`node "${n.id}"`, n.provenance));
  }
  return problems;
}

export class SeedsRefusal extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`refusing to write the public seeds:\n  - ${problems.join("\n  - ")}`);
    this.name = "SeedsRefusal";
    this.problems = problems;
  }
}

/** Where the repo's public seeds are. */
export const SEEDS_PATH = fileURLToPath(new URL("../../profile/seeds.json", import.meta.url));

/**
 * The only writer of `profile/seeds.json`. It validates the shape, refuses anything that is not the
 * owner's own statement (throws `SeedsRefusal`, writes nothing) and replaces the file atomically.
 */
export function writeSeeds(file: ProfileFile, path: string = SEEDS_PATH, opts: CheckOptions = {}): void {
  const parsed = ProfileFileSchema.parse(file);
  const problems = publishProblems(parsed, opts);
  if (problems.length) throw new SeedsRefusal(problems);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.partial`;
  writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`);
  renameSync(tmp, path);
}

// ---- loading and the overlay merge ----

export function readProfileFile(path: string): ProfileFile {
  return ProfileFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Seeds plus overlay. The overlay is private and optional; a missing file is an empty overlay, a file
 * that does not parse is an error (not silently ignored). Seeds always win: an overlay entry never
 * replaces or edits a seed, and it can only add `inferred-interest` and `unknown` (INV-18). Whatever
 * the overlay says beyond that is refused and listed in `refused`, never coerced into something else.
 */
export function mergeOverlay(seeds: ProfileFile, overlay: ProfileFile | null): ResolvedProfile {
  const entries: ResolvedEntry[] = seeds.entries.map((e) => ({ ...e, origin: "seeds" as const }));
  const nodes: ResolvedNode[] = seeds.nodes.map((n) => ({ ...n, origin: "seeds" as const }));
  const refused: Refusal[] = [];
  if (!overlay) return { entries, nodes, refused };

  const taken = new Set([...entries.map((e) => e.id), ...nodes.map((n) => n.id)]);
  const seedIds = new Set(seeds.entries.filter((e) => !e.expanded).map((e) => e.id));
  const refuse = (where: Refusal["where"], id: string, reason: RefusalReason, detail: string) => refused.push({ where, id, reason, detail });

  for (const e of overlay.entries) {
    if (!(OVERLAY_RELATIONS as readonly string[]).includes(e.relation)) {
      refuse("entry", e.id, "relation-not-allowed-in-overlay", `an overlay entry cannot be "${e.relation}": only the owner can say read or liked`);
    } else if ((PUBLIC_SOURCES as readonly string[]).includes(e.provenance.source)) {
      refuse("entry", e.id, "owner-source-in-overlay", `provenance "${e.provenance.source}" belongs in profile/seeds.json, not the overlay`);
    } else if (e.expanded) {
      refuse("entry", e.id, "expanded-in-overlay", "expansion is generated from the seeds only");
    } else if (taken.has(e.id)) {
      refuse("entry", e.id, "id-collision", "the id is already used");
    } else {
      taken.add(e.id);
      entries.push({ ...e, origin: "overlay" });
    }
  }
  for (const n of overlay.nodes) {
    const missing = n.kind === "open-question" ? (seedIds.has(n.about) ? null : n.about) : (n.support.find((s) => s.type === "seed" && !seedIds.has(s.id))?.id ?? null);
    if (taken.has(n.id)) refuse("node", n.id, "id-collision", "the id is already used");
    else if (missing !== null) refuse("node", n.id, "unknown-seed-reference", `"${missing}" is not a seed in profile/seeds.json`);
    else {
      taken.add(n.id);
      nodes.push({ ...n, origin: "overlay" });
    }
  }
  return { entries, nodes, refused };
}

export interface ProfilePaths {
  seeds: string;
  /** `<data root>/private/profile-overlay.json`; may not exist. */
  overlay?: string;
}

/** The profile at run time, before expansion: `profile/seeds.json` plus the overlay if there is one. */
export function loadProfile(paths: ProfilePaths): ResolvedProfile {
  const seeds = readProfileFile(paths.seeds);
  const problems = checkProfileFile(seeds);
  if (problems.length) throw new Error(`${paths.seeds}: ${problems.join("; ")}`);
  const overlay = paths.overlay && existsSync(paths.overlay) ? readProfileFile(paths.overlay) : null;
  return mergeOverlay(seeds, overlay);
}
