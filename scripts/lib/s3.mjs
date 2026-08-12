// Minimal SigV4 client for Contabo Object Storage, shared by the migration
// scripts. Kept separate from src/lib/s3/sign.ts because these run as plain
// node scripts outside the Next.js build, but the signing rules are identical:
// path-style addressing, and each path segment URI-encoded so the tenant-
// prefixed form does not fail with SignatureDoesNotMatch.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function loadEnv(file = ".env.local") {
  const full = path.resolve(process.cwd(), file);
  return Object.fromEntries(
    fs.readFileSync(full, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "").trim()];
      })
  );
}

const sha256 = (x) => crypto.createHash("sha256").update(x).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();

export function makeS3(env) {
  const ENDPOINT = env.CONTABO_S3_ENDPOINT.replace(/\/$/, "");
  const REGION = env.CONTABO_S3_REGION;
  const BUCKET = env.CONTABO_S3_BUCKET;
  const AK = env.CONTABO_S3_ACCESS_KEY_ID;
  const SK = env.CONTABO_S3_SECRET_ACCESS_KEY;

  function sign(method, key, query = {}, payloadHash = "UNSIGNED-PAYLOAD") {
    const pathname = key ? `/${BUCKET}/${key}` : `/${BUCKET}`;
    const url = new URL(ENDPOINT + pathname);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const cq = Object.keys(query).sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&");
    const ch = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const sh = "host;x-amz-content-sha256;x-amz-date";
    const cp = pathname.split("/").map(encodeURIComponent).join("/");
    const cr = [method, cp, cq, ch, sh, payloadHash].join("\n");
    const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
    const sts = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(cr)].join("\n");
    let k = hmac("AWS4" + SK, dateStamp);
    k = hmac(k, REGION); k = hmac(k, "s3"); k = hmac(k, "aws4_request");
    const sig = crypto.createHmac("sha256", k).update(sts).digest("hex");
    return {
      url: url.origin + cp + (cq ? "?" + cq : ""),
      headers: {
        authorization: `AWS4-HMAC-SHA256 Credential=${AK}/${scope}, SignedHeaders=${sh}, Signature=${sig}`,
        "x-amz-date": amzDate,
        "x-amz-content-sha256": payloadHash,
      },
    };
  }

  return {
    /** HEAD one object; null when absent. Used to make the copy resumable. */
    async head(key) {
      const { url, headers } = sign("HEAD", key);
      const res = await fetch(url, { method: "HEAD", headers });
      if (!res.ok) return null;
      const len = res.headers.get("content-length");
      return { size: len ? Number(len) : null, etag: res.headers.get("etag")?.replace(/"/g, "") ?? null };
    },

    /** PUT one object. The body is hashed so the payload is signed, not UNSIGNED. */
    async put(key, body, contentType) {
      const hash = crypto.createHash("sha256").update(body).digest("hex");
      const { url, headers } = sign("PUT", key, {}, hash);
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": contentType || "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
        },
        body,
      });
      if (!res.ok) throw new Error(`PUT ${key} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
      return res.headers.get("etag")?.replace(/"/g, "") ?? null;
    },

    /** List every key under a prefix, following continuation tokens. */
    async listAll(prefix) {
      const keys = [];
      let token;
      do {
        const query = { "list-type": "2", prefix, "max-keys": "1000" };
        if (token) query["continuation-token"] = token;
        const { url, headers } = sign("GET", "", query);
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`LIST -> ${res.status}`);
        const xml = await res.text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
        token = /<NextContinuationToken>([^<]+)</.exec(xml)?.[1];
      } while (token);
      return keys;
    },
  };
}
