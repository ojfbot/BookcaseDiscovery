import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import { defaultOcrBinary, ocrBinaryAvailable } from "../perceive/ocr.ts";
import { isServiceWorker, workerService } from "./fleet-service.ts";
import { mayClaim } from "./fleet-worker-policy.ts";
import { acquireNasSlot, nasEligibility } from "./fleet-eligibility.ts";
import { errorCode } from "./vendor/fleet-runner/diagnostics.ts";
import { withFleetInputs } from "./fleet-inputs.ts";
import { detectCapabilities, ocrHelperId, readVisionHandler, readVisionJob } from "./job-kinds.ts";
import { canonicalJson } from "./jobs.ts";
import {
  checkReadQwenOutput,
  compareWithCached,
  detectReadQwen,
  READ_QWEN_MODEL_DIR,
  readQwenHandler,
  ReadQwenJobSchema,
} from "./read-qwen.ts";
import { generateToken } from "./vendor/fleet-runner/auth.ts";
import { fleetClient } from "./vendor/fleet-runner/client.ts";
import type { JobSpec, JobHandler } from "./vendor/fleet-runner/jobs.js";
import { runWorker, workOnce } from "./vendor/fleet-runner/worker.ts";

const usage =
  "usage: bookcase fleet [nas] <pause | resume | reserve | unreserve | eligibility WORKER | keygen | stage PHOTO | enqueue PHOTO | pins | admit JOB | check JOB OUTPUT [CACHED] | work WORKER | serve-worker WORKER | service | report | verify WORKER>";

function dimensions(photo: string): [number, number] {
  const result = execFileSync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", photo], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const width = Number(/^  pixelWidth: ([0-9]+)$/m.exec(result)?.[1]);
  const height = Number(/^  pixelHeight: ([0-9]+)$/m.exec(result)?.[1]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2) {
    throw new Error("invalid photo dimensions");
  }
  return [width, height];
}

