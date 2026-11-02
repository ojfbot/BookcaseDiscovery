// Kept only so `src/catalog/isfdb-import.ts` (C-3's area) still resolves `dataRoot`. The one image store is
// `src/ledger/images.ts`; repoint that import and delete this file when C-3 has merged.
export { dataRoot } from "../ledger/images.ts";
