// F-R2: write the yardstick's annotated works per image (Q-1's `yardstickTruth`) to a private JSON file, so the
// Python measurement can score accepts without re-implementing the inventory match. Never commit its output.
//
//   node scripts/fr2-truth.ts <data root>/private/fr2/yardstick-truth.json
import { writeFileSync } from "node:fs";
import { yardstickTruth } from "../src/eval/q1-cli.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: fr2-truth.ts <out.json>");
const truth = yardstickTruth();
writeFileSync(out, JSON.stringify(Object.fromEntries([...truth].map(([k, v]) => [k, [...v]]))));
console.log(`fr2-truth: ${truth.size} images`);
