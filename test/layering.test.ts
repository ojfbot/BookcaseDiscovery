// DL-4 · module layering. The allowed import direction, enforced here so it cannot invert again:
//
//   src/eval/, src/run/  ──may import──▶  anything
//   src/identify/, src/perceive/, src/recommend/, src/capture/, src/ledger/, src/catalog/, src/shared/  ──never──▶  src/eval/, src/run/
//   src/catalog/  ──never──▶  src/identify/   (catalog sits below identify; what both need lives in src/shared/)
//
// The pipeline's modules are what production runs; `src/eval/` (the harnesses) and `src/run/` (the CLI) sit on top of
// them. Static, type-only, re-export, side-effect and dynamic imports all count. `KNOWN` lists imports that may stay
// for a stated reason; DL-4b emptied it (26 crossings that predated DL-4: the catalog and identify evaluation runners
// moved to src/eval/, and coverage.ts's types and helpers moved to src/shared/). It may only shrink: a listed import
// that is gone fails until its line is removed.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const GUARDED = ["identify", "perceive", "recommend", "capture", "ledger", "catalog", "shared"];
const TOP = ["eval", "run"];

/** `<importing file> -> <imported file>`, repo-relative. */
const KNOWN = new Set<string>([]);

/** Every module specifier a TypeScript source names: `import`/`export ... from`, `import "x"` and `import("x")`. */
export function specifiers(src: string): string[] {
  const code = src.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
  const out: string[] = [];
  for (const m of code.matchAll(/(?:^|[\n;])\s*(?:import|export)\b[^"';]*?\bfrom\s*["']([^"']+)["']/g)) out.push(m[1]!);
  for (const m of code.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g)) out.push(m[1]!);
  for (const m of code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

const tsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));

const rel = (abs: string): string => relative(REPO, abs).split(sep).join("/");
const layerOf = (file: string): string | undefined => rel(file).match(/^src\/([^/]+)\//)?.[1];

/** Imports from a guarded module into `src/eval/` or `src/run/`, as `KNOWN` writes them. */
function violations(): string[] {
  const out: string[] = [];
  for (const file of tsFiles(join(REPO, "src"))) {
    if (!GUARDED.includes(layerOf(file) ?? "")) continue;
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec);
      if (TOP.includes(layerOf(target) ?? "")) out.push(`${rel(file)} -> ${rel(target)}`);
    }
  }
  return [...new Set(out)].sort();
}

describe("module layering (DL-4): the pipeline never imports the harnesses or the CLI", () => {
  it("reads every kind of import", () => {
    const src = [
      `import { a } from "./a.ts";`,
      `import type { B } from '../eval/b.ts';`,
      `import {\n  c,\n  type D,\n} from "../eval/c.ts";`,
      `export { e } from "../run/e.ts";`,
      `export * from "./f.ts";`,
      `import "./g.ts";`,
      `const h = await import("../eval/h.ts");`,
      `// import { x } from "../eval/commented.ts";`,
    ].join("\n");
    expect(specifiers(src)).toEqual(["./a.ts", "../eval/b.ts", "../eval/c.ts", "../run/e.ts", "./f.ts", "./g.ts", "../eval/h.ts"]);
  });

  it("walks every guarded module", () => {
    const seen = new Set(tsFiles(join(REPO, "src")).map(layerOf));
    for (const layer of [...GUARDED, ...TOP]) expect(seen.has(layer), layer).toBe(true);
  });

  it("no guarded module imports src/eval/ or src/run/, beyond the known imports", () => {
    expect(violations().filter((v) => !KNOWN.has(v))).toEqual([]);
  });

  it("the known imports only shrink: each is still there, or its line goes", () => {
    const now = new Set(violations());
    expect([...KNOWN].filter((v) => !now.has(v))).toEqual([]);
  });

  it("catalog never imports identify (identify imports catalog; the shared types live in src/shared/)", () => {
    const up: string[] = [];
    for (const file of tsFiles(join(REPO, "src", "catalog"))) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        if (spec.startsWith(".") && layerOf(resolve(dirname(file), spec)) === "identify") up.push(`${rel(file)} -> ${spec}`);
      }
    }
    expect(up).toEqual([]);
  });

  it("identify's decision core imports nothing from src/eval/", () => {
    const v = violations().filter((x) => /^src\/identify\/(appearance|section-prior|decision|readers)\.ts /.test(x));
    expect(v).toEqual([]);
  });
});
