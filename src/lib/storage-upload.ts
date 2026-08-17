import { compressImageTo1080p } from "@/lib/image-compression";
import { publicObjectUrl, type StoragePrefix } from "@/lib/s3/buckets";

/**
 * Upload a blob to Contabo Object Storage with real progress events.
 *
 * Two-step, because plain S3 has no per-user authorization: we ask our own
 * server to authorize this exact object and mint a short-lived presigned PUT,
 * then PUT the bytes straight to Contabo. The server-side checks in
 * `/api/storage/presign` stand in for the RLS policies that used to gate the
 * equivalent request to Supabase Storage.
 *
 * Progress still comes from XHR rather than fetch — `upload.onprogress` is the
 * only way a browser reports byte-level upload progress, and the loading bar
 * depends on it. (UAT-004.)
 */
export type UploadProgress = { loaded: number; total: number; percent: number };

export async function uploadWithProgress(
  prefix: StoragePrefix,
  path: string,
  blob: Blob,
  opts: {
    contentType?: string;
    onProgress?: (p: UploadProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{ path: string }> {
  // Every image upload (chat attachments, post media, avatars, community/
  // society covers) is scaled to ~1080p and re-compressed before it ever
  // leaves the browser — the cropper already does its own capped export, but
  // uncropped images (raw attachments, avatar picks) had no size limit at all.
  let uploadBlob = blob;
  const declaredType = opts.contentType ?? blob.type;
  if (declaredType.startsWith("image/") && declaredType !== "image/svg+xml") {
    try {
      uploadBlob = await compressImageTo1080p(blob);
    } catch {
      uploadBlob = blob; // Decoding failed (corrupt/unsupported) — upload as-is.
    }
  }

  // Compression can change the encoded format (e.g. a non-alpha PNG becomes
  // JPEG), so everything from here on must use the FINAL blob's type and size,
  // not the caller's original guess — the server validates what we declare
  // against the prefix's allow-list and size cap.
  const contentType = uploadBlob.type || declaredType;

  const presignRes = await fetch("/api/storage/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix, path, contentType, sizeBytes: uploadBlob.size }),
    signal: opts.signal,
  });
  if (!presignRes.ok) {
    const body = await presignRes.json().catch(() => null);
    throw new Error(body?.error ?? `Upload was refused (${presignRes.status}).`);
  }
  const { uploadUrl } = (await presignRes.json()) as { uploadUrl: string };

  return new Promise<{ path: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("content-type", contentType);
    // Every current caller embeds a Date.now()/crypto.randomUUID() token in the
    // path itself, so the object at this exact path never changes after it is
    // written — safe to cache as long-lived and immutable. If a future caller
    // ever uploads to a STABLE, reused path, it must not go through this
    // header, or the old bytes will keep serving from cache after the overwrite.
    xhr.setRequestHeader("cache-control", "public, max-age=31536000, immutable");

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !opts.onProgress) return;
      opts.onProgress({
        loaded: e.loaded,
        total: e.total,
        percent: Math.min(100, Math.round((e.loaded / e.total) * 100)),
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.({ loaded: uploadBlob.size, total: uploadBlob.size, percent: 100 });
        resolve({ path });
      } else {
        // S3 returns an XML <Error><Code>… body on failure, not JSON.
        const code = /<Code>([^<]+)<\/Code>/.exec(xhr.responseText)?.[1];
        reject(new Error(code ? `Upload failed (${code}).` : `Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));

    if (opts.signal) {
      if (opts.signal.aborted) return xhr.abort();
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(uploadBlob);
  });
}

/** Public URL for an object under a publicly-readable prefix. */
export function publicStorageUrl(prefix: StoragePrefix, path: string): string {
  return publicObjectUrl(prefix, path);
}
