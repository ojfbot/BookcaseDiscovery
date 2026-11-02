// Loads the JSON Schemas in `contracts/` and validates against them with Ajv. Zod is what the ledger
// uses on every write; this is the other half of OC13: the source of truth, run side by side with it.
import { readFileSync, readdirSync } from "node:fs";
import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";

const CONTRACTS = new URL("../../contracts/", import.meta.url);

function readJson(path: string): { $id: string } & Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, CONTRACTS), "utf8"));
}

function schemaFiles(dir: string): string[] {
  return readdirSync(new URL(`${dir}/`, CONTRACTS))
    .filter((f) => f.endsWith(".schema.json"))
    .sort();
}

/** Stems of `contracts/events/*.schema.json`: the event types. */
export const eventSchemaNames = schemaFiles("events").map((f) => f.replace(".schema.json", ""));
/** Stems of `contracts/helpers/*.schema.json`. */
export const helperSchemaNames = schemaFiles("helpers").map((f) => f.replace(".schema.json", ""));

export const ajv = new Ajv({ strict: true, allErrors: true });
for (const file of ["common.schema.json", "event.schema.json"]) ajv.addSchema(readJson(file));
for (const f of schemaFiles("events")) ajv.addSchema(readJson(`events/${f}`));
for (const f of schemaFiles("helpers")) ajv.addSchema(readJson(`helpers/${f}`));

function compiled(file: string): ValidateFunction {
  return ajv.getSchema(readJson(file).$id) as ValidateFunction;
}

const validateEventFn = compiled("event.schema.json");
const helperValidators = new Map(helperSchemaNames.map((n) => [n, compiled(`helpers/${n}.schema.json`)]));

/** Validate an event envelope (with or without `seq`). Returns the errors, empty when valid. */
export function eventSchemaErrors(value: unknown): string[] {
  validateEventFn(value);
  return (validateEventFn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
}

/** Validate one helper JSON Lines record against `contracts/helpers/<name>.schema.json`. */
export function helperSchemaErrors(name: string, value: unknown): string[] {
  const validate = helperValidators.get(name);
  if (!validate) throw new Error(`no helper contract "${name}"`);
  validate(value);
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
}

/** Validate a payload alone against `contracts/events/<type>.schema.json`. */
export function payloadSchemaErrors(type: string, payload: unknown): string[] {
  const validate = ajv.getSchema(readJson(`events/${type}.schema.json`).$id) as ValidateFunction;
  validate(payload);
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
}
