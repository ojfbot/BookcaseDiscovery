// In-memory Ledger: the reference implementation of the L-1 interface. Tests and the synthetic
// end-to-end run use it; L-2's SQLite ledger replaces it for real runs.
import type { LedgerEvent, NewEvent } from "./contracts.ts";
import type {
  CardView,
  Ledger,
  ObservationView,
  RecommendationView,
  RequestView,
  RunView,
  TrackView,
  ViewDump,
  WorkItemView,
} from "./ledger.ts";
import { prepareEvent } from "./prepare.ts";
import { apply, emptyState, toDump } from "./views.ts";
import type { Payload } from "./contracts.ts";

export interface MemoryLedgerOptions {
  /** Also validate each event against the JSON Schema (Ajv) and refuse on disagreement with Zod. Off by default. */
  crossCheck?: boolean;
}

export class MemoryLedger implements Ledger {
  readonly #log: LedgerEvent[] = [];
  readonly #state = emptyState((seq) => this.#log[seq - 1]);
  readonly #crossCheck: boolean;

  constructor(options: MemoryLedgerOptions = {}) {
    this.#crossCheck = options.crossCheck ?? false;
  }

  append(event: NewEvent): LedgerEvent {
    const parsed = prepareEvent(event, this.#crossCheck);
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

  run(runId: string): RunView | undefined {
    const r = this.#state.runs.get(runId);
    return r && structuredClone(r);
  }

  runs(): RunView[] {
    return [...this.#state.runs.values()].map((r) => structuredClone(r));
  }

  tracks(): TrackView[] {
    return [...this.#state.tracks.values()].map((t) => structuredClone(t));
  }

  cards(): CardView[] {
    return [...this.#state.cards.values()].map((c) => structuredClone(c));
  }

  adjudicationRequests(): RequestView[] {
    return [...this.#state.requests.values()].map((r) => structuredClone(r));
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
