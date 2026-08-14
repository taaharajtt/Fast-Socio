# Upload content validation — current state and roadmap

## Current controls (as implemented today)

Source: `src/app/api/storage/presign/route.ts`,
`src/app/api/storage/sign-get/route.ts`, `src/lib/s3/authorize.ts`,
`src/lib/s3/buckets.ts`.

Uploads go: browser requests a presigned PUT from `/api/storage/presign` →
app validates and signs → browser PUTs the file **directly to Contabo**, not
through the app server. This means the app never actually receives the file
bytes — everything enforceable happens before signing, at request time, based
on claims in the request body. What's checked, precisely:

1. **Authentication** — `/api/storage/presign` and `/api/storage/sign-get`
   both call `supabase.auth.getUser()` and reject with 401 if there's no
   session. Anonymous callers can't get a presigned URL at all.
2. **Path shape** — `isWellFormedObjectPath()` in `buckets.ts` requires a
   plain `<segment>/<segment>` path, rejects `..`, `//`, leading `/`, control
   characters, backslashes, whitespace, and caps length at 512. This exists
   specifically because path traversal here would be signed as a legitimate
   S3 key rather than caught by RLS (there is no RLS on plain S3).
3. **Path ownership / room membership** — `authorizeUpload()` /
   `authorizeDownload()` in `authorize.ts` enforce, per prefix:
   - `avatars`: first path segment must equal the caller's `user.id`.
   - `post-media`: first path segment must be the caller's `user.id` *or*
     the literal `shared` folder (used for anonymous posts).
   - `chat-media`: first path segment (room id) must be a conversation the
     caller participates in, or a community/society they're a member of —
     checked via `authorizeRoomAccess()`, itself gated by a `isUuid()` check
     on both the room id and user id before either is interpolated into a
     PostgREST filter.
4. **Declared content type** — `validateUploadShape()` checks the
   client-declared `contentType` against a per-prefix allow-list
   (`PREFIX_LIMITS` in `buckets.ts`): images (`jpeg/png/webp/gif`) for
   avatars and post-media; images plus audio (`webm/mp4/mpeg/ogg`) for
   chat-media. **This is a claim, not a fact** — the presigned PUT signs for
   that content type, but nothing re-inspects the actual bytes the browser
   uploads. The route handler's own doc comment says this explicitly:
   "The declared content type is still only a CLAIM by the client."
5. **Declared size** — `validateUploadShape()` also checks the
   client-declared `sizeBytes` against a per-prefix cap (5MB avatars, 10MB
   post-media, 15MB chat-media). Same caveat: this is the size the client
   *says* it will upload, checked before signing. A presigned PUT does not
   inherently enforce that the actual uploaded body matches the size that was
   checked, unless the S3-compatible provider enforces `Content-Length`
   against the signature (Contabo's exact behavior here is UNVERIFIED from
   the repo alone — the code does not implement a server-side re-check after
   upload).
6. **Chat-media re-verification on read** — the presign route's own comment
   notes that code attaching an object to a message "must re-verify it
   server-side with `headObject()` before trusting it — same defence-in-depth
   the chat actions already apply today via `storage.list()`." This applies
   specifically to the chat-attachment flow, not to avatars/post-media.

## What is explicitly NOT implemented today

None of the following exist anywhere in this codebase as of this writing.
Content type and size are checked against client claims only; nothing
inspects actual file bytes after upload for any prefix.

### (a) Server-side magic-byte / content sniffing after upload

**What**: after the client PUTs the object, a server-side job reads the
first bytes of the actual uploaded object (via a Contabo GET or a range
request) and verifies the real file signature matches the claimed content
type (e.g., a `.jpg` claim is actually a JPEG, not a renamed script or an
SVG with embedded script content).

**Tradeoff**: catches the gap between "declared" and "actual" content type
described above — the main current weakness. Requires either a webhook from
Contabo on object-created events (if supported) or a polling/async check
triggered right after the presign is issued. Adds latency between upload and
"trusted" state, or requires the UI to show media as pending until the check
completes. **Effort: small-to-medium** — a single Lambda-style function or
Vercel background task per upload event, using an existing magic-byte
library; the main work is wiring the trigger, not the check itself.

### (b) Re-encode / strip-metadata for images

**What**: re-encode uploaded images server-side (via imgproxy, which is
already in this stack per `NEXT_PUBLIC_IMGPROXY_URL`, or a dedicated
pipeline) rather than serving the original bytes. This strips EXIF
(location data in particular — relevant for a campus app where a photo's
GPS metadata could deanonymize a poster), and neutralizes most
image-polyglot attacks (files that are valid images but also valid
HTML/JS when served with the wrong content-type).

**Tradeoff**: imgproxy is already present in the stack for transforms, so
this is largely "make re-encoding mandatory on the read path" rather than
new infrastructure — but it changes the current design where, per
`buckets.ts`'s own comment, the client PUTs straight to Contabo and imgproxy
is optional/transform-only. Doing this properly means either imgproxy
becomes non-optional for public prefixes, or a separate async re-encode step
writes back a sanitized copy. **Effort: medium** — depends on how much of the
current "serve full-size originals when imgproxy is unset" fallback (noted
in `.env.example`) needs to be retired.

### (c) Third-party AV scanning on an async hook

**What**: after upload, send the object (or a reference to it) to a
malware-scanning API/service, quarantine or delete objects that come back
positive, before they're ever served to another user.

**Tradeoff**: meaningful for `chat-media` and `post-media` since those are
shared with other users (an infected file uploaded by one student could be
downloaded by others); less critical for `avatars` given the tight
content-type allow-list already limits the format to images. Adds a
third-party dependency and per-scan cost, and needs a quarantine state in
the data model (an object that's uploaded but not yet cleared shouldn't be
visible/servable). **Effort: medium-to-large** — new async infrastructure,
a "pending scan" state threaded through wherever media is currently rendered
optimistically after upload.

### (d) Abuse reporting + takedown

**What**: a way for a student to report a specific piece of uploaded media
(existing `report` action in `RATE_LIMITS` suggests reporting exists for
some content already — verify whether it currently covers media
specifically or only posts/users) plus an admin action to remove the
underlying object from Contabo, not just hide it in the UI.

**Tradeoff**: lowest technical effort of the four if a report mechanism
already exists for other content types — mostly plumbing an admin action
that calls a delete against the Contabo object key. The gap today, if any,
is whether "hidden" content is actually deleted from storage or just
hidden from queries while the object remains readable via any URL that was
already shared/cached. **Effort: small**, contingent on what already exists
in the admin dashboard for content moderation — check
`src/app/(admin)` (or wherever the admin surface lives) before assuming this
needs to be built from scratch.

## Summary

Today: auth + ownership + room-membership + declared-type + declared-size
checks, all enforced before signing. Nothing re-inspects actual uploaded
bytes. The single highest-value next step is (a), since it directly closes
the "declared vs. actual content type" gap that every other current control
implicitly trusts.
