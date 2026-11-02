// What both ledgers do to an event before it touches storage: refuse a supplied seq, validate with
// Zod, and optionally cross-check against the JSON Schema.
import { parseEvent } from "./contracts.ts";
import type { NewEvent } from "./contracts.ts";
import { LedgerError } from "./ledger.ts";
import { eventSchemaErrors } from "./schemas.ts";

export function prepareEvent(event: NewEvent, crossCheck: boolean): NewEvent {
  if ("seq" in event) throw new LedgerError("append: the ledger assigns seq; do not supply one");
  let parsed: NewEvent;
  try {
    parsed = parseEvent(event) as NewEvent;
  } catch (cause) {
    throw new LedgerError(`append: event fails its contract: ${cause instanceof Error ? cause.message : cause}`);
  }
  if (crossCheck) {
    const errors = eventSchemaErrors(parsed);
    if (errors.length) throw new LedgerError(`append: Zod accepts but the JSON Schema rejects: ${errors.join("; ")}`);
  }
  return parsed;
}
