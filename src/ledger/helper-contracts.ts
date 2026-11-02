// Zod validators for the helper JSON Lines contracts in `contracts/helpers/`. Same rule as
// `contracts.ts`: the JSON Schemas are the source of truth, and a test proves these agree.
import { z } from "zod";
import {
  ConfidenceSchema,
  DetectorVersionSchema,
  HelperErrorSchema,
  IdSchema,
  OcrVersionSchema,
  PolygonSchema,
  RotationSchema,
} from "./contracts.ts";

export const DetectRequestSchema = z.strictObject({ id: IdSchema, image: z.string().min(1) });

export const DetectResponseSchema = z.union([
  z.strictObject({
    id: IdSchema,
    image: z.strictObject({ width: z.number().int().min(1), height: z.number().int().min(1) }),
    detections: z.array(z.strictObject({ polygon: PolygonSchema, score: ConfidenceSchema })),
    version: DetectorVersionSchema,
  }),
  z.strictObject({ id: IdSchema, error: HelperErrorSchema }),
]);

export const OcrRequestSchema = z.strictObject({
  id: IdSchema,
  image: z.string().min(1),
  polygon: PolygonSchema,
  rotations: z.array(RotationSchema).min(1),
});

export const OcrResponseSchema = z.union([
  z.strictObject({
    id: IdSchema,
    variants: z.array(
      z.strictObject({
        rotation: RotationSchema,
        langCorrection: z.boolean(),
        text: z.string(),
        confidence: ConfidenceSchema,
      }),
    ),
    version: OcrVersionSchema,
  }),
  z.strictObject({ id: IdSchema, error: HelperErrorSchema }),
]);

export type DetectRequest = z.infer<typeof DetectRequestSchema>;
export type DetectResponse = z.infer<typeof DetectResponseSchema>;
export type OcrRequest = z.infer<typeof OcrRequestSchema>;
export type OcrResponse = z.infer<typeof OcrResponseSchema>;

/** Helper name (the schema file stem under `contracts/helpers/`) to its validator. */
export const helperSchemas = {
  "detect-request": DetectRequestSchema,
  "detect-response": DetectResponseSchema,
  "ocr-request": OcrRequestSchema,
  "ocr-response": OcrResponseSchema,
} as const;
export type HelperContract = keyof typeof helperSchemas;
