// Ajv validators for the recommend contracts in `contracts/` (profile, vocabulary). Zod is what the
// code uses on every read and write; this is the other half of OC13, run beside it by the tests.
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";

const CONTRACTS = new URL("../../contracts/", import.meta.url);

function readJson(path: string): { $id: string } & Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, CONTRACTS), "utf8"));
}

const ajv = new Ajv({ strict: true, allErrors: true });
const profileSchema = readJson("profile.schema.json");
const vocabularySchema = readJson("vocabulary.schema.json");
ajv.addSchema(profileSchema);
ajv.addSchema(vocabularySchema);

const validateProfile = ajv.getSchema(profileSchema.$id) as ValidateFunction;
const validateVocabulary = ajv.getSchema(vocabularySchema.$id) as ValidateFunction;

function errorsOf(validate: ValidateFunction, value: unknown): string[] {
  validate(value);
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
}

/** Validate a profile file (`contracts/profile.schema.json`). Returns the errors, empty when valid. */
export const profileSchemaErrors = (value: unknown): string[] => errorsOf(validateProfile, value);
/** Validate the vocabulary (`contracts/vocabulary.schema.json`). Returns the errors, empty when valid. */
export const vocabularySchemaErrors = (value: unknown): string[] => errorsOf(validateVocabulary, value);
