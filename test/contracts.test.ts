import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BANDS,
  EVENT_TYPES,
  EventSchema,
  PHOTO_SETTINGS,
  ROTATIONS,
  STATUSES,
  UNRESOLVED_REASONS,
  helperSchemas,
  payloadSchemas,
} from "../src/ledger/index.ts";
import type { Payload } from "../src/ledger/index.ts";
import {
  eventSchemaErrors,
  eventSchemaNames,
  helperSchemaErrors,
  helperSchemaNames,
  payloadSchemaErrors,
} from "../src/ledger/schemas.ts";

const FIXTURES = new URL("./fixtures/contracts/", import.meta.url);
const CONTRACTS = new URL("../contracts/", import.meta.url);

const readJson = (url: URL): any => JSON.parse(readFileSync(url, "utf8"));
const jsonFiles = (dir: URL) => readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const jsonlRecords = (url: URL): unknown[] =>
  readFileSync(url, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const eventExamples = jsonFiles(FIXTURES).map((f) => ({ file: f, value: readJson(new URL(f, FIXTURES)) }));
const invalidEvents = jsonFiles(new URL("invalid/", FIXTURES)).map((f) => ({
  file: f,
  value: readJson(new URL(`invalid/${f}`, FIXTURES)),
}));
const helperExamples = readdirSync(new URL("helpers/", FIXTURES))
  .filter((f) => f.endsWith(".jsonl"))
  .sort()
  .flatMap((f) => jsonlRecords(new URL(`helpers/${f}`, FIXTURES)).map((value, i) => ({ contract: f.replace(".jsonl", ""), where: `${f}:${i + 1}`, value })));
const invalidHelpers = jsonFiles(new URL("invalid/helpers/", FIXTURES)).map((f) => ({
  file: f,
  contract: f.split("__")[0]!,
  value: readJson(new URL(`invalid/helpers/${f}`, FIXTURES)),
}));

const zodAccepts = (value: unknown) => EventSchema.safeParse(value).success;
const helperZodAccepts = (contract: string, value: unknown) =>
  helperSchemas[contract as keyof typeof helperSchemas].safeParse(value).success;

describe("examples (test/fixtures/contracts/)", () => {
  it.each(eventExamples.map((e) => [e.file, e.value] as const))("%s validates against its JSON Schema and its Zod validator", (file, value) => {
    expect(eventSchemaErrors(value)).toEqual([]);
    expect(payloadSchemaErrors(value.type, value.payload)).toEqual([]);
    expect(EventSchema.safeParse(value).error?.issues ?? []).toEqual([]);
    expect(file.startsWith(`${value.type}.`)).toBe(true);
  });

  it("every event type has at least one valid example", () => {
    const covered = new Set(eventExamples.map((e) => e.value.type));
    expect([...EVENT_TYPES].filter((t) => !covered.has(t))).toEqual([]);
  });

  it.each(helperExamples.map((e) => [e.where, e] as const))("helper record %s validates", (_where, { contract, value }) => {
    expect(helperSchemaErrors(contract, value)).toEqual([]);
    expect(helperSchemas[contract as keyof typeof helperSchemas].safeParse(value).error?.issues ?? []).toEqual([]);
  });

  it("every helper contract has a valid example and an invalid one", () => {
    for (const name of helperSchemaNames) {
      expect(helperExamples.some((e) => e.contract === name), `valid example for ${name}`).toBe(true);
      expect(invalidHelpers.some((e) => e.contract === name), `invalid example for ${name}`).toBe(true);
    }
  });

  it.each(invalidEvents.map((e) => [e.file, e.value] as const))("invalid/%s is rejected by both", (_file, value) => {
    expect(eventSchemaErrors(value).length).toBeGreaterThan(0);
    expect(zodAccepts(value)).toBe(false);
  });

  it.each(invalidHelpers.map((e) => [e.file, e] as const))("invalid/helpers/%s is rejected by both", (_file, { contract, value }) => {
    expect(helperSchemaErrors(contract, value).length).toBeGreaterThan(0);
    expect(helperZodAccepts(contract, value)).toBe(false);
  });
});

describe("enums", () => {
  const common = readJson(new URL("common.schema.json", CONTRACTS)).definitions;

  it("the status enum has no `exhausted` (INV-1)", () => {
    expect(common.Status.enum).toEqual(["unresolved", "resolved", "paused", "needs-pixels"]);
    expect([...STATUSES]).toEqual(common.Status.enum);
    expect([...STATUSES]).not.toContain("exhausted");
    expect(payloadSchemas.StatusChanged.safeParse({ observationId: "o", from: null, to: "exhausted" }).success).toBe(false);
  });

  it("no schema anywhere allows an `exhausted` value except the reason `strategies-exhausted` (INV-1, INV-8)", () => {
    const values: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if ((k === "enum" || k === "const") && v !== null) values.push(...[v].flat().map(String));
          else walk(v);
        }
      }
    };
    for (const f of ["common.schema.json", "event.schema.json"]) walk(readJson(new URL(f, CONTRACTS)));
    for (const n of eventSchemaNames) walk(readJson(new URL(`events/${n}.schema.json`, CONTRACTS)));
    for (const n of helperSchemaNames) walk(readJson(new URL(`helpers/${n}.schema.json`, CONTRACTS)));
    expect(values.filter((v) => /exhaust/i.test(v) && v !== "strategies-exhausted")).toEqual([]);
  });

  it("the band, reason, setting and rotation enums agree between the schemas and Zod", () => {
    expect([...BANDS]).toEqual(common.Band.enum);
    expect([...UNRESOLVED_REASONS]).toEqual(common.UnresolvedReason.enum);
    expect([...PHOTO_SETTINGS]).toEqual(common.PhotoSetting.enum);
    expect([...ROTATIONS]).toEqual(common.Rotation.enum);
    expect(BANDS).toEqual(["verified", "probable", "candidate", "unknown"]);
    expect(UNRESOLVED_REASONS).toEqual(["missing-pixels", "no-catalog-candidate", "conflicting-evidence", "strategies-exhausted"]);
  });
});

