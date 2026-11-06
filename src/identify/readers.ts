// The reader registry: the three models that read a spine's text for identify, each casting at most one vote (INV-6).
// It lives in identify, beside the vote that reads it (DL-4); `src/eval/f0.ts` re-exports it for F-0's callers.

export type ReaderName = "vision" | "ppocr" | "qwen";
export const READERS: ReaderName[] = ["vision", "ppocr", "qwen"];

/** The model folders each reader loads. Apple Vision is the OS's framework, not a folder, so `vision` names none. */
export const READER_MODELS: Record<ReaderName, readonly string[]> = { vision: [], ppocr: ["pp-ocrv5"], qwen: ["qwen3-vl-4b-8bit"] };
