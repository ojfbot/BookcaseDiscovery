import { unlinkSync } from "node:fs";
import { ImageStore, sha256Hex } from "../ledger/images.ts";
import { JobError } from "./jobs.ts";
import type { JobHandler } from "./jobs.ts";
import type { FleetClient } from "./vendor/fleet-runner/client.ts";

/** The handler sees only verified host-local content. No server path crosses this boundary. */
export function withFleetInputs(client: Pick<FleetClient, "downloadInput">, images: ImageStore, handler: JobHandler): JobHandler {
  return async (job, context) => {
    for (const hash of job.inputs) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new JobError("bad-spec", false);
      if (!images.verify(hash)) {
        const bytes = await client.downloadInput(job, hash, context.signal);
        if (sha256Hex(bytes) !== hash) throw new JobError("input-mismatch", false);
        if (context.signal.aborted) throw new JobError("interrupted", true);
        // A corrupt local cache must not mask a verified replacement. The image store is private to this profile.
        const corrupt = images.find(hash);
        if (corrupt) unlinkSync(corrupt);
        const stored = images.put(bytes, "blob");
        if (stored.hash !== hash || !images.verify(hash)) throw new JobError("input-mismatch", false);
      }
    }
    return handler(job, context);
  };
}
