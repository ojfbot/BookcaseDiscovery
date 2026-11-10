// What a spine reader produced and why a spine stays unknown: plain record types shared by identify (which writes and
// votes on them), the catalog's coverage lookup and the harnesses (DL-4b). Types only; no module imports from here
// upward, so catalog can use them without importing identify (identify already imports catalog).
// `src/identify/readers.ts`, `src/identify/decision.ts` and `src/eval/f0.ts` re-export them.

export type ReaderName = "vision" | "ppocr" | "qwen";

export type UnknownReason = "no-text" | "no-catalog-match" | "single-reader" | "readers-disagree";

export interface ReadVariant {
  rotation: number;
  text: string;
  confidence: number;
}

export interface Reading {
  id: string;
  reader: ReaderName;
  /** Crop method provenance (`cropName`); absent on F-0's original records. */
  crop?: string;
  variants: ReadVariant[];
  seconds: number;
  error?: string;
}