export async function fleetCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (argv[0] === "nas") return fleetCommand(argv.slice(1), { ...env, FLEET_SERVICE_PROFILE: "nas", FLEET_AUTO_INPUTS: "1" });
  const [command, arg] = argv;
  if (command === "service") return workerService(argv.slice(1), env);
  const root = dataRoot(env);
  const fleetDir = join(root, "fleet");
  const images = new ImageStore(root);
  if (["pause", "resume", "reserve", "unreserve"].includes(command ?? "")) {
    if (argv.length !== 1 || env.FLEET_SERVICE_PROFILE !== "nas") return 1;
    mkdirSync(fleetDir, { recursive: true });
    const marker = command === "pause" || command === "resume" ? "paused" : "resource-busy";
    if (command === "pause" || command === "reserve") writeFileSync(join(fleetDir, marker), "held\n", { mode: 0o600 });
    else rmSync(join(fleetDir, marker), { force: true });
    console.log(`fleet worker ${command === "pause" ? "paused; current attempt drains" : command === "resume" ? "resumed" : command === "reserve" ? "resource reserved; current attempt drains" : "resource released"}`);
    return 0;
  }
  const token = env.FLEET_TOKEN_FILE;
  const endpoint = env.FLEET_ENDPOINT;
  if (command === "--help" || command === "-h") {
    console.log(usage);
    return 0;
  }
  const arity = command === "keygen" || command === "report" || command === "pins" ? [1] : command === "check" ? [3, 4] : [2];
  if (!["keygen", "stage", "enqueue", "pins", "admit", "check", "work", "serve-worker", "report", "verify", "eligibility"].includes(command ?? "") || !arity.includes(argv.length)) {
    console.error(usage);
    return 1;
  }

  const previousUmask = process.umask(0o077);
  try {
    if (command === "keygen") {
      if (!token) throw new Error("missing token file");
      generateToken(token);
      console.log("fleet public key ready for registration");
      return 0;
    }
    if (command === "stage") {
      const photo = resolve(arg!);
      images.putFile(photo, extname(basename(photo)));
      console.log("fleet input staged");
      return 0;
    }
    const qwenModels = join(root, "models", READ_QWEN_MODEL_DIR);
    if (command === "pins") {
      // Hashes of public code and weights, and the Python version: nothing private.
      const detected = detectReadQwen({ modelDir: qwenModels });
      if (!detected.ok) {
        console.error(`read-qwen unavailable: ${detected.reason}`);
        return 1;
      }
      console.log(JSON.stringify(detected.pins, null, 2));
      return 0;
    }
    if (command === "check") {
      // Counts and problem codes only: the output and the cache hold reader text.
      const job = ReadQwenJobSchema.parse(JSON.parse(readFileSync(resolve(arg!), "utf8")));
      const output = readFileSync(resolve(argv[2]!), "utf8");
      const result = checkReadQwenOutput(job, output);
      console.log(`read-qwen output: ${result.readings} readings for ${result.requests} requests, ${result.readerErrors} reader errors`);
      console.log(`contract and order: ${result.problems.length === 0 ? "pass" : `fail (${result.problems.join(", ")})`}`);
      if (result.problems.length > 0) return 1;
      if (argv[3] === undefined) return 0;
      const cached = compareWithCached(job, output, readFileSync(resolve(argv[3]), "utf8"));
      console.log(`cached readings equal: ${cached.equal} of ${result.requests} (${cached.differ} differ, ${cached.missing} not cached)`);
      return cached.equal === result.requests ? 0 : 1;
    }
    if (command === "eligibility" && env.FLEET_SERVICE_PROFILE === "nas") {
      const binary = defaultOcrBinary(env);
      let expected = "";
      try { expected = ocrHelperId(binary); } catch { /* The eligibility result reports missing helper. */ }
      console.log(JSON.stringify(nasEligibility(arg!, fleetDir, binary, expected)));
      return 0;
    }
    if (!token || !endpoint) throw new Error("missing fleet configuration");
    if (command === "report") {
      const report = await fleetClient(endpoint, "owner", token).report();
      console.log(JSON.stringify(report, null, 2));
      return 0;
    }
    const binary = defaultOcrBinary(env);
    const keyFile = join(fleetDir, "job-key");
    if (command === "enqueue" || command === "admit") {
      let spec: JobSpec;
      if (command === "admit") {
        const parsed = ReadQwenJobSchema.safeParse(JSON.parse(readFileSync(resolve(arg!), "utf8")));
        if (!parsed.success) {
          console.error("fleet job is not a valid read-qwen spec");
          return 1;
        }
        // Admit only pins this host also holds, so a typo never reaches a worker as a permanent mismatch.
        const detected = detectReadQwen({ modelDir: qwenModels });
        if (!detected.ok || detected.pins.code !== parsed.data.code || canonicalJson(detected.pins.model) !== canonicalJson(parsed.data.params.model)) {
          console.error("fleet job pins do not match this host");
          return 1;
        }
        spec = parsed.data as unknown as JobSpec;
      } else {
        const photo = resolve(arg!);
        const [w, h] = dimensions(photo);
        spec = readVisionJob(
          photo,
          [{ id: "pilot", polygon: [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], rotations: [0] }],
          ocrHelperId(binary),
          { payload: null, ...(env.FLEET_SERVICE_PROFILE === "nas" ? { requires: ["apple-vision", `vision-${ocrHelperId(binary).split(":").at(-1)!.slice(0, 48)}`] } : {}) },
        );
      }
      const client = fleetClient(endpoint, "owner", token);
      if (env.FLEET_AUTO_INPUTS === "1") {
        for (const hash of spec.inputs) {
          const image = command === "enqueue" ? resolve(arg!) : images.find(hash);
          if (!image || await client.uploadInput(readFileSync(image)) !== hash) throw new Error("input-mismatch");
        }
      }
      const result = await client.enqueue(spec);
      if (!/^[a-f0-9]{64}$/.test(result.key)) throw new Error("invalid admitted key");
      mkdirSync(fleetDir, { recursive: true });
      writeFileSync(keyFile, result.key, { mode: 0o600 });
      console.log(result.created ? "fleet job enqueued" : "fleet job already enqueued");
      return 0;
    }
    if (command === "work" || command === "serve-worker") {
      if (arg === "owner" || (command === "serve-worker" && !isServiceWorker(arg))) {
        console.error("fleet work needs a worker identity");
        return 1;
      }
      const nas = env.FLEET_SERVICE_PROFILE === "nas";
      if (nas && !isServiceWorker(arg)) throw new Error("invalid-worker");
      const expectedHelper = nas ? ocrHelperId(binary) : "";
      let eligibility = { eligible: true, reason: "eligible" } as ReturnType<typeof nasEligibility>;
      const policy = () => {
        if (!nas) return mayClaim(arg!);
        eligibility = nasEligibility(arg!, fleetDir, binary, expectedHelper);
        return eligibility.eligible;
      };
      const caps = nas ? ["apple-vision"] : detectCapabilities(env);
      if (nas && (!ocrBinaryAvailable(binary) || process.platform !== "darwin")) throw new Error("helper-unavailable");
      if (nas) caps.push(`host-${arg}`);
      if (nas) caps.push(`vision-${ocrHelperId(binary).split(":").at(-1)!.slice(0, 48)}`);
      if (!caps.includes("apple-vision")) {
        console.error("fleet work needs the executable OCR helper");
        return 1;
      }
      const client = fleetClient(endpoint, arg!, token);
      let handlers: Record<string, JobHandler> = {
        "read-vision": readVisionHandler({ binary, resolveImage: (hash) => images.find(hash) }),
        ...(caps.some((c) => c.startsWith("read-qwen-"))
          ? { "read-qwen": readQwenHandler({ modelDir: qwenModels, resolveImage: (hash) => images.find(hash) }) }
          : {}),
      };
      if (env.FLEET_AUTO_INPUTS === "1") handlers = Object.fromEntries(Object.entries(handlers).map(([kind, handler]) => [kind, withFleetInputs(client, images, handler)]));
      const worker = {
        caps,
        handlers,
        outDir: join(fleetDir, "attempts"),
      };
      const releaseSlot = nas ? await acquireNasSlot() : undefined;
      try {
      if (command === "serve-worker") {
        const stop = new AbortController();
        const drain = () => stop.abort();
        process.on("SIGTERM", drain);
        process.on("SIGINT", drain);
        const statusFile = join(fleetDir, "resident-status");
        const statusTemp = `${statusFile}.${process.pid}.tmp`;
        let previousState: string | undefined;
        const recordStatus = (state: string, code?: string) => {
          const identity = `${state}:${code ?? ""}:${nas ? eligibility.reason : ""}`;
          if (identity === previousState) return;
          // Aggregate process state only. Never serialize a job, error, or environment.
          writeFileSync(statusTemp, state + "\n", { mode: 0o600 });
          renameSync(statusTemp, statusFile);
          writeFileSync(join(fleetDir, "resident-diagnostic.json"), JSON.stringify({ state, ...(nas ? { eligibility: eligibility.reason } : {}), ...(code ? { code } : {}) }), { mode: 0o600 });
          previousState = identity;
        };
        try {
          mkdirSync(fleetDir, { recursive: true });
          recordStatus("starting");
          await runWorker(client, {
            ...worker,
            signal: stop.signal,
            canClaim: () => policy(),
            onEvent: (event) => recordStatus(event.type, event.type === "request-error" ? event.code : undefined),
          });
        } finally {
          process.off("SIGTERM", drain);
          process.off("SIGINT", drain);
        }
        return 0;
      }
      if (nas && !policy()) { console.log("fleet worker paused"); return 1; }
      const result = await workOnce(client, worker);
      console.log(`fleet worker ${result}`);
      return result === "completed" ? 0 : 1;
      } finally { await releaseSlot?.(); }
    }

    const report = await fleetClient(endpoint, "owner", token).verify(readFileSync(keyFile, "utf8"));
    const worker = arg!;
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(worker)) throw new Error("invalid worker");
    const completed = report.period.byWorker[worker]?.completed ?? 0;
    console.log(`worker ${worker}: ${completed} completed`);
    console.log(`accepted output SHA-256: ${report.verified ? "matches" : "unverified"}`);
    return completed === 1 && report.verified ? 0 : 1;
  } catch (error) {
    console.error(`fleet command failed (${errorCode(error)})`);
    return 1;
  } finally {
    process.umask(previousUmask);
  }
}
