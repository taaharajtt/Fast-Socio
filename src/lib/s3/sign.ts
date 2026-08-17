import "server-only";
import crypto from "node:crypto";

/**
 * Minimal AWS SigV4 presigner for Contabo Object Storage (Ceph RGW).
 *
 * Deliberately dependency-free rather than pulling in `@aws-sdk/client-s3` +
 * `@aws-sdk/s3-request-presigner`: presigning is ~80 lines of HMAC and those
 * packages would add several MB to a server bundle we are about to start
 * shipping in a Docker image ourselves.
 *
 * Contabo quirks this encodes, both found by probing the live endpoint:
 *  - Path-style addressing only (no virtual-host buckets).
 *  - The canonical URI must URI-encode each path segment (`:` -> `%3A`) while
 *    keeping `/` separators, otherwise the tenant-prefixed form used by the
 *    public base URL fails with SignatureDoesNotMatch.
 *
 * The access key and secret are read here and NEVER leave the server — the
 * whole point of the presign design is that the browser receives a URL that is
 * scoped to one object, one method, and a short expiry, not a credential.
 */

const ENDPOINT = process.env.CONTABO_S3_ENDPOINT?.replace(/\/$/, "") ?? "";
const REGION = process.env.CONTABO_S3_REGION ?? "";
const BUCKET = process.env.CONTABO_S3_BUCKET ?? "";
const ACCESS_KEY = process.env.CONTABO_S3_ACCESS_KEY_ID ?? "";
const SECRET_KEY = process.env.CONTABO_S3_SECRET_ACCESS_KEY ?? "";

/** True when the S3 layer is fully configured; lets callers degrade instead of throwing. */
export const s3Configured = Boolean(ENDPOINT && REGION && BUCKET && ACCESS_KEY && SECRET_KEY);

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key: crypto.BinaryLike, data: string) =>
  crypto.createHmac("sha256", key).update(data).digest();

function encodePath(pathname: string): string {
  return pathname.split("/").map(encodeURIComponent).join("/");
}

function signingKey(dateStamp: string): Buffer {
  let key = hmac(`AWS4${SECRET_KEY}`, dateStamp);
  key = hmac(key, REGION);
  key = hmac(key, "s3");
  return hmac(key, "aws4_request");
}

/**
 * Build a presigned URL for a single object and HTTP method.
 *
 * `expiresInSeconds` is capped at 7 days by SigV4 itself; callers should pass
 * the shortest lifetime that works, because anyone holding the URL can use it.
 */
export function presign(
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string,
  expiresInSeconds: number,
  extraQuery: Record<string, string> = {}
): string {
  if (!s3Configured) throw new Error("Contabo S3 is not configured.");

  // An empty key addresses the bucket itself (used for LIST).
  const pathname = key ? `/${BUCKET}/${key}` : `/${BUCKET}`;
  const url = new URL(ENDPOINT + pathname);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;

  const query: Record<string, string> = {
    ...extraQuery,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${ACCESS_KEY}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");

  const canonicalPath = encodePath(pathname);
  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", signingKey(dateStamp))
    .update(stringToSign)
    .digest("hex");

  return `${url.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Presigned PUT for a browser upload. Short-lived: the client uploads immediately. */
export function presignUpload(prefix: string, path: string, expiresInSeconds = 300): string {
  return presign("PUT", `${prefix}/${path}`, expiresInSeconds);
}

/** Presigned GET for a private object (chat-media). */
export function presignDownload(prefix: string, path: string, expiresInSeconds = 3600): string {
  return presign("GET", `${prefix}/${path}`, expiresInSeconds);
}

/**
 * List the object keys under `prefix/folder`.
 *
 * Replaces `storage.from(bucket).list(folder)`. Returns keys RELATIVE to the
 * prefix, matching what the Supabase call used to return, so callers keep
 * thinking in bucket-relative paths.
 */
export async function listObjects(prefix: string, folder: string): Promise<string[]> {
  if (!s3Configured) return [];
  const search = `${prefix}/${folder}`.replace(/\/$/, "") + "/";
  const url = presign("GET", "", 60, {
    "list-type": "2",
    prefix: search,
    "max-keys": "1000",
  });
  const res = await fetch(url);
  if (!res.ok) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)]
    .map((m) => m[1])
    .map((key) => key.slice(prefix.length + 1))
    .filter(Boolean);
}

/**
 * Delete objects. Used by account deletion, which must remove a user's media
 * along with their row — S3 has no cascade, so this is the only thing standing
 * between a deleted account and its files living on indefinitely.
 */
export async function deleteObjects(prefix: string, paths: string[]): Promise<void> {
  if (!s3Configured || paths.length === 0) return;
  await Promise.all(
    paths.map(async (path) => {
      const url = presign("DELETE", `${prefix}/${path}`, 60);
      await fetch(url, { method: "DELETE" });
    })
  );
}

/**
 * Server-side object metadata via HEAD, used to re-verify an upload's ACTUAL
 * content type after the fact.
 *
 * This replaces the `storage.list()` MIME re-check the chat/community actions
 * do today: a presigned PUT carries the content type the CLIENT declared, so
 * declaring `image/png` and uploading something else is trivial. Callers that
 * attach media to a message must confirm what actually landed.
 */
export async function headObject(
  prefix: string,
  path: string
): Promise<{ contentType: string | null; contentLength: number | null } | null> {
  if (!s3Configured) return null;
  // The method is part of the signature, so a URL presigned for GET is NOT
  // valid for a HEAD request — Ceph rejects it as SignatureDoesNotMatch.
  const url = presign("HEAD", `${prefix}/${path}`, 60);
  const res = await fetch(url, { method: "HEAD" });
  if (!res.ok) return null;
  const length = res.headers.get("content-length");
  return {
    contentType: res.headers.get("content-type"),
    contentLength: length ? Number(length) : null,
  };
}
