// Zod validators for the ledger's events. The JSON Schemas in `contracts/` are the source of truth
// (OC13); this file is written by hand against them and `test/contracts.test.ts` proves the two
// agree on every example. Change a schema and its validator together, or that test fails.
import { z } from "zod";

// ---- enums (values mirror contracts/common.schema.json) ----

export const STATUSES = ["unresolved", "resolved", "paused", "needs-pixels"] as const;
export const BANDS = ["verified", "probable", "candidate", "unknown"] as const;
export const UNRESOLVED_REASONS = [
  "missing-pixels",
  "no-catalog-candidate",
  "conflicting-evidence",
  "strategies-exhausted",
] as const;
export const PHOTO_SETTINGS = ["whole-12", "whole-48", "shelf-48", "overview"] as const;
export const ROTATIONS = [0, 90, 180, 270] as const;

export const StatusSchema = z.enum(STATUSES);
export const BandSchema = z.enum(BANDS);
export const UnresolvedReasonSchema = z.enum(UNRESOLVED_REASONS);
export const PhotoSettingSchema = z.enum(PHOTO_SETTINGS);
export const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);

export type Status = z.infer<typeof StatusSchema>;
export type Band = z.infer<typeof BandSchema>;
export type UnresolvedReason = z.infer<typeof UnresolvedReasonSchema>;
export type PhotoSetting = z.infer<typeof PhotoSettingSchema>;
export type Rotation = z.infer<typeof RotationSchema>;

// ---- primitives (contracts/common.schema.json) ----

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const SeqSchema = z.number().int().min(1);
export const TimestampSchema = z.string().regex(TIMESTAMP);
export const IdSchema = z.string().min(1);
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const ConfidenceSchema = z.number().min(0).max(1);
export const PointSchema = z.tuple([z.number(), z.number()]);
export const PolygonSchema = z.tuple([PointSchema, PointSchema, PointSchema, PointSchema]);

export const DetectorVersionSchema = z.strictObject({
  backend: z.string().min(1),
  weightsSha256: Sha256Schema,
});
export const OcrVersionSchema = z.strictObject({
  helper: z.string().min(1),
  os: z.string().min(1),
  requestRevision: z.number().int().min(0),
});
export const RecommendationStateSchema = z.strictObject({
  workId: IdSchema,
  observationId: IdSchema,
  rank: z.number().int().min(1),
  band: z.enum(["verified", "probable", "candidate"]),
  lens: z.string().min(1),
  rationale: z.string().min(1),
});
export const HelperErrorSchema = z.strictObject({ code: z.string().min(1), message: z.string() });

export type Polygon = z.infer<typeof PolygonSchema>;
export type DetectorVersion = z.infer<typeof DetectorVersionSchema>;
export type OcrVersion = z.infer<typeof OcrVersionSchema>;
export type RecommendationState = z.infer<typeof RecommendationStateSchema>;

// ---- event payloads (contracts/events/<Type>.schema.json) ----

const EvidenceSchema = z.strictObject({
  kind: z.enum([
    "title-fragment",
    "author-fragment",
    "isbn",
    "series",
    "neighbour",
    "adjudication",
    "correction",
    "threshold",
  ]),
  score: z.number(),
  detail: z.string().optional(),
});

const CandidateSchema = z.strictObject({
  workId: IdSchema,
  editionId: IdSchema.optional(),
  title: z.string().min(1),
  author: z.string().min(1),
  year: z.number().int().optional(),
  series: z.string().min(1).optional(),
  score: z.number(),
  evidence: z.array(EvidenceSchema).min(1),
});

