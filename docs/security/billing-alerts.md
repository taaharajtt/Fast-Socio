# Billing / spend alerts

Campus-scale app (student user base, not internet-scale) — the goal here
isn't "prevent all cost," it's catching a runaway loop or an abuse pattern
before it turns into a bill that's wildly out of proportion to actual usage.
A misconfigured cache, a scraping bot, or a leaked storage key can all
produce cost curves that look nothing like organic campus traffic.

## Vercel

Where: Vercel Dashboard → account/team → **Settings → Billing** → usage
alerts / spend management. Depending on plan, look for "Spend Management" (a
hard cap that pauses the project rather than billing overage) vs. simple
usage notifications.

What to alert on:

- **Function invocations / duration** — a bug that causes a route to loop,
  or a route with no rate limiting getting hit by a bot, shows up here first.
- **Edge/Function GB-hours or bandwidth** — large media responses proxied
  through a route (rather than served directly from Contabo) would show up
  as bandwidth; if this app should mostly be serving media from Contabo/
  imgproxy directly, sustained Vercel bandwidth growth is a signal something
  is routing through Vercel that shouldn't be.
- Set a **hard spend cap** if the plan supports it, not just a notification
  — for a project this size, a paused deployment is a much better failure
  mode than an unbounded bill.

## Supabase

Where: Supabase Dashboard → project → **Settings → Billing** (org-level
billing overview covers all projects under the org).

What to alert on:

- **Database egress** — the most likely runaway-cost vector for a social app:
  a query without pagination, a leaked service-role key being used to bulk
  export data, or a realtime subscription firing far more than expected.
- **Realtime message volume** — this app uses Supabase Realtime for chat/
  presence; a client stuck in a reconnect loop or an unbounded broadcast can
  spike this.
- **Database size / compute** — slower-moving, but worth a monthly glance;
  sudden jumps usually mean either real growth (good) or an unbounded table
  that never got a cleanup job (bad — e.g., an audit-log table with no
  retention policy).
- Set usage alerts at both a "this is higher than expected for our current
  user count" threshold and a hard "something is wrong" threshold.

## Contabo (object storage)

Where: Contabo customer control panel → billing/usage section for the
object storage product.

What to alert on:

- **Egress bandwidth** — this is the classic S3-compatible-storage
  runaway-cost vector. If `NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL` objects
  (avatars, post-media — both `publicRead: true` per
  `src/lib/s3/buckets.ts`) get hotlinked or scraped at volume, egress is
  where that shows up, since those two prefixes serve directly without any
  app-level access control.
- **Storage volume growth rate** — compare against expected upload volume
  (bounded per-object by `PREFIX_LIMITS` in `src/lib/s3/buckets.ts`: 5MB
  avatars, 10MB post-media, 15MB chat-media) — a sudden jump in object count
  or total bytes with no corresponding growth in active users is worth
  investigating, since it could mean the presign endpoint is being abused
  (e.g., an authenticated-but-malicious client hammering
  `/api/storage/presign` for a prefix it's allowed to write to, like the
  shared `post-media/shared/` folder used by anonymous posts).
- If Contabo's panel doesn't offer proactive alerting, set a recurring manual
  check (weekly/monthly) as a stopgap — UNVERIFIED whether Contabo's control
  panel has native billing alerts; confirm directly in the panel.

## Sentry

Not a major cost vector by comparison, but worth a threshold on event volume
too — an error loop (e.g., a client-side exception thrown on every render)
can burn through the plan's event quota fast, which either costs money or
means real errors get dropped/rate-limited by Sentry once the quota's hit,
silently reducing visibility right when something's actually wrong.

## What a runaway-cost incident actually looks like here

Given this app's architecture (Next.js on Vercel, Supabase Postgres/Realtime/
Auth, Contabo object storage), the realistic failure modes are:

1. **Storage egress spike** — public avatar/post-media prefix hotlinked or
   scraped; no auth required to read it by design (`publicRead: true`), so
   there's no rate limit stopping repeated reads of the same objects.
2. **Presign endpoint abuse** — an authenticated user (or a compromised
   session) scripting many calls to `/api/storage/presign` or
   `/api/storage/sign-get`, each of which is legitimate individually
   (`authorizeUpload`/`authorizeDownload` check ownership) but cheap to call
   at volume — this produces a lot of small signed-URL issuances, not
   directly billed, but each one enables an upload/download that is.
3. **Supabase Realtime storm** — a client bug causing repeated
   subscribe/unsubscribe cycles or duplicated channels across many sessions.
4. **Vercel function loop** — a route handler that calls itself indirectly
   (e.g., via a webhook or a retry without backoff) during an incident.

For all of these, the mitigation is the same shape: alert early on the
metric, then check whether the cause is legitimate growth or abuse, and only
then decide between rate-limiting the specific endpoint (see
`docs/security/auth-rate-limits.md` for the pattern) versus rotating a key
(see `docs/security/secret-rotation.md`) if credentials are implicated.
