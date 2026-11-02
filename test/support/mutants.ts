// Mutation helper for the contract-agreement tests: replace, delete or extend every node of an example
// and let two validators (a JSON Schema and Zod) reach a verdict on each mutant. The examples alone
// could miss a loosened or tightened field. Same idea as test/contracts.test.ts, for single-document contracts.
const REPLACEMENTS: unknown[] = [null, "x", "", -1, 0, 2, 0.5, true, [], {}];
type Path = (string | number)[];

function* paths(node: unknown, prefix: Path = []): Generator<Path> {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      yield [...prefix, i];
      yield* paths(node[i], [...prefix, i]);
    }
  } else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) {
      yield [...prefix, k];
      yield* paths((node as any)[k], [...prefix, k]);
    }
  }
}

const at = (root: any, path: Path) => path.reduce((n, k) => n[k], root);

export function* mutants(example: unknown): Generator<{ what: string; value: unknown }> {
  for (const p of paths(example)) {
    const parentPath = p.slice(0, -1);
    const key = p[p.length - 1]!;
    for (const r of REPLACEMENTS) {
      const m = structuredClone(example);
      (at(m, parentPath) as any)[key] = r;
      yield { what: `${p.join(".")} = ${JSON.stringify(r)}`, value: m };
    }
    const removed = structuredClone(example);
    const parent = at(removed, parentPath) as any;
    if (Array.isArray(parent)) parent.splice(key as number, 1);
    else delete parent[key];
    yield { what: `delete ${p.join(".")}`, value: removed };
  }
  const objects = [[] as Path, ...[...paths(example)].filter((q) => {
    const n = at(example, q);
    return n && typeof n === "object" && !Array.isArray(n);
  })];
  for (const p of objects) {
    const m = structuredClone(example);
    (at(m, p) as any).__extra = 1;
    yield { what: `extra key at /${p.join("/")}`, value: m };
  }
}

/** Run both validators over every mutant of every example; return the disagreements. */
export function disagreements(examples: { name: string; value: unknown }[], a: (v: unknown) => boolean, b: (v: unknown) => boolean): { checked: number; found: string[] } {
  let checked = 0;
  const found: string[] = [];
  for (const { name, value } of examples) {
    for (const m of mutants(value)) {
      checked++;
      const x = a(m.value);
      if (x !== b(m.value)) found.push(`${name}: ${m.what} (schema ${x ? "accepts" : "rejects"})`);
    }
  }
  return { checked, found };
}
