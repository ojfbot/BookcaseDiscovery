// Pure fold from events to views. The in-memory ledger uses it directly; L-2's SQLite views must
// produce the same `ViewDump` for the same events.
import type { LedgerEvent } from "./contracts.ts";
import { LedgerError } from "./ledger.ts";
import type { ObservationView, ViewDump, WorkItemView, RecommendationView } from "./ledger.ts";

export interface ViewState {
  images: ViewDump["images"];
  rejections: ViewDump["rejections"];
  observations: Map<string, ObservationView>;
  workItems: Map<string, WorkItemView>;
  recommendations: Map<string, RecommendationView>;
}

export function emptyState(): ViewState {
  return { images: [], rejections: [], observations: new Map(), workItems: new Map(), recommendations: new Map() };
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
 * untouched. Throws LedgerError if the event names an observation, work item or recommendation that
 * does not exist, or reuses an id that does.
 */
export function apply(state: ViewState, event: LedgerEvent): void {
  switch (event.type) {
    case "ScanSessionOpened":
    case "RunStarted":
    case "RunFinished":
    case "PreferenceRecorded": // taste, not identity: no view here changes (INV-7)
      return;
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
    case "AdjudicationRecorded":
      known(state.observations, event.payload.observationId, "observation", event.type).adjudications.push(
        event.payload,
      );
      return;
    case "BandAssigned":
      known(state.observations, event.payload.observationId, "observation", event.type).band = event.payload;
      return;
    case "StatusChanged":
      known(state.observations, event.payload.observationId, "observation", event.type).status = event.payload.to;
      return;
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
    default: {
      const unreachable: never = event;
      throw new LedgerError(`unhandled event ${JSON.stringify(unreachable)}`);
    }
  }
}

export function toDump(state: ViewState): ViewDump {
  return {
    images: state.images,
    rejections: state.rejections,
    observations: [...state.observations.values()],
    workItems: [...state.workItems.values()],
    recommendations: [...state.recommendations.values()],
  };
}
