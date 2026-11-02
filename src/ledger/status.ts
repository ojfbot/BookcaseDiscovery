// The status machine and the budget rule (INV-1, INV-2). Pure functions: both ledgers call them
// with what they know about the observation and the run, so the rules live in one place.
//
// There is no `exhausted` status. A spine that cannot be resolved stays `unresolved` with a reason
// (on `BandAssigned`); a spent budget gives `paused` and the queue persists.
import type { EventType, Payload, Status } from "./contracts.ts";
import { LedgerError } from "./ledger.ts";
import type { RunView } from "./ledger.ts";

export type Cause = NonNullable<Payload<"StatusChanged">["cause"]>;
/** What a transition must carry in `cause`: nothing, a spent budget, or a trigger. */
export type CauseClass = "none" | "budget" | "trigger";

export interface Transition {
  from: Status | null;
  to: Status;
  cause: CauseClass;
}

/** Every legal transition. Anything not listed is refused, including a status to itself. */
export const TRANSITIONS: readonly Transition[] = [
  { from: null, to: "unresolved", cause: "none" }, // first status of an observation
  { from: "unresolved", to: "resolved", cause: "none" },
  { from: "unresolved", to: "needs-pixels", cause: "none" }, // a closer photo is asked for
  { from: "unresolved", to: "paused", cause: "budget" }, // INV-2
  { from: "needs-pixels", to: "unresolved", cause: "none" }, // the photo came, or the request was withdrawn
  { from: "needs-pixels", to: "resolved", cause: "none" },
  { from: "needs-pixels", to: "paused", cause: "budget" }, // INV-2
  { from: "paused", to: "unresolved", cause: "none" }, // resumed under a new budget
  { from: "resolved", to: "unresolved", cause: "trigger" }, // only a trigger reopens a resolved spine
];

/** The event type a trigger cause must cite; `catalog-refresh` has no event type yet. */
const TRIGGER_EVENT: Record<string, EventType | undefined> = {
  "new-image": "ImageAssetIngested",
  correction: "IdentityCorrected",
  "model-change": "RunStarted",
};

const CAUSE_CLASS: Record<Cause["kind"], CauseClass> = {
  "budget-spent": "budget",
  "new-image": "trigger",
  correction: "trigger",
  "model-change": "trigger",
  "catalog-refresh": "trigger",
};

export function findTransition(from: Status | null, to: Status): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/**
 * True when a cap the ledger can count has been reached: adjudications or tokens. The spend cap
 * cannot be counted here (`AdjudicationRecorded` carries no price), so it is enforced by the
 * scheduler (I-5), which then records the pause with a `budget-spent` cause.
 */
export function countedCapReached(run: Pick<RunView, "started" | "usage">): boolean {
  const { budget } = run.started;
  const { usage } = run;
  return (
    (budget.maxAdjudications !== undefined && usage.adjudications >= budget.maxAdjudications) ||
    (budget.maxTokens !== undefined && usage.inputTokens + usage.outputTokens >= budget.maxTokens)
  );
}

/**
 * Refuse a paid adjudication once a counted cap is reached. A cache hit costs nothing and is always
 * allowed, and so is any adjudication of a run that was never started (it has no budget to spend).
 * The last call may overshoot a token cap: tokens are only known after the call.
 */
export function checkAdjudication(run: RunView | undefined, payload: Payload<"AdjudicationRecorded">): void {
  if (!run || payload.cached) return;
  if (countedCapReached(run)) {
    throw new LedgerError(
      `AdjudicationRecorded: run "${run.runId}" has spent its budget; pause instead (INV-2)`,
    );
  }
}

export interface StatusContext {
  /** The observation's status now; null before its first. */
  current: Status | null;
  /** `seq` of the event that set `current`; 0 when none. */
  currentSeq: number;
  /** `seq` the event being checked will have. */
  seq: number;
  /** The run named on the event's envelope, if it was started. */
  run: RunView | undefined;
  /** An event already in the ledger. */
  eventAt(seq: number): { type: EventType; payload: unknown } | undefined;
}

/** Throws a LedgerError unless `payload` is a legal step of the status machine in this context. */
export function checkStatusChange(payload: Payload<"StatusChanged">, ctx: StatusContext): void {
  const { observationId: id, from, to, cause } = payload;
  const fail = (why: string): never => {
    throw new LedgerError(`StatusChanged: observation "${id}" ${from ?? "(none)"} -> ${to}: ${why}`);
  };
  if (from !== ctx.current) fail(`its status is ${ctx.current ?? "(none)"}, not ${from ?? "(none)"}`);
  const rule = findTransition(from, to);
  if (!rule) return fail("not a legal transition");

  if (rule.cause === "none") {
    if (cause) fail(`this transition takes no cause, got "${cause.kind}"`);
    return;
  }
  if (!cause) return fail(rule.cause === "budget" ? "a pause needs cause budget-spent (INV-2)" : "reopening needs a trigger cause");
  if (CAUSE_CLASS[cause.kind] !== rule.cause) return fail(`cause "${cause.kind}" does not fit this transition`);

  if (rule.cause === "budget") {
    const { run } = ctx;
    if (!run) return fail("the run was never started, so no budget is known");
    if (!countedCapReached(run) && run.started.budget.maxSpendUsd === undefined) {
      fail(`run "${run.runId}" has not spent its budget`);
    }
    return;
  }

  // A trigger that is an event must be one that came after the spine was resolved.
  const wanted = TRIGGER_EVENT[cause.kind];
  if (!wanted) return; // catalog-refresh: nothing to cite
  const eventSeq = (cause as { eventSeq: number }).eventSeq;
  if (eventSeq >= ctx.seq) fail(`trigger event ${eventSeq} is not earlier than this one`);
  if (eventSeq <= ctx.currentSeq) fail(`trigger event ${eventSeq} is not later than when the spine was resolved (${ctx.currentSeq})`);
  const cited = ctx.eventAt(eventSeq);
  if (!cited || cited.type !== wanted) fail(`trigger event ${eventSeq} is not ${wanted === "IdentityCorrected" ? "a correction" : `a ${wanted}`}`);
  if (wanted === "IdentityCorrected" && (cited!.payload as { observationId: string }).observationId !== id) {
    fail(`trigger event ${eventSeq} corrects another spine`);
  }
}
