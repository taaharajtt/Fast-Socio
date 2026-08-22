import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeUpload } from "@/lib/s3/authorize";
import { presignUpload, s3Configured } from "@/lib/s3/sign";
import {
  isStoragePrefix,
  isWellFormedObjectPath,
  validateUploadShape,
} from "@/lib/s3/buckets";

/**
 * Mint a short-lived presigned PUT so the browser can upload one object
 * directly to Contabo (Contabo migration, Phase 3).
 *
 * This endpoint replaces what Supabase Storage did implicitly. There, the
 * browser PUT straight to Storage with the user's own JWT and RLS decided; here
 * WE decide, then sign with our credentials. Everything the storage service
 * used to enforce has to be enforced right here:
 *
 *   - the user is signed in                       (was: JWT on the request)
 *   - the path belongs to them / their room       (was: RLS on storage.objects)
 *   - the size is under the prefix's cap          (was: buckets.file_size_limit)
 *   - the type is on the prefix's allow-list      (was: buckets.allowed_mime_types)
 *
 * The declared content type is still only a CLAIM by the client. Callers that
 * go on to attach the object to a message must re-verify it server-side with
 * `headObject()` before trusting it — same defence-in-depth the chat actions
 * already apply today via `storage.list()`.
 */
export async function POST(request: Request) {
  if (!s3Configured) {
    return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { prefix, path, contentType, sizeBytes } = (body ?? {}) as Record<string, unknown>;

  if (!isStoragePrefix(prefix)) {
    return NextResponse.json({ error: "Unknown storage prefix." }, { status: 400 });
  }
  if (!isWellFormedObjectPath(path)) {
    return NextResponse.json({ error: "Malformed object path." }, { status: 400 });
  }
  if (typeof contentType !== "string" || typeof sizeBytes !== "number") {
    return NextResponse.json({ error: "Missing content type or size." }, { status: 400 });
  }

  const shape = validateUploadShape(prefix, contentType, sizeBytes);
  if (!shape.ok) {
    return NextResponse.json({ error: shape.reason }, { status: 400 });
  }

  const authz = await authorizeUpload(prefix, path, user.id);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.reason }, { status: authz.status });
  }

  // Deliberately short: the client uploads the moment it receives this.
  const uploadUrl = presignUpload(prefix, path, 300);
  return NextResponse.json({ uploadUrl, prefix, path }, { headers: { "cache-control": "no-store" } });
}
