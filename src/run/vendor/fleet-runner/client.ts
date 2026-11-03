import { signer } from "./auth.ts";
import type { Claim, JobEvent, JobReport, JobSpec } from "./jobs.js";

type Lease = Pick<Claim, "key" | "fence">;

export function fleetClient(endpoint: string, id: string, tokenFile: string) {
  const base = new URL(endpoint);
  if (
    base.protocol !== "http:" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("invalid fleet endpoint");
  }
  const authorize = signer(id, tokenFile);

  async function request<T>(target: string, data?: object): Promise<T> {
    const method = data === undefined ? "GET" : "POST";
    const body = Buffer.from(data === undefined ? "" : JSON.stringify(data));
    const authorization = authorize(method, target, body);
    const res = await fetch(new URL(target, base), {
      method,
      ...(data === undefined ? {} : { body: new Uint8Array(body) }),
      headers: { authorization, "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`fleet HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    enqueue: (spec: JobSpec) => request<{ key: string; created: boolean }>("/enqueue", spec),
    claim: async (caps: readonly string[], kinds: readonly string[]) => {
      const job = await request<Claim | null>("/claim", { caps, kinds });
      if (
        job !== null &&
        (!/^[a-f0-9]{64}$/.test(job.key) ||
          !Number.isSafeInteger(job.fence) ||
          job.fence < 1 ||
          !kinds.includes(job.kind))
      ) {
        throw new Error("invalid fleet claim");
      }
      return job;
    },
    heartbeat: ({ key, fence }: Lease) => request<boolean>("/heartbeat", { key, fence }),
    release: ({ key, fence }: Lease) => request<boolean>("/release", { key, fence }),
    fail: ({ key, fence }: Lease, code: string, retryable: boolean) =>
      request<boolean>("/fail", { key, fence, code, retryable }),
    complete: ({ key, fence }: Lease, bytes: Buffer, sha256: string) =>
      request<boolean>("/complete", { key, fence, sha256, output: bytes.toString("base64") }),
    events: (after = 0) => request<JobEvent[]>(`/events?after=${after}`),
    report: (since = 0) => request<JobReport>(`/report?since=${since}`),
    verify: (key: string) =>
      request<JobReport & { verified: boolean }>(`/report?verify=${encodeURIComponent(key)}`),
  };
}

export type FleetClient = ReturnType<typeof fleetClient>;
