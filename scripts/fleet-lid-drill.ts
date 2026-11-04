// Use the pinned pilot environment from the existing runbook, with the lid open.
// On Yojimbo, enqueue one drill with the existing pilot JPEG:
//   pnpm exec node scripts/fleet-lid-drill.ts enqueue "$BOOKCASE_DATA/pilot.jpg"
// On Yuri, with its existing credential and helper, run once:
//   pnpm exec node scripts/fleet-lid-drill.ts work
// Send the coordinator an armed receipt after "lid drill armed" appears.
// Follow the coordinator's close and reopen cues. Report the terminal status
// and whether macOS recorded a lid-close sleep and wake, in aggregate only.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dataRoot, ImageStore } from "../src/ledger/images.ts";
import { defaultOcrBinary } from "../src/perceive/ocr.ts";
import { detectCapabilities, ocrHelperId, readVisionHandler, readVisionJob } from "../src/run/job-kinds.ts";
import { fleetClient } from "../src/run/vendor/fleet-runner/client.ts";
import { workOnce } from "../src/run/vendor/fleet-runner/worker.ts";

const drillId = "lid-close-drill";
const armTimeoutMs = 12 * 60_000;
// The pilot uses a five-minute lease. Keep the upload paused across an early wake.
const resumeGapMs = 5 * 60_000;

async function waitForResume() {
  const deadline = Date.now() + armTimeoutMs;
  let previous = Date.now();
  while (previous < deadline) {
    await delay(1_000);
    const now = Date.now();
    if (now - previous >= resumeGapMs) return;
    previous = now;
  }
  throw new Error("resume window expired");
}

async function main() {
  const [command, photo, extra] = process.argv.slice(2);
  const { FLEET_ENDPOINT: endpoint, FLEET_TOKEN_FILE: token } = process.env;
  if (!endpoint || !token || extra) throw new Error("invalid configuration");
  const binary = defaultOcrBinary();
  if (command === "enqueue" && photo) {
    const dimensions = execFileSync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", photo], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const width = Number(/^  pixelWidth: ([0-9]+)$/m.exec(dimensions)?.[1]);
    const height = Number(/^  pixelHeight: ([0-9]+)$/m.exec(dimensions)?.[1]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2)
      throw new Error("invalid photo dimensions");
    const spec = readVisionJob(photo, [{
      id: drillId,
      polygon: [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
      rotations: [0],
    }], ocrHelperId(binary), { payload: null });
    const result = await fleetClient(endpoint, "owner", token).enqueue(spec);
    console.log(result.created ? "lid drill enqueued" : "lid drill already enqueued");
    return;
  }
  if (command !== "work" || photo) throw new Error("invalid command");

  const caps = detectCapabilities();
  if (!caps.includes("apple-vision")) throw new Error("missing helper");
  const root = dataRoot();
  const images = new ImageStore(root);
  const client = fleetClient(endpoint, "yuri", token);
  const worker = {
    caps,
    handlers: { "read-vision": readVisionHandler({ binary, resolveImage: (hash) => images.find(hash) }) },
    outDir: join(root, "fleet", "lid-drill-attempts"),
  };
  let firstKey: string | undefined;
  let staleRejected = false;
  let resume: Promise<void> | undefined;
  const scopedClient = {
    ...client,
    async claim(caps: readonly string[], kinds: readonly string[]) {
      const job = await client.claim(caps, kinds);
      if (!job) return null;
      const requests = job.params.requests;
      if (!Array.isArray(requests) || requests.length !== 1 ||
          requests[0]?.id !== drillId || (firstKey && job.key !== firstKey)) {
        await client.release(job);
        throw new Error("unexpected job");
      }
      firstKey = job.key;
      return job;
    },
  };
  const first = await workOnce({
    ...scopedClient,
    async complete(job, bytes, sha256) {
      if (!resume) {
        console.log("lid drill armed");
        resume = waitForResume();
      }
      await resume;
      // Allow time for the LAN route to return after waking.
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const accepted = await client.complete(job, bytes, sha256);
          staleRejected = !accepted;
          return accepted;
        } catch {
          await delay(3_000);
        }
      }
      throw new Error("completion endpoint unreachable after wake");
    },
  }, worker);
  if (first !== "lease-lost" || !staleRejected) throw new Error("expected stale completion rejection");
  console.log("lid drill stale completion rejected");
  if (await workOnce(scopedClient, worker) !== "completed") throw new Error("recovery did not complete");
  console.log("lid drill recovery completed");
}

process.umask(0o077);
main().catch(() => {
  console.error("lid drill failed");
  process.exitCode = 1;
});
