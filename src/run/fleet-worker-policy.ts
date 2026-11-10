import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const chicagoClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "2-digit",
  hourCycle: "h23",
});

export function yuriMayClaim(now: Date, powerSource: () => string): boolean {
  try {
    const hour = Number(chicagoClock.formatToParts(now).find((part) => part.type === "hour")?.value);
    if (!(hour >= 20 || hour < 7)) return false;
    const sources = powerSource().split(/\r?\n/).filter((line) => line.startsWith("Now drawing from "));
    return sources.length === 1 && sources[0] === "Now drawing from 'AC Power'";
  } catch {
    return false;
  }
}

export function mayClaim(worker: string): boolean {
  return worker !== "yuri" || yuriMayClaim(new Date(), () =>
    execFileSync("/usr/bin/pmset", ["-g", "batt"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }),
  );
}

const chicagoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

/** Owner-created NAS-only exception; expires within the current Chicago day, always requires AC. */
export function daytimeMayClaim(file: string, now: Date, powerSource: () => string): boolean {
  try {
    const { until } = JSON.parse(readFileSync(file, "utf8")) as { until: string };
    const expiry = Date.parse(until);
    if (!Number.isFinite(expiry) || expiry <= now.getTime() || expiry - now.getTime() > 86_400_000 ||
      chicagoDay.format(new Date(expiry - 1)) !== chicagoDay.format(now)) return false;
    const sources = powerSource().split(/\r?\n/).filter(line => line.startsWith("Now drawing from "));
    return sources.length === 1 && sources[0] === "Now drawing from 'AC Power'";
  } catch { return false; }
}

export function nasMayClaim(worker: string, exception: string): boolean {
  return mayClaim(worker) || (worker === "yuri" && daytimeMayClaim(exception, new Date(), () =>
    execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 }),
  ));
}
