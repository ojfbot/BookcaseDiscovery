import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ID = /^[a-z][a-z0-9-]{0,62}$/;
const WINDOW_MS = 60_000;

export interface RequestNonce {
  identity: string;
  nonce: string;
  now: number;
  expiresAt: number;
}

export type ConsumeNonce = (candidate: RequestNonce) => boolean;

/** Reject unknown identities and stale/malformed headers before allocating an upload. */
export function prepareAuthorization(registry: string, authorization: string | undefined) {
  const match =
    /^Fleet ([a-z][a-z0-9-]{0,62})\.([0-9]{13})\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{86})$/.exec(
      authorization ?? "",
    );
  if (!match) return undefined;
  const [, id, ts, nonce, signature] = match as unknown as [string, string, string, string, string];
  if (Math.abs(Date.now() - Number(ts)) >= WINDOW_MS) return undefined;
  try {
    const key = createPublicKey(readFileSync(join(registry, `${id}.pub`)));
    if (key.asymmetricKeyType === "ed25519") return { id, ts, nonce, signature, key };
  } catch {
    /* Unknown or invalid public key. Never expose a registry path. */
  }
  return undefined;
}

export function generateToken(file: string): void {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(file, privateKey.export({ format: "pem", type: "pkcs8" }), {
    mode: 0o600,
    flag: "wx",
  });
  writeFileSync(`${file}.pub`, publicKey.export({ format: "pem", type: "spki" }), { flag: "wx" });
}

function message(
  id: string,
  method: string,
  target: string,
  ts: string,
  nonce: string,
  body: Uint8Array,
): Buffer {
  const digest = createHash("sha256").update(body).digest("hex");
  return Buffer.from(JSON.stringify([id, method, target, ts, nonce, digest]));
}

export function signer(id: string, tokenFile: string) {
  if (!ID.test(id)) throw new Error("invalid identity");
  const key = createPrivateKey(readFileSync(tokenFile));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid token type");
  return (method: string, target: string, body: Uint8Array): string => {
    const ts = String(Date.now());
    const nonce = randomUUID();
    const signature = sign(null, message(id, method, target, ts, nonce, body), key).toString(
      "base64url",
    );
    return `Fleet ${id}.${ts}.${nonce}.${signature}`;
  };
}

export function verifier(registry: string, consumeNonce: ConsumeNonce) {
  return (
    authorization: string | undefined,
    method: string,
    target: string,
    body: Uint8Array,
  ): string | undefined => {
    const candidate = prepareAuthorization(registry, authorization);
    if (!candidate) return undefined;
    const { id, ts, nonce, signature, key } = candidate;
    const now = Date.now();
    if (Math.abs(now - Number(ts)) >= WINDOW_MS) return undefined;
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        message(id, method, target, ts, nonce, body),
        key,
        Buffer.from(signature, "base64url"),
      )
    ) {
      return undefined;
    }
    return consumeNonce({ identity: id, nonce, now, expiresAt: Number(ts) + WINDOW_MS })
      ? id
      : undefined;
  };
}
