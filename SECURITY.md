# FAST SOCIO — Security & Scalability Audit

**Audit date:** 2026-07-06 → 2026-07-07
**Scope:** Full production audit (AuthN/AuthZ, injection/output, business logic, DB/scale, abuse/privacy, UX/a11y).
**Stack audited:** Next.js 16 (App Router, Server Components + Server Actions) · React 19 · Supabase (Postgres + RLS + Storage + Realtime + Edge Functions) · Web Push · PWA · Vercel.
**Branch:** all code fixes on `fix/phase1-auth-hardening` (one atomic commit per finding).
**DB state:** migrations `0021`–`0030` are **applied and verified in production** (project `skgphoupbwdexfevgcnn`).

> ⚠️ **Deploy gap:** DB migrations are live but the **code fixes are unmerged/undeployed**. Until the branch deploys, DM media renders as "Loading…" (P5-01 made the bucket private at the DB; the signed-URL rendering code ships only on deploy). Deploy this branch to close the gap.

---

## 1. Summary by severity

| Severity | Total | Fixed | Unfixed |
|---|---|---|---|
| **P0** — exploitable / data-destroying | 2 | 2 | 0 |
| **P1** — breaks a core invariant | 3 | 3 | 0 |
| **P2** — correctness / UX degradation | 17 | 17 | 0 |
| **P3** — hygiene | 10 | 7 | 3 |
| **Total** | **32** | **29** | **3** |

Plus 2 residual/deferred sub-items and 1 process finding (a build-breaker), detailed below.

