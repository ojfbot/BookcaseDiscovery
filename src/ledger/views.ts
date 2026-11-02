// Pure fold from events to views. The in-memory ledger uses it directly; the SQLite ledger's
// tables (`sqlite.ts`) must produce the same `ViewDump` for the same events, and the shared
// behaviour suite (`test/ledger-behaviour.ts`) holds both to it.
import type { LedgerEvent } from "./contracts.ts";
import { LedgerError } from "./ledger.ts";
import type {
  CardView,
  ObservationView,
  RecommendationView,
  RequestView,
  RunView,
  TrackView,
  ViewDump,
  WorkItemView,
} from "./ledger.ts";
import {
  checkCacheHit,
  checkLookup,
  checkOcrReading,
  checkRequest,
  checkResult,
  checkTrackWindow,
  nextCard,
  nextTrack,
} from "./live.ts";
import type { LiveContext } from "./live.ts";
import { checkAdjudication, checkStatusChange } from "./status.ts";

export interface ViewState {
  images: ViewDump["images"];
  rejections: ViewDump["rejections"];
  observations: Map<string, ObservationView>;
  workItems: Map<string, WorkItemView>;
  recommendations: Map<string, RecommendationView>;
  runs: Map<string, RunView>;
  tracks: Map<string, TrackView>;
  cards: Map<string, CardView>;
  requests: Map<string, RequestView>;
  /** `seq` of the event that set each observation's status (the status machine's trigger check needs it). */
  statusSeq: Map<string, number>;
  /** An event already in the log, for the status machine to check a cited trigger against. */
  eventAt: (seq: number) => LedgerEvent | undefined;
}

export function emptyState(eventAt: ViewState["eventAt"] = () => undefined): ViewState {
  return {
    images: [],
    rejections: [],
    observations: new Map(),
    workItems: new Map(),
    recommendations: new Map(),
    runs: new Map(),
    tracks: new Map(),
    cards: new Map(),
    requests: new Map(),
    statusSeq: new Map(),
    eventAt,
  };
}

function known<T>(map: Map<string, T>, id: string, what: string, type: string): T {
  const found = map.get(id);
  if (!found) throw new LedgerError(`${type}: unknown ${what} "${id}"`);
  return found;
}

function fresh(map: Map<string, unknown>, id: string, what: string, type: string): void {
  if (map.has(id)) throw new LedgerError(`${type}: ${what} "${id}" already exists`);
}

/**
 * Apply one event to `state`. Every check runs before any change, so a refused event leaves `state`
 * untouched. Throws LedgerError if the event names an observation, work item, recommendation or run
 * that does not exist, reuses an id that does, or breaks the status machine or a run's budget.
 */