export const payloadSchemas = {
  ScanSessionOpened: z.strictObject({
    sessionId: IdSchema,
    minPixels: z.number().int().min(1),
  }),
  ImageAssetIngested: z.strictObject({
    sessionId: IdSchema,
    imageHash: Sha256Schema,
    workingCopyHash: Sha256Schema,
    format: z.enum(["heic", "jpeg"]),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    setting: PhotoSettingSchema,
    capturedAt: TimestampSchema,
    shelfIndex: z.number().int().min(0).optional(),
    flags: z.array(z.enum(["edited-derivative"])).optional(),
  }),
  ImageRejected: z.strictObject({
    sessionId: IdSchema,
    fileName: z.string().min(1),
    fileHash: Sha256Schema.optional(),
    reasons: z
      .array(z.enum(["below-min-resolution", "no-exif", "unsupported-format", "zero-byte", "icloud-placeholder"]))
      .min(1),
  }),
  SpineObserved: z.strictObject({
    observationId: IdSchema,
    sessionId: IdSchema,
    imageHash: Sha256Schema,
    setting: PhotoSettingSchema,
    polygon: PolygonSchema,
    score: ConfidenceSchema,
    shelf: z.number().int().min(0),
    ordinal: z.number().int().min(0),
    detector: DetectorVersionSchema,
  }),
  TextObserved: z.strictObject({
    observationId: IdSchema,
    rotation: RotationSchema,
    langCorrection: z.boolean(),
    text: z.string(),
    confidence: ConfidenceSchema,
    ocr: OcrVersionSchema,
  }),
  HypothesesProposed: z.strictObject({
    observationId: IdSchema,
    candidates: z.array(CandidateSchema),
    unknown: z.strictObject({ score: z.number(), evidence: z.array(EvidenceSchema) }),
  }),
  AdjudicationRecorded: z.strictObject({
    observationId: IdSchema,
    model: z.string().min(1),
    cropHash: Sha256Schema,
    candidateSetHash: Sha256Schema,
    choice: IdSchema.nullable(),
    readText: z.string().optional(),
    cached: z.boolean(),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
  }),
  BandAssigned: z.discriminatedUnion("band", [
    z.strictObject({ observationId: IdSchema, band: z.literal("unknown"), reason: UnresolvedReasonSchema }),
    z.strictObject({
      observationId: IdSchema,
      band: z.enum(["verified", "probable", "candidate"]),
      workId: IdSchema,
    }),
  ]),
  StatusChanged: z.strictObject({
    observationId: IdSchema,
    from: StatusSchema.nullable(),
    to: StatusSchema,
  }),
  WorkItemOpened: z.strictObject({
    workItemId: IdSchema,
    kind: z.literal("closer-photo"),
    observationId: IdSchema,
    shelf: z.number().int().min(0),
    ordinal: z.number().int().min(0),
    reason: UnresolvedReasonSchema,
  }),
  WorkItemClosed: z.strictObject({
    workItemId: IdSchema,
    resolution: z.enum(["fulfilled", "withdrawn"]),
  }),
  IdentityCorrected: z.strictObject({
    observationId: IdSchema,
    correction: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("is"), workId: IdSchema }),
      z.strictObject({ kind: z.literal("not"), workId: IdSchema }),
      z.strictObject({ kind: z.literal("unreadable") }),
    ]),
  }),
  PreferenceRecorded: z.strictObject({
    workId: IdSchema,
    preference: z.enum(["more", "less", "not-for-me", "already-read"]),
  }),
  RecommendationIssued: z.strictObject({
    recommendationId: IdSchema,
    rankingVersion: z.string().min(1),
    recommendation: RecommendationStateSchema,
  }),
  RecommendationRevised: z.strictObject({
    recommendationId: IdSchema,
    rankingVersion: z.string().min(1),
    recommendation: RecommendationStateSchema,
    previous: RecommendationStateSchema,
    reasonEventSeqs: z.array(SeqSchema).min(1),
  }),
  RunStarted: z.strictObject({
    codeCommit: z.string().regex(/^[0-9a-f]{7,40}(-dirty)?$/),
    helperVersions: z.record(z.string(), z.string().min(1)),
    modelIds: z.array(z.string().min(1)),
    budget: z.strictObject({
      maxAdjudications: z.number().int().min(0).optional(),
      maxTokens: z.number().int().min(0).optional(),
      maxSpendUsd: z.number().min(0).optional(),
    }),
  }),
  RunFinished: z.strictObject({
    outcome: z.enum(["completed", "paused", "failed"]),
    usage: z.strictObject({
      adjudications: z.number().int().min(0),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      spendUsd: z.number().min(0).optional(),
    }),
  }),
} as const;

export type EventType = keyof typeof payloadSchemas;
export const EVENT_TYPES = Object.keys(payloadSchemas) as EventType[];

export type Payload<T extends EventType> = z.infer<(typeof payloadSchemas)[T]>;

// ---- the envelope ----

const envelope = {
  ts: TimestampSchema,
  runId: IdSchema,
};

type Variant<T extends EventType> = { type: T; ts: string; runId: string; payload: Payload<T> };

/** An event not yet in the ledger: no `seq`. */
export type NewEvent = { [T in EventType]: Variant<T> }[EventType];
/** An event as stored: the ledger has assigned `seq`. */
export type LedgerEvent = NewEvent & { seq: number };

function variant<T extends EventType>(type: T) {
  return z.strictObject({
    seq: SeqSchema.optional(),
    type: z.literal(type),
    ...envelope,
    payload: payloadSchemas[type],
  });
}

const variants = EVENT_TYPES.map((t) => variant(t));

/** Validates any event, with or without `seq`. */
export const EventSchema = z.discriminatedUnion(
  "type",
  variants as unknown as [(typeof variants)[number], ...(typeof variants)[number][]],
);

/** Parse and return a typed event; throws a ZodError on a contract violation. */
export function parseEvent(input: unknown): NewEvent | LedgerEvent {
  return EventSchema.parse(input) as unknown as NewEvent | LedgerEvent;
}
