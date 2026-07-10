import { createClient } from "@/lib/supabase/client";

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

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const url = `${base}/storage/v1/object/${bucket}/${encodeURI(path)}`;

  return new Promise<{ path: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // POST inserts, PUT upserts — mirrors the SDK's own routing.
    xhr.open(opts.upsert ? "PUT" : "POST", url);
    xhr.setRequestHeader("authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", anon);
    if (opts.contentType) xhr.setRequestHeader("content-type", opts.contentType);
    xhr.setRequestHeader("x-upsert", opts.upsert ? "true" : "false");
    xhr.setRequestHeader("cache-control", "3600");

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
        opts.onProgress?.({ loaded: blob.size, total: blob.size, percent: 100 });
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

    xhr.send(blob);
  });
}

/** Public URL for an object in a public bucket, without another round-trip. */
export function publicStorageUrl(bucket: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}
