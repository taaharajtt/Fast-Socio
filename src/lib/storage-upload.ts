import { createClient } from "@/lib/supabase/client";
import { compressImageTo1080p } from "@/lib/image-compression";

/**
 * Upload a blob to Supabase Storage with real progress events (UAT-004).
 *
 * `supabase.storage.upload()` resolves only once, with no progress — it wraps
 * fetch, which can't report upload progress in browsers. So we PUT straight to
 * the Storage REST endpoint via XHR, whose `upload.onprogress` gives byte-level
 * progress for the loading bar. RLS on `storage.objects` still applies: the
 * request carries the user's access token, exactly like the SDK call it
 * replaces, so the same bucket policies gate it.
 */
export type UploadProgress = { loaded: number; total: number; percent: number };

export async function uploadWithProgress(
  bucket: string,
  path: string,
  blob: Blob,
  opts: {
    contentType?: string;
    upsert?: boolean;
    onProgress?: (p: UploadProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{ path: string }> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("You are not signed in.");

  // Every image upload (chat attachments, post media, avatars, community/
  // society covers) is scaled to ~1080p and re-compressed before it ever
  // reaches Storage — the cropper already does its own capped export, but
  // uncropped images (raw attachments, avatar picks) had no size limit at all.
  let uploadBlob = blob;
  const contentType = opts.contentType ?? blob.type;
  if (contentType.startsWith("image/") && contentType !== "image/svg+xml") {
    try {
      uploadBlob = await compressImageTo1080p(blob);
    } catch {
      uploadBlob = blob; // Decoding failed (corrupt/unsupported) — upload as-is.
    }
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const url = `${base}/storage/v1/object/${bucket}/${encodeURI(path)}`;

  return new Promise<{ path: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // POST inserts, PUT upserts — mirrors the SDK's own routing.
    xhr.open(opts.upsert ? "PUT" : "POST", url);
    xhr.setRequestHeader("authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", anon);
    // Compression can change the encoded format (e.g. a non-alpha PNG becomes
    // JPEG), so the header must reflect uploadBlob's actual type, not the
    // caller's original guess.
    xhr.setRequestHeader("content-type", uploadBlob.type || opts.contentType || contentType);
    xhr.setRequestHeader("x-upsert", opts.upsert ? "true" : "false");
    // Every current caller (avatars, post-media, chat-media) embeds a
    // Date.now()/crypto.randomUUID() token in the path itself, so the object
    // at this exact path never changes after it's written — safe to cache as
    // long-lived and immutable. `upsert` here only guards a same-millisecond
    // retry, not a stable path meant to be overwritten. If a future caller
    // ever uploads to a STABLE, reused path (e.g. no per-upload token), it
    // must not go through this header, or the old bytes will keep serving
    // from cache after the overwrite.
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
        // Storage returns a JSON { message } on failure.
        let message = `Upload failed (${xhr.status}).`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.message) message = body.message;
        } catch {
          /* keep the generic message */
        }
        reject(new Error(message));
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

/** Public URL for an object in a public bucket, without another round-trip. */
export function publicStorageUrl(bucket: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}
