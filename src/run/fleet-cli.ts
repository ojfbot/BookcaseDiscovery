import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { dataRoot, ImageStore } from "../ledger/images.ts";
import { defaultOcrBinary } from "../perceive/ocr.ts";
import { detectCapabilities, ocrHelperId, readVisionHandler, readVisionJob } from "./job-kinds.ts";
import { generateToken } from "./vendor/fleet-runner/auth.ts";
import { fleetClient } from "./vendor/fleet-runner/client.ts";
import { workOnce } from "./vendor/fleet-runner/worker.ts";

const usage = "usage: bookcase fleet <keygen | stage PHOTO | enqueue PHOTO | work WORKER | verify WORKER>";

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
  const [command, arg] = argv;
  const root = dataRoot(env);
  const fleetDir = join(root, "fleet");
  const images = new ImageStore(root);
  const token = env.FLEET_TOKEN_FILE;
  const endpoint = env.FLEET_ENDPOINT;
  if (command === "--help" || command === "-h") {
    console.log(usage);
    return 0;
  }
  const arity = command === "keygen" ? 1 : 2;
  if (!["keygen", "stage", "enqueue", "work", "verify"].includes(command ?? "") || argv.length !== arity) {
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
    if (!token || !endpoint) throw new Error("missing fleet configuration");
    const binary = defaultOcrBinary(env);
    const keyFile = join(fleetDir, "job-key");
    if (command === "enqueue") {
      const photo = resolve(arg!);
      const [w, h] = dimensions(photo);
      const spec = readVisionJob(
        photo,
        [{ id: "pilot", polygon: [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], rotations: [0] }],
        ocrHelperId(binary),
        { payload: null },
      );
      const result = await fleetClient(endpoint, "owner", token).enqueue(spec);
      if (!/^[a-f0-9]{64}$/.test(result.key)) throw new Error("invalid admitted key");
      mkdirSync(fleetDir, { recursive: true });
      writeFileSync(keyFile, result.key, { mode: 0o600 });
      console.log(result.created ? "fleet job enqueued" : "fleet job already enqueued");
      return 0;
    }
    if (command === "work") {
      const caps = detectCapabilities(env);
      if (!caps.includes("apple-vision")) {
        console.error("fleet work needs the executable OCR helper");
        return 1;
      }
      const result = await workOnce(fleetClient(endpoint, arg!, token), {
        caps,
        handlers: { "read-vision": readVisionHandler({ binary, resolveImage: (hash) => images.find(hash) }) },
        outDir: join(fleetDir, "attempts"),
      });
      console.log(`fleet worker ${result}`);
      return result === "completed" ? 0 : 1;
    }

    const report = await fleetClient(endpoint, "owner", token).verify(readFileSync(keyFile, "utf8"));
    const worker = arg!;
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(worker)) throw new Error("invalid worker");
    const completed = report.period.byWorker[worker]?.completed ?? 0;
    console.log(`worker ${worker}: ${completed} completed`);
    console.log(`accepted output SHA-256: ${report.verified ? "matches" : "unverified"}`);
    return completed === 1 && report.verified ? 0 : 1;
  } catch {
    console.error("fleet command failed");
    return 1;
  } finally {
    process.umask(previousUmask);
  }
}
