import { signer } from "./auth.ts";
import type { PublicEvent, ServiceSnapshot, WorkerControl, WorkerObservation } from "./status.ts";
import type { Claim, JobEvent, JobReport, JobSpec } from "./jobs.js";
import { INPUT_HASH, MAX_INPUT_BYTES, inputHash } from "./inputs.ts";

type Lease = Pick<Claim, "key" | "fence">;

export class FleetHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`fleet HTTP ${status}`);
    this.status = status;
  }
  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export function fleetClient(endpoint: string, id: string, tokenFile: string, generation?: string) {
  const base = new URL(endpoint);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("invalid fleet endpoint");
  }
  const authorize = signer(id, tokenFile);
  const bindGeneration = (target: string) =>
    generation
      ? `${target}${target.includes("?") ? "&" : "?"}generation=${encodeURIComponent(generation)}`
      : target;

  async function transfer(target: string, body?: Uint8Array, signal?: AbortSignal) {
    target = bindGeneration(target);
    const method = body === undefined ? "GET" : "POST";
    const res = await fetch(new URL(target, base), {
      method,
      ...(body === undefined ? {} : { body: new Uint8Array(body) }),
      headers: {
        authorization: authorize(method, target, body ?? Buffer.alloc(0)),
        "content-type": "application/octet-stream",
      },
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new FleetHttpError(res.status);
    }
    return res;
  }

  async function request<T>(target: string, data?: object, signal?: AbortSignal): Promise<T> {
    target = bindGeneration(target);
    const method = data === undefined ? "GET" : "POST";
    const body = Buffer.from(data === undefined ? "" : JSON.stringify(data));
    const authorization = authorize(method, target, body);
    const res = await fetch(new URL(target, base), {
      method,
      ...(data === undefined ? {} : { body: new Uint8Array(body) }),
      headers: { authorization, "content-type": "application/json" },
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new FleetHttpError(res.status);
    }
    return (await res.json()) as T;
  }

  return {
    status: (signal?: AbortSignal) => request<ServiceSnapshot>("/status", undefined, signal),
    statusEvents: (after = 0) =>
      request<{ schemaVersion: 1; cursor: number; events: PublicEvent[]; hasMore: boolean }>(
        `/status/events?after=${after}`,
      ),
    workerControl: (signal?: AbortSignal) =>
      request<WorkerControl>("/worker-control", undefined, signal),
    control: (worker: string, action: "pause" | "drain" | "resume") =>
      request<WorkerControl>("/control", { worker, action }),
    releaseRecoveryHold: (recoveryPoint: string) =>
      request<{ released: boolean }>("/recovery/release", { generation, recoveryPoint }),
    presence: (observation: WorkerObservation, signal?: AbortSignal) =>
      request<{ received: boolean }>("/worker-status", observation, signal),
    uploadInput: async (bytes: Uint8Array) => {
      if (bytes.length > MAX_INPUT_BYTES) throw new Error("input-too-large");
      const hash = inputHash(bytes);
      const response = await transfer(`/inputs/${hash}`, bytes);
      await response.body?.cancel();
      return hash;
    },
    downloadInput: async ({ key, fence }: Lease, hash: string, signal?: AbortSignal) => {
      if (
        !INPUT_HASH.test(hash) ||
        !INPUT_HASH.test(key) ||
        !Number.isSafeInteger(fence) ||
        fence < 1
      )
        throw new Error("invalid-input-request");
      const response = await transfer(
        `/inputs/${hash}?key=${key}&fence=${fence}`,
        undefined,
        signal,
      );
      const chunks: Buffer[] = [];
      let size = 0;
      const reader = response.body!.getReader();
      try {
        if (Number(response.headers.get("content-length")) > MAX_INPUT_BYTES)
          throw new Error("input-too-large");
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_INPUT_BYTES) throw new Error("input-too-large");
          chunks.push(Buffer.from(value));
        }
        const bytes = Buffer.concat(chunks, size);
        if (inputHash(bytes) !== hash) throw new Error("input-mismatch");
        return bytes;
      } finally {
        await reader.cancel().catch(() => {});
      }
    },
    enqueue: (spec: JobSpec) => request<{ key: string; created: boolean }>("/enqueue", spec),
    claim: async (caps: readonly string[], kinds: readonly string[]) => {
      const job = await request<Claim | null>("/claim", { caps, kinds });
      if (
        job !== null &&
        (!/^[a-f0-9]{64}$/.test(job.key) ||
          !Number.isSafeInteger(job.fence) ||
          job.fence < 1 ||
          !kinds.includes(job.kind) ||
          !Number.isSafeInteger(job.leaseExpires))
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