export function apply(state: ViewState, event: LedgerEvent): void {
  switch (event.type) {
    case "ScanSessionOpened":
    case "PreferenceRecorded": // taste, not identity: no view here changes (INV-7)
      return;
    case "RunStarted":
      fresh(state.runs, event.runId, "run", event.type);
      state.runs.set(event.runId, {
        runId: event.runId,
        started: event.payload,
        usage: { adjudications: 0, inputTokens: 0, outputTokens: 0 },
        finished: null,
      });
      return;
    case "RunFinished": {
      const run = known(state.runs, event.runId, "run", event.type);
      if (run.finished) throw new LedgerError(`${event.type}: run "${event.runId}" already finished`);
      run.finished = event.payload;
      return;
    }
    case "ImageAssetIngested":
      state.images.push(event.payload);
      return;
    case "ImageRejected":
      state.rejections.push(event.payload);
      return;
    case "SpineObserved": {
      const p = event.payload;
      fresh(state.observations, p.observationId, "observation", event.type);
      state.observations.set(p.observationId, {
        observationId: p.observationId,
        spine: p,
        texts: [],
        hypotheses: null,
        adjudications: [],
        band: null,
        status: null,
        corrections: [],
      });
      return;
    }
    case "TextObserved":
      known(state.observations, event.payload.observationId, "observation", event.type).texts.push(event.payload);
      return;
    case "HypothesesProposed":
      known(state.observations, event.payload.observationId, "observation", event.type).hypotheses = event.payload;
      return;
    case "AdjudicationRecorded": {
      const p = event.payload;
      const obs = known(state.observations, p.observationId, "observation", event.type);
      const run = state.runs.get(event.runId);
      checkAdjudication(run, p);
      obs.adjudications.push(p);
      if (run && !p.cached) {
        run.usage.adjudications += 1;
        run.usage.inputTokens += p.inputTokens;
        run.usage.outputTokens += p.outputTokens;
      }
      return;
    }
    case "BandAssigned":
      known(state.observations, event.payload.observationId, "observation", event.type).band = event.payload;
      return;
    case "StatusChanged": {
      const p = event.payload;
      const obs = known(state.observations, p.observationId, "observation", event.type);
      checkStatusChange(p, {
        current: obs.status,
        currentSeq: state.statusSeq.get(p.observationId) ?? 0,
        seq: event.seq,
        run: state.runs.get(event.runId),
        eventAt: (seq) => state.eventAt(seq),
      });
      obs.status = p.to;
      state.statusSeq.set(p.observationId, event.seq);
      return;
    }
    case "IdentityCorrected":
      known(state.observations, event.payload.observationId, "observation", event.type).corrections.push(
        event.payload.correction,
      );
      return;
    case "WorkItemOpened": {
      const p = event.payload;
      known(state.observations, p.observationId, "observation", event.type);
      fresh(state.workItems, p.workItemId, "work item", event.type);
      state.workItems.set(p.workItemId, { workItemId: p.workItemId, opened: p, resolution: null });
      return;
    }
    case "WorkItemClosed":
      known(state.workItems, event.payload.workItemId, "work item", event.type).resolution = event.payload.resolution;
      return;
    case "RecommendationIssued": {
      const p = event.payload;
      known(state.observations, p.recommendation.observationId, "observation", event.type);
      fresh(state.recommendations, p.recommendationId, "recommendation", event.type);
      state.recommendations.set(p.recommendationId, {
        recommendationId: p.recommendationId,
        rankingVersion: p.rankingVersion,
        current: p.recommendation,
        revisions: 0,
      });
      return;
    }
    case "RecommendationRevised": {
      const p = event.payload;
      const rec = known(state.recommendations, p.recommendationId, "recommendation", event.type);
      known(state.observations, p.recommendation.observationId, "observation", event.type);
      rec.rankingVersion = p.rankingVersion;
      rec.current = p.recommendation;
      rec.revisions += 1;
      return;
    }
    // ---- live track (S9). Only tracks, cards and adjudication requests have views; frame samples,
    // windows, readings, lookups and cache hits are checked and kept in the log. ----
    case "Track":
      state.tracks.set(event.payload.trackId, nextTrack(event.payload, state.tracks.get(event.payload.trackId)));
      return;
    case "FrameSample":
      return;
    case "TrackWindow":
      checkTrackWindow(event.payload, liveContext(state, event.seq));
      return;
    case "OcrReading":
      checkOcrReading(event.payload, liveContext(state, event.seq));
      return;
    case "LookupResult":
      checkLookup(event.payload, liveContext(state, event.seq));
      return;
    case "AdjudicationRequested": {
      const p = event.payload;
      checkRequest(p, state.requests.get(p.requestId), liveContext(state, event.seq));
      checkAdjudication(state.runs.get(event.runId), { cached: false }, event.type);
      state.requests.set(p.requestId, { requestId: p.requestId, requested: p, answered: false });
      return;
    }
    case "AdjudicationResult": {
      const p = event.payload;
      const request = state.requests.get(p.requestId);
      checkResult(p, request);
      request!.answered = true;
      const run = state.runs.get(event.runId);
      if (run) {
        run.usage.adjudications += 1;
        run.usage.inputTokens += p.inputTokens;
        run.usage.outputTokens += p.outputTokens;
      }
      return;
    }
    case "AdjudicationCacheHit":
      checkCacheHit(event.payload, liveContext(state, event.seq));
      return;
    case "CardProposed":
    case "CardRevised":
    case "CardRetracted":
    case "CardUndo": {
      const id = event.payload.cardId;
      state.cards.set(id, nextCard(event, state.cards.get(id), liveContext(state, event.seq)));
      return;
    }
    default: {
      const unreachable: never = event;
      throw new LedgerError(`unhandled event ${JSON.stringify(unreachable)}`);
    }
  }
}

function liveContext(state: ViewState, seq: number): LiveContext {
  return { seq, eventAt: (at) => state.eventAt(at), hasTrack: (id) => state.tracks.has(id) };
}

export function toDump(state: ViewState): ViewDump {
  return {
    images: state.images,
    rejections: state.rejections,
    observations: [...state.observations.values()],
    workItems: [...state.workItems.values()],
    recommendations: [...state.recommendations.values()],
    runs: [...state.runs.values()],
    tracks: [...state.tracks.values()],
    cards: [...state.cards.values()],
    adjudicationRequests: [...state.requests.values()],
  };
}
