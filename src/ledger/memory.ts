// In-memory Ledger: the reference implementation of the L-1 interface. Tests and the synthetic
// end-to-end run use it; L-2's SQLite ledger replaces it for real runs.
import { parseEvent } from "./contracts.ts";
import type { LedgerEvent, NewEvent } from "./contracts.ts";
import { LedgerError } from "./ledger.ts";
import type { Ledger, ObservationView, RecommendationView, ViewDump, WorkItemView } from "./ledger.ts";
import { eventSchemaErrors } from "./schemas.ts";
import { apply, emptyState, toDump } from "./views.ts";
import type { Payload } from "./contracts.ts";

export interface MemoryLedgerOptions {
  /** Also validate each event against the JSON Schema (Ajv) and refuse on disagreement with Zod. Off by default. */
  crossCheck?: boolean;
}

export class MemoryLedger implements Ledger {
  readonly #log: LedgerEvent[] = [];
  readonly #state = emptyState();
  readonly #crossCheck: boolean;

  constructor(options: MemoryLedgerOptions = {}) {
    this.#crossCheck = options.crossCheck ?? false;
  }

  append(event: NewEvent): LedgerEvent {
    if ("seq" in event) throw new LedgerError("append: the ledger assigns seq; do not supply one");
    let parsed: NewEvent;
    try {
      parsed = parseEvent(event) as NewEvent;
    } catch (cause) {
      throw new LedgerError(`append: event fails its contract: ${cause instanceof Error ? cause.message : cause}`);
    }
    if (this.#crossCheck) {
      const errors = eventSchemaErrors(parsed);
      if (errors.length) throw new LedgerError(`append: Zod accepts but the JSON Schema rejects: ${errors.join("; ")}`);
    }
    const stored = structuredClone({ ...parsed, seq: this.#log.length + 1 }) as LedgerEvent;
    apply(this.#state, stored); // throws before changing anything if the event names something unknown
    this.#log.push(stored);
    return structuredClone(stored);
  }

  *events(after = 0): Iterable<LedgerEvent> {
    for (const e of this.#log) if (e.seq > after) yield structuredClone(e);
  }

  lastSeq(): number {
    return this.#log.length;
  }

  observation(observationId: string): ObservationView | undefined {
    const o = this.#state.observations.get(observationId);
    return o && structuredClone(o);
  }

  observations(filter: { sessionId?: string; imageHash?: string } = {}): ObservationView[] {
    return [...this.#state.observations.values()]
      .filter(
        (o) =>
          (filter.sessionId === undefined || o.spine.sessionId === filter.sessionId) &&
          (filter.imageHash === undefined || o.spine.imageHash === filter.imageHash),
      )
      .map((o) => structuredClone(o));
  }

  workItems(filter: { open?: boolean } = {}): WorkItemView[] {
    return [...this.#state.workItems.values()]
      .filter((w) => filter.open === undefined || (w.resolution === null) === filter.open)
      .map((w) => structuredClone(w));
  }

  recommendations(): RecommendationView[] {
    return [...this.#state.recommendations.values()].map((r) => structuredClone(r));
  }

  images(sessionId?: string): Payload<"ImageAssetIngested">[] {
    return this.#state.images.filter((i) => sessionId === undefined || i.sessionId === sessionId).map((i) => structuredClone(i));
  }

  rejections(sessionId?: string): Payload<"ImageRejected">[] {
    return this.#state.rejections.filter((r) => sessionId === undefined || r.sessionId === sessionId).map((r) => structuredClone(r));
  }

  viewDump(): ViewDump {
    return structuredClone(toDump(this.#state));
  }
}
