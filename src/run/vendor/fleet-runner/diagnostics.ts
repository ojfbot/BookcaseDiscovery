import { FleetHttpError } from "./client.ts";

const CODES = new Set([
  "EACCES",
  "EPERM",
  "EROFS",
  "ENOENT",
  "ENOSPC",
  "EIO",
  "EADDRINUSE",
  "EADDRNOTAVAIL",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ERR_SQLITE_ERROR",
  "ERR_SSL_PEM_BAD_BASE64_DECODE",
  "ERR_OSSL_PEM_NO_START_LINE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Deliberately excludes error messages, stacks, response bodies and filesystem paths. */
export function errorCode(error: unknown): string {
  if (error instanceof FleetHttpError) return `http-${error.status}`;
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error && typeof error === "object") {
    if ("code" in error && typeof error.code === "string" && CODES.has(error.code))
      return error.code;
    if ("cause" in error && error.cause !== error) return errorCode(error.cause);
  }
  if (error instanceof Error && /^job table schema [0-9]+, expected [0-9]+$/.test(error.message))
    return "schema-incompatible";
  return "unexpected-error";
}
