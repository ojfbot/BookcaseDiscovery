import { setTimeout as delay } from "node:timers/promises";
import type { FleetClient } from "./client.ts";
import type { WorkerObservation } from "./status.ts";

/** Independent process presence: it never renews a job lease or confers execution authority. */
export async function runPresence(
  client: Pick<FleetClient, "presence">,
  snapshot: () => WorkerObservation,
  signal: AbortSignal,
  intervalMs = 10_000,
  timing = {
    now: Date.now,
    wait: (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }).then(() => {}),
  },
): Promise<void> {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 30_000)
    throw Error("invalid-presence-interval");
  while (!signal.aborted) {
    const started = timing.now();
    try {
      await client.presence(snapshot(), AbortSignal.any([signal, AbortSignal.timeout(5000)]));
    } catch {
      /* Missing process observations become stale on the server; never alter job authority. */
    }
    await timing.wait(Math.max(1, intervalMs - (timing.now() - started)), signal).catch(() => {});
  }
}
