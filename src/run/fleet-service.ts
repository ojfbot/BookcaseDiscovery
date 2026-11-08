import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const label = "org.bookcasediscovery.fleet-worker";
const entry = fileURLToPath(new URL("../../bin/bookcase", import.meta.url));
const usage = "usage: bookcase fleet service <install yuri|yojimbo | start | stop | status>";

export function isServiceWorker(worker: string | undefined): worker is "yuri" | "yojimbo" {
  return worker === "yuri" || worker === "yojimbo";
}

function plistString(value: string): string {
  if (/[\u0000-\u001f]/u.test(value)) throw new Error("invalid config value");
  const escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<string>${escaped}</string>`;
}

export function workerPlist(node: string, worker: string, env: NodeJS.ProcessEnv): string {
  const values = {
    BOOKCASE_DATA: env.BOOKCASE_DATA,
    BOOKCASE_OCR_VISION: env.BOOKCASE_OCR_VISION,
    FLEET_TOKEN_FILE: env.FLEET_TOKEN_FILE,
    FLEET_ENDPOINT: env.FLEET_ENDPOINT,
    ...(env.FLEET_SERVICE_PROFILE === "nas" ? {
      FLEET_SERVICE_PROFILE: "nas",
      FLEET_AUTO_INPUTS: "1",
      FLEET_KINDS: "read-vision",
      NODE_EXTRA_CA_CERTS: env.NODE_EXTRA_CA_CERTS,
    } : {}),
  };
  for (const path of [node, values.BOOKCASE_DATA, values.BOOKCASE_OCR_VISION, values.FLEET_TOKEN_FILE]) {
    if (!path || !isAbsolute(path)) throw new Error("service paths must be absolute");
  }
  if (!isServiceWorker(worker) || !values.FLEET_ENDPOINT) throw new Error("invalid service configuration");
  const endpoint = new URL(values.FLEET_ENDPOINT);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
      endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error("invalid service endpoint");
  }
  if (env.FLEET_SERVICE_PROFILE === "nas" && (endpoint.protocol !== "https:" || !values.NODE_EXTRA_CA_CERTS || !isAbsolute(values.NODE_EXTRA_CA_CERTS)))
    throw new Error("NAS service requires trusted TLS");
  const args = [node, entry, "fleet", "serve-worker", worker].map(plistString).join("\n");
  const environment = Object.entries(values)
    .map(([name, value]) => `<key>${name}</key>${plistString(value!)}`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}${env.FLEET_SERVICE_PROFILE === "nas" ? ".nas" : ""}</string>
<key>ProgramArguments</key><array>
${args}
</array>
<key>EnvironmentVariables</key><dict>
${environment}
</dict>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ExitTimeOut</key><integer>240</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`;
}

type Launch = (args: readonly string[]) => string | undefined;

function launchctl(args: readonly string[]): string | undefined {
  try {
    const captureStatus = args[0] === "print" && args[1]?.split("/").length === 3;
    return execFileSync("/bin/launchctl", args, {
      encoding: "utf8",
      stdio: ["ignore", captureStatus ? "pipe" : "ignore", "ignore"],
      timeout: args[0] === "bootout" ? 250_000 : 10_000,
    }) ?? "";
  } catch {
    return undefined;
  }
}

export function workerService(
  argv: string[],
  env: NodeJS.ProcessEnv,
  local = { launch: launchctl, home: homedir(), uid: process.getuid?.(), node: process.execPath, platform: process.platform },
): number {
  const [command, worker, extra] = argv;
  const install = command === "install";
  if (command === "--help" || command === "-h") {
    console.log(usage);
    return 0;
  }
  if (extra || (install ? !isServiceWorker(worker) : worker || !["start", "stop", "status"].includes(command ?? ""))) {
    console.error(usage);
    return 1;
  }
  try {
    if (env.FLEET_SERVICE_PROFILE && env.FLEET_SERVICE_PROFILE !== "nas") throw new Error("invalid service profile");
    const serviceLabel = label + (env.FLEET_SERVICE_PROFILE === "nas" ? ".nas" : "");
    if (local.platform !== "darwin" || !local.uid) throw new Error("requires macOS user session");
    const domain = `gui/${local.uid}`;
    const target = `${domain}/${serviceLabel}`;
    const file = join(local.home, "Library", "LaunchAgents", `${serviceLabel}.plist`);
    const launch: Launch = local.launch;
    if (launch(["print", domain]) === undefined) throw new Error("GUI domain unavailable");
    const status = launch(["print", target]);
    const requireLaunch = (args: string[]) => {
      if (launch(args) === undefined) throw new Error("launchctl failed");
    };
    if (install) {
      if (status !== undefined) {
        console.error("stop the fleet worker service before installing");
        return 1;
      }
      const node = realpathSync(local.node);
      const plist = workerPlist(node, worker!, env);
      const token = statSync(env.FLEET_TOKEN_FILE!);
      if (!statSync(env.BOOKCASE_DATA!).isDirectory() || !token.isFile() || (token.mode & 0o077) !== 0)
        throw new Error("worker paths unavailable");
      accessSync(env.FLEET_TOKEN_FILE!, constants.R_OK);
      accessSync(env.BOOKCASE_OCR_VISION!, constants.X_OK);
      accessSync(node, constants.X_OK);
      requireLaunch(["disable", target]);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, plist, { flag: "wx", mode: 0o600 });
      try {
        renameSync(temp, file);
      } finally {
        rmSync(temp, { force: true });
      }
      console.log("fleet worker service installed");
    } else if (command === "start") {
      accessSync(file, constants.R_OK);
      requireLaunch(["enable", target]);
      if (status === undefined && launch(["bootstrap", domain, file]) === undefined) {
        requireLaunch(["disable", target]);
        throw new Error("worker failed to load");
      }
      console.log("fleet worker service started");
    } else if (command === "stop") {
      requireLaunch(["disable", target]);
      if (status !== undefined) requireLaunch(["bootout", target]);
      console.log("fleet worker service stopped");
    } else {
      const state = status?.match(/^\s*state = (running|spawn scheduled|waiting|not running)\s*$/m)?.[1];
      console.log(`fleet worker service ${state ?? (status === undefined ? "not loaded" : "loaded")}`);
      if (state === "running" && env.BOOKCASE_DATA && isAbsolute(env.BOOKCASE_DATA)) {
        const outcomeFile = join(env.BOOKCASE_DATA, "fleet", "resident-status");
        if (!existsSync(outcomeFile)) return 0;
        const workerState = readFileSync(outcomeFile, {
          encoding: "utf8",
          flag: "r",
        }).trim();
        if (/^(starting|completed|idle|paused|policy-error|request-error|failed|lease-lost)$/.test(workerState))
          console.log(`fleet worker outcome ${workerState}`);
      }
    }
    return 0;
  } catch {
    console.error("fleet worker service operation failed");
    return 1;
  }
}
