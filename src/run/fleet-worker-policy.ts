import { execFileSync } from "node:child_process";

const chicagoClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "2-digit",
  hourCycle: "h23",
});

export function yuriMayClaim(now: Date, powerSource: () => string, daytimeUntil?: string): boolean {
  try {
    const hour = Number(chicagoClock.formatToParts(now).find((part) => part.type === "hour")?.value);
    const deadline = daytimeUntil && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(daytimeUntil)
      ? Date.parse(daytimeUntil)
      : NaN;
    if (!(hour >= 20 || hour < 7 || now.getTime() < deadline)) return false;
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
    process.env.FLEET_YURI_DAYTIME_UNTIL,
  );
}