**Severity rubric used:**
- **P0** — auth bypass, IDOR, RCE, PII leak, secret exposure, silent data corruption, permanent data loss.
- **P1** — broken core invariant/UX: broken feed, notification loss, race conditions, unbounded queries at scale, cache incoherence.
- **P2** — missing validation, poor error handling, N+1 at p95, inaccessible UI, misleading state.
- **P3** — dead code, missing types, weak naming, low-value refactors (report, don't fix unless asked).

---

## 2. Top 5 risks found (all fixed)

1. **Every private DM image & voice note was downloadable by anyone** with the public anon key — the `chat-media` bucket was world-readable *and* listable. Confirmed by fetching a real voice note unauthenticated. *(P5-01)*
2. **A hardcoded admin password lived in the source** and authenticated against production auth. *(P1-01)*
3. **Banning a user silently did nothing** — a trigger reverted the ban write, so moderation was inert. *(P1-04)*
4. **Anonymous posts were de-anonymizable** — the image URL embedded the author's user ID. *(P3-01)*
5. **Outsiders could self-register as students** — the `@nu.edu.pk` gate was client-side only. *(P1-02)*

---

## 3. Full findings register

Legend — **Status:** ✅ Fixed & verified live · ✅ Fixed (code, verifies on deploy) · ❌ Unfixed (report-only) · ⚠️ Residual/deferred.

### Phase 1 — Authentication, authorization, session

#### P1-01 · P0 · Hardcoded admin credentials in source, usable against prod
- **Evidence:** `src/app/auth/dev-login/dev-login-form.tsx` shipped `PW = "Demo-Passw0rd!"` for `demo-admin@nu.edu.pk` (a real `is_admin` account). The `/auth/dev-login` page is `notFound()` in prod, but the credentials authenticated directly against GoTrue with the public anon key regardless.
- **Fix:** removed the literal; password now from gitignored `NEXT_PUBLIC_DEV_LOGIN_PASSWORD`. **Rotated both demo accounts in prod** (bcrypt via pgcrypto).
- **Verified:** old password `Demo-Passw0rd!` now authenticates = **false** on both accounts.
- **Status:** ✅ Fixed & verified. *Residual:* the old value remains in git history (harmless post-rotation; scrub if desired).

#### P1-02 · P1 · University-email restriction enforced only client-side
- **Evidence:** `isValidFastEmail` ran only in `login/page.tsx`; the `handle_new_user` trigger provisioned a profile for any email. A direct `signInWithOtp({shouldCreateUser:true})` with the anon key could self-register any domain.
- **Fix:** migration **`0021`** — `BEFORE INSERT` trigger `enforce_signup_email_domain` on `auth.users` rejecting non-`nu.edu.pk` domains (optional CSV allow-list in `private.app_config.dev_allowed_emails`).
- **Verified:** `attacker@gmail.com` → rejected; `k99-9999@nu.edu.pk` → passes.
- **Status:** ✅ Fixed & verified live.

#### P1-03 · P2 · Public unauthenticated demo auto-login in prod
- **Evidence:** `GET /auth/demo` minted a session for the shared demo account with no credentials.
- **Fix:** gated via `isDemoLoginEnabled` (`src/lib/auth/gates.ts`) — off in production unless `ALLOW_DEMO_LOGIN=true`.
- **Status:** ✅ Fixed (code).

#### P1-04 · P1 · `protect_profile_columns` clobbered privileged writes (silent ban no-op)
- **Evidence:** the trigger guarded on `auth.role() = 'authenticated'`, which is **not** reset inside a `SECURITY DEFINER` RPC, so it reverted `is_banned` written by `admin_set_ban`. **Verified live: banning a user left `is_banned = false`.** (Aura recompute was NOT affected — it runs nested inside award triggers.)
- **Fix:** migration **`0022`** — guard on `current_user` (which is the function owner `postgres` inside definer functions, `authenticated` for direct writes).
- **Verified:** post-fix, `admin_set_ban` persists `is_banned=true`; aura intact; self-escalation still blocked.
- **Status:** ✅ Fixed & verified live.
- **Coupling note:** the P4-03 incremental aura counter depends on this fix; reverting `0022` would re-break aura writes.

### Phase 2 — Input, injection, output

> **Strong negatives (verified):** no SQL injection (all access parameterized via Supabase client / RPC); no XSS (zero `dangerouslySetInnerHTML`, React escaping, real CSP); no server-side SSRF (no user-URL fetch path).

#### P2-01 · P2 · Open redirect on post-auth `next` param
- **Evidence:** `auth/callback` and `auth/confirm` redirected to `` `${origin}${next}` `` unvalidated (`next=@evil.com` / `.evil.com`).
- **Fix:** `safeNextPath()` (`src/lib/url-safety.ts`) — same-site absolute paths only. Unit-tested.
- **Status:** ✅ Fixed (code).

#### P2-02 · P2 · Storage buckets public, no size limit, any MIME
- **Evidence (live):** all three buckets `public / size_limit=NONE / mime=ANY` → arbitrary types (SVG/HTML) + unbounded uploads.
- **Fix:** migration **`0023`** — per-bucket size caps + image/audio MIME allow-lists (Supabase enforces server-side regardless of client content-type).
- **Verified:** avatars 5 MB / post-media 10 MB / chat-media 15 MB with explicit MIME lists.
- **Status:** ✅ Fixed & verified live.

#### P2-03 · P2 · CSP missing `media-src`; wildcard Supabase host
- **Evidence:** `next.config.ts` CSP had no `media-src` (voice notes fell back to `default-src 'self'` → **broken**) and used `*.supabase.co` (any project).
- **Fix:** added `media-src`; pinned img/media/connect to this project's host (from `NEXT_PUBLIC_SUPABASE_URL`).
- **Status:** ✅ Fixed (code). *Bonus:* fixes latent broken voice-note playback.

#### P2-04 · P3 · Client-supplied media URLs stored unvalidated
- **Evidence:** `image_url`/`attachment_url`/`avatar_url` stored verbatim.
- **Fix:** `isAppStorageUrl()` write-time validation (posts/avatars); chat attachments later moved to path validation (see P5-01).
- **Status:** ✅ Fixed (code).

### Phase 3 — Business logic & invariants

> **Verified OK:** counters use full recount/incremental (no drift); cascades clean; DM read-path RLS sound; idempotent likes/swipes/RSVPs.

#### P3-01 · P1 · Anonymous posts de-anonymizable via image URL
- **Evidence:** `feed_posts` nulled author fields but returned `image_url`; images uploaded to `post-media/<author_id>/…`. **Live: an existing anon post's URL contained its `author_id`.**
- **Fix:** migration **`0024`** (post-media INSERT policy allows a non-identifying `shared/` prefix) + composer uploads to `post-media/shared/<uuid>`. **Re-pathed the existing leaked image** via service-role storage move.
- **Verified:** 0 anon posts leak `author_id` (was 1).
- **Status:** ✅ Fixed & verified live.

#### P3-02 · P2 · Blocks not enforced on write paths
- **Evidence:** likes/comments/message-requests/swipes checked only ownership; a blocked user could still interact + notify the blocker.
- **Fix:** migration **`0025`** — `is_blocked()` helper; all four inserts require no block in either direction (pre-emptive; block UI not yet shipped).
- **Verified:** across-block insert rejected (`42501`); non-blocked control passes.
- **Status:** ✅ Fixed & verified live.

#### P3-03 · P2 · Reporting "actioned" did not hide content
- **Evidence:** `updateReportStatus` only flipped `reports.status`; content stayed visible everywhere.
- **Fix:** migration **`0026`** — `hidden` flag on posts/comments/messages; `feed_posts` filters it; `moderate_report()` (admin-gated) hides on action (reversible); post/chat read paths filter hidden rows.
- **Verified:** actioned → `hidden=true`, drops from `feed_posts`; dismiss restores.
- **Status:** ✅ Fixed & verified live.
- **⚠️ Residual (unfixed, P3):** hidden **messages/comments** are filtered in read *queries* (all UI covered) but their RLS `SELECT` still returns them to a participant querying the table directly. **Posts are airtight** (base SELECT revoked). Fix = add `hidden=false` to the message/comment SELECT policies.

#### P3-04 · P3 · Aura farmable via comments — ❌ UNFIXED (report-only)
- **Evidence:** `award_comment_aura` (`0020`) gives the post author +2 per comment, no per-commenter cap/dedupe → cooperating accounts inflate aura, skewing leaderboard/rivalry.
- **Live:** 0 `comment_received` transactions (unexercised).
- **Recommended fix:** cap once per (commenter, post), or lower the weight. Effort S.
- **Status:** ❌ Unfixed (P3, report-only per rubric).

#### P3-05 · P3 · Orphan notifications point to deleted posts — ❌ UNFIXED (report-only)
- **Evidence:** `notifications.data.post_id` not cleaned on post deletion → link to `/post/<deleted>` 404s.
- **Live:** 0 currently; already 404s (no data leak).
- **Recommended fix:** cascade-clean or resolve gracefully. Effort S.
- **Status:** ❌ Unfixed (P3, report-only).

### Phase 4 — Database & scale

> **Verified OK:** no N+1 (reads batch profiles via `.in()`); feed well-indexed (EXPLAIN: index scan + index-only subplan); multi-write ops atomic; read-fanout (no fanout table to desync). *Note: prod data is tiny (~19 users), so scale findings are latent.*

#### P4-01 · P2 · Unbounded DM message load
- **Evidence:** a conversation fetched ALL messages, no LIMIT.
- **Fix:** bound initial load to 50 (most-recent, reversed) + "Load earlier" keyset pagination (`fetchOlderMessages`).
- **Status:** ✅ Fixed (code).

#### P4-02 · P2 · Foreign keys without covering indexes
- **Evidence (live):** 7 FKs uncovered (`messages.sender_id`/`shared_post_id`, `post_likes.user_id`, `post_comments.author_id`, `notifications.actor_id`, `community_chat_messages.sender_id`, `leaderboard_snapshots.user_id`) → slow cascade deletes & reverse lookups.
- **Fix:** migration **`0027`** adds all 7.
- **Verified:** 0 uncovered FKs remain.
- **Status:** ✅ Fixed & verified live.

#### P4-03 · P2 · O(n) counter recompute on every write
- **Evidence:** `sync_*_count` did `count(*)`, `recompute_aura_score` did `sum()` — O(n) per write, O(n²) for a viral post.
- **Fix:** migration **`0028`** — incremental `+1/-1` (Instagram-style, floored at 0) for like/comment/member/attendee counts and `aura_score`; plus `reconcile_counters()` maintenance fn.
- **Verified:** like_count ±1 and aura +Δ land correctly.
- **Status:** ✅ Fixed & verified live.

#### P4-04 · P3 · No image optimization
- **Evidence:** full-size originals via raw `<img>`.
- **Fix:** `optimizedImage()/optimizedAvatar()` (`src/lib/image.ts`) serve via Supabase render endpoint capped at 1080px (256 avatars / 512 grid), quality 75. Applied across post/chat/profile/discover.
- **Verified live:** render endpoint returns 200 at ~54% the original bytes.
- **Status:** ✅ Fixed & verified live.

#### P4-05 · P3 · No pagination; Discover deck could empty
- **Fix:** infinite-scroll home feed (`FeedList` + `fetchFeedPage` keyset cursor); migration **`0029`** — `get_discover_candidates` recycles previously-liked-but-unmatched profiles (tagged `is_recycled`) so the deck is never empty and a right-swipe can still match on a later pass.
- **Verified:** 14 candidates incl. 2 recycled; liked-unmatched target reappears.
- **Status:** ✅ Fixed & verified live. *Note: `get_discover_candidates` return shape changed from `setof profiles` to explicit columns + `is_recycled`.*

### Phase 5 — Abuse, rate limits, privacy

> **Verified OK:** push/email payloads leak no message body or blocked-user content; no student-facing search (no block/privacy bypass); no username-availability enumeration (no usernames).

#### P5-01 · P0 · Public `chat-media` bucket exposed all DM media
- **Evidence (proven with anon key only, no auth):** listed conversation folders → listed files → **fetched a real voice note (HTTP 200, 31 KB)**. The bucket was `public` and its SELECT policy applied to the `public` role, so both listing and reading were open to the world.
- **Fix:** migration **`0030`** — bucket set private; SELECT restricted to conversation participants. Messages now store the object **path**; the server signs **1-hour** URLs on the initial load (1080px transform for images), the client signs realtime/older attachments (`src/lib/chat-media.ts`). Attachment validation checks the path belongs to the conversation.
- **Verified post-fix:** anon enumeration → **0 entries**; the previously-readable voice note → **HTTP 400**; anon `createSignedUrl` → denied; **participant can access, outsider blocked.**
- **Status:** ✅ Fixed & verified live. *(avatars/post-media remain public — inherently public content.)*

#### P5-02 · P2 · GDPR export materially incomplete
- **Evidence:** export omitted posts, comments, likes, swipes, matches, memberships, events, DMs.
- **Fix:** added all of the above (incl. messages sent, requests, notifications), each RLS-scoped to the caller.
- **Status:** ✅ Fixed (code).

#### P5-03 · P2 · Account deletion orphaned storage
- **Evidence:** `deleteUser` cascades DB rows but not Storage → avatars/post images/DM media persisted (and, pre-P5-01, stayed publicly readable).
- **Fix:** `deleteAccount` now gathers the user's objects (avatars/`<uid>`, post-media paths from their posts, chat-media paths from their sent messages) and removes them before `deleteUser`.
- **Status:** ✅ Fixed (code).

#### P5-04 · P2 · `toggleLike` not rate-limited → notification/push spam
- **Fix:** `postLike` limit (60 toggles/min); over-limit silently no-ops.
- **Status:** ✅ Fixed (code).

#### P5-05 · P2 · `sharePostToFriend` bypassed the chat send limit
- **Fix:** shares the `chatSend` rate limit.
- **Status:** ✅ Fixed (code). *Commit note: this change landed inside the P5-01 commit (staging slip) — correct & present, not atomic.*

#### P5-06 · P3 · Inconsistent report rate-limiting
- **Fix:** added the `report` limit to `reportCommunity`/`reportEvent` (were the only unthrottled report types).
- **Status:** ✅ Fixed (code).

#### P5-07 · P3 · No per-IP rate limiting — ❌ UNFIXED (mitigated)
- **Evidence:** all limits are per-`auth.uid()`.
- **Mitigation:** every limited action is auth-required; pre-auth (login/OTP/signup) is throttled by Supabase GoTrue. A per-IP layer would need edge/WAF (e.g. Vercel Firewall).
- **Status:** ❌ Unfixed (P3, mitigated).

### Phase 6 — UX, accessibility, resilience

> **Verified OK:** `GlassButton` focus-visible ring; delete-account two-step confirm; inline form errors; loading/empty states + route-level skeletons; swipe-deck keyboard support + undo; timezone-safe timestamps.

| ID | Sev | Issue | Fix | Status |
|---|---|---|---|---|
| P6-01 | P2 | Modal (`GlassSheet`) had no focus trap / Escape / `role=dialog` / focus restore | Full accessible dialog | ✅ Fixed |
| P6-02 | P2 | Optimistic like never rolled back on failure (worsened by P5-04/P3-02 silent fails) | `toggleLike` returns `{ok}`; UI reverts | ✅ Fixed |
| P6-03 | P2 | `maximumScale:1` disabled pinch-zoom (WCAG 1.4.4) | Removed | ✅ Fixed |
| P6-04 | P2 | No `prefers-reduced-motion` | `MotionConfig reducedMotion="user"` + CSS media query | ✅ Fixed |
| P6-05 | P3 | No live regions for errors/toasts | `role="alert"`/`"status"` | ✅ Fixed |
| P6-06 | P3 | Low-contrast text below AA (placeholders, login hints) | Bumped to AA | ✅ Fixed |
| P6-07 | P3 | Timestamps relative-only | `absoluteTime()` + `<time title>` hover | ✅ Fixed |

---

## 4. Process finding — build-breaker (fixed)

`FEED_PAGE_SIZE` / `MESSAGE_PAGE_SIZE` were exported from `"use server"` action modules (which may only export async functions). **`tsc --noEmit` and vitest both passed it; only `next build` caught it** — the branch would not have deployed in its Phase 4/5 state. Moved the constants to `lib/feed/types.ts` and `lib/chat-media.ts`.

> **Lesson:** run `npm run build` after touching any `"use server"` module — type-check + unit tests are insufficient. **Confirm CI runs `next build` on PRs.**

---

## 5. Remaining work (unfixed), by risk-reduction ÷ effort

1. **P3-03 residual** — add `hidden=false` to the message/comment RLS SELECT policies (tiny; tightens the moderation guarantee end-to-end).
2. **P3-04** — cap `comment_received` aura once per (commenter, post) (small; protects leaderboard integrity).
3. **P3-05** — clean/resolve orphan notifications on post delete (small; cosmetic).
4. **CSP hardening** — nonce-based `script-src` (removes `'unsafe-inline'/'unsafe-eval'`); the config defers this to "Phase 12".
5. **P5-07** — per-IP rate limiting at the edge/WAF (larger; currently mitigated).

---

## 6. Explicitly NOT audited

- Empirical screen-reader / keyboard testing (Phase 6 verified by build + code + evidence-grep, not a live AT session).
- PWA service-worker caching (stale-auth / cache-poisoning).
- Realtime protocol beyond RLS gating.
- `pg_cron` leaderboard/rivalry rollover at an actual week boundary.
- Supabase platform config not visible in code (GoTrue limits, email provider, network rules).
- Payments — none exist.
- Load/perf at scale — static + EXPLAIN only (prod data ~19 users).

**Pre-launch reminders:** remove the `demo-user` / `demo-admin` accounts; consider scrubbing the old password from git history.

---

## 7. Migration ledger (applied to prod, verified)

| Migration | Finding | What it does |
|---|---|---|
| `0021_enforce_signup_email_domain` | P1-02 | Reject non-`nu.edu.pk` signups at the DB |
| `0022_fix_protect_profile_columns` | P1-04 | Guard on `current_user` so admin ban/aura writes persist |
| `0023_storage_bucket_limits` | P2-02 | Per-bucket size + MIME allow-lists |
| `0024_anon_post_media_path` | P3-01 | Allow de-identified `shared/` post-image prefix |
| `0025_enforce_blocks_on_writes` | P3-02 | `is_blocked()` on like/comment/request/swipe |
| `0026_moderation_hide_content` | P3-03 | `hidden` flag + `moderate_report()` |
| `0027_fk_indexes` | P4-02 | Index 7 uncovered foreign keys |
| `0028_incremental_counters` | P4-03 | Incremental counters + aura |
| `0029_discover_never_empty` | P4-05 | Recycle liked-unmatched Discover candidates |
| `0030_chat_media_private` | P5-01 | Private DM bucket + participant-only SELECT |

Data operation (not a migration): re-pathed the one leaked anonymous-post image into `post-media/shared/` (P3-01).

---

## 8. Test & verification posture

- **Added** a `vitest` suite (`npm test`) — 25 unit tests over pure helpers (`isValidFastEmail`, `isDemoLoginEnabled`, `safeNextPath`, `isAppStorageUrl`, `optimizedImage`, `chatMediaPath`/`isChatMediaPathFor`).
- **DB fixes** verified against live prod via rolled-back SQL repros (see `supabase/tests/phase1_auth_verification.sql`).
- **P0/P1 fixes** re-verified by re-running the original attack (anon DM enumeration, admin-ban persistence, anon-image leak).
- `tsc --noEmit`, `eslint`, and `next build` all clean on the final branch.