describe("schema files and validators cover the same things (OC13)", () => {
  it("event types: schema files, the envelope's enum, its type-to-payload table and Zod all match", () => {
    const envelope = readJson(new URL("event.schema.json", CONTRACTS));
    const mapped = envelope.allOf.map((b: any) => [b.if.properties.type.const, b.then.properties.payload.$ref]);
    expect(mapped.map(([t]: [string, string]) => t).sort()).toEqual([...eventSchemaNames].sort());
    for (const [t, ref] of mapped) expect(ref).toBe(`events/${t}.schema.json`);
    expect([...envelope.properties.type.enum].sort()).toEqual([...eventSchemaNames].sort());
    expect([...EVENT_TYPES].sort()).toEqual([...eventSchemaNames].sort());
  });

  it("helper contracts: schema files and Zod validators match", () => {
    expect(Object.keys(helperSchemas).sort()).toEqual([...helperSchemaNames].sort());
  });

  // Replace, delete or extend every node of every example and require the JSON Schema and Zod to
  // reach the same verdict on each mutant. The examples alone could miss a loosened or tightened field.
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

  function* mutants(example: unknown): Generator<{ what: string; value: unknown }> {
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
    for (const p of [[] as Path, ...[...paths(example)].filter((q) => {
      const n = at(example, q);
      return n && typeof n === "object" && !Array.isArray(n);
    })]) {
      const m = structuredClone(example);
      (at(m, p) as any).__extra = 1;
      yield { what: `extra key at /${p.join("/")}`, value: m };
    }
    if (example && typeof example === "object" && !Array.isArray(example) && "type" in example) {
      yield { what: "seq = 0", value: { ...(example as object), seq: 0 } };
      yield { what: "seq = 7", value: { ...(example as object), seq: 7 } };
    }
  }

  it("Zod and the event schemas agree on every mutation of every event example", () => {
    const disagreements: string[] = [];
    let checked = 0;
    for (const { file, value } of eventExamples) {
      for (const m of mutants(value)) {
        checked++;
        const ajvOk = eventSchemaErrors(m.value).length === 0;
        if (ajvOk !== zodAccepts(m.value)) disagreements.push(`${file}: ${m.what} (schema ${ajvOk ? "accepts" : "rejects"})`);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(disagreements.slice(0, 10)).toEqual([]);
  });

  it("Zod and the helper schemas agree on every mutation of every helper example", () => {
    const disagreements: string[] = [];
    for (const { contract, where, value } of helperExamples) {
      for (const m of mutants(value)) {
        const ajvOk = helperSchemaErrors(contract, m.value).length === 0;
        if (ajvOk !== helperZodAccepts(contract, m.value)) disagreements.push(`${where}: ${m.what} (schema ${ajvOk ? "accepts" : "rejects"})`);
      }
    }
    expect(disagreements.slice(0, 10)).toEqual([]);
  });
});

describe("IdentityCorrected and PreferenceRecorded share no type (INV-3, INV-7)", () => {
  const schemaOf = (t: string) => readJson(new URL(`events/${t}.schema.json`, CONTRACTS));
  const refs = (node: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(node)) node.forEach((n) => refs(n, out));
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "$ref") out.add(String(v));
        else refs(v, out);
      }
    }
    return out;
  };

  it("have different `type`s and disjoint payload fields", () => {
    const a = schemaOf("IdentityCorrected");
    const b = schemaOf("PreferenceRecorded");
    expect(Object.keys(a.properties).filter((k) => k in b.properties)).toEqual([]);
  });

  it("reference no definition in common except the opaque Id", () => {
    const shared = [...refs(schemaOf("IdentityCorrected"))].filter((r) => refs(schemaOf("PreferenceRecorded")).has(r));
    expect(shared).toEqual(["../common.schema.json#/definitions/Id"]);
  });

  it("an example of one is not a valid payload of the other", () => {
    const identity = eventExamples.filter((e) => e.value.type === "IdentityCorrected");
    const preference = eventExamples.filter((e) => e.value.type === "PreferenceRecorded");
    expect(identity.length).toBeGreaterThan(0);
    expect(preference.length).toBeGreaterThan(0);
    for (const { value } of identity) {
      expect(payloadSchemaErrors("PreferenceRecorded", value.payload).length).toBeGreaterThan(0);
      expect(payloadSchemas.PreferenceRecorded.safeParse(value.payload).success).toBe(false);
    }
    for (const { value } of preference) {
      expect(payloadSchemaErrors("IdentityCorrected", value.payload).length).toBeGreaterThan(0);
      expect(payloadSchemas.IdentityCorrected.safeParse(value.payload).success).toBe(false);
    }
  });

  it("are unrelated TypeScript types (checked by `pnpm typecheck`)", () => {
    type Identity = Payload<"IdentityCorrected">;
    type Preference = Payload<"PreferenceRecorded">;
    expectTypeOf<Identity>().not.toExtend<Preference>();
    expectTypeOf<Preference>().not.toExtend<Identity>();
    expectTypeOf<keyof Identity & keyof Preference>().toEqualTypeOf<never>();
  });
});
