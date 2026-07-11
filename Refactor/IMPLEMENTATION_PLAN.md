# FastSocio Refactor — Phased Implementation Plan

**Branch:** `experiment-risky-refactor`
**Source:** Gap analysis of `Refactor/Page_01`–`Page_17` specs vs. the current codebase (2026-07-11).
**Prime rule:** Never remove existing logic. Only add features that are missing *and* improve robustness, UX, or security.

---

## Current-State Summary (what already exists — do NOT rebuild)

| Area | Already implemented |
|---|---|
| Auth | Magic-link login/signup, forgot/reset pages, banned gate, email-domain restriction (mig 0031), rate limiting (`lib/rate-limit.ts`), URL safety checks |
| Onboarding | Single-page form (315 LOC) collecting profile basics + interests |
| Feed | Chronological feed, post composer, comments w/ threading, share sheet, events strip, dept rivalry strip |
| Discover | Swipe deck, `get_discover_candidates` RPC (eligibility + recycle passes, migs 0004/0029/0047), reports, message requests |
| Aura | Score, labels, leaderboard page, admin aura ops |
| Events | CRUD, detail pages, registration (constants/format libs) |
| Chat | DMs + community chat, drafts, message reactions (mig 0049), typing indicator, presence heartbeat, private media (mig 0030) |
| Notifications | Table (mig 0014), bell + menu, prefs, push, announcements, mark-all-read |
| Profile | View/edit, tabs, cover (mig 0036), share button |
| Settings | Notification prefs, push enable, data export, delete account |
| Moderation | Reports table, hide content (mig 0026), admin content moderation (M-tier, mig 0040) |
| Admin | Full M0–M12 dashboard (users, content, aura, matching, broadcast, SQL, analytics, audit, infra) |

## Confirmed Gaps (verified by codebase search)

No feed ranking engine (pure `created_at desc`) · no compatibility scoring in Discover RPC · no post drafts/autosave/scheduling · no bookmarks/saved posts · no hashtags/mentions · no polls in feed (communities only) · no XP/levels/achievements/badges engine · no event waitlist/check-in/feedback · no notification grouping/quiet hours/digests · thin Settings (no privacy toggles, sessions UI, appearance beyond theme) · no risk-score rule engine, strikes, shadow ban, or appeals · no maintenance-mode/feature-flag gate on the client.

---

## Phase 1 — Foundation, Security & App Shell (Splash spec §01, cross-cutting)

**Why first:** every later phase depends on feature flags, audit trails, and session hygiene.

1. **Feature flags (client-side)** — `feature_flags` table + server helper `lib/flags.ts`; gate Discover/Events/Leaderboard tabs. Admin already has settings infra to toggle them.
2. **Maintenance mode** — flag-driven interstitial in root layout (bypass for admins).
3. **Session/device registry** — `user_sessions` table capturing device label, UA, last-active on login; groundwork for Settings → Devices (Phase 8).
4. **Audit log expansion** — reuse admin audit table pattern for user-facing security events (login, password/email change, export, delete).
5. **Init hardening** — parallelize root-layout data fetches; offline fallback page for the PWA; version-check banner using `NEXT_PUBLIC_APP_VERSION`.

**Migration:** `0050_foundation_flags_sessions.sql`
**Deferred from spec:** native push registration flows, crash reporting SDK, device-trust scoring (not applicable to PWA free tier).

## Phase 2 — Onboarding Identity Vector (spec §03)

**Why second:** interests/personality/preferences feed the Discover engine (Phase 4) and feed affinity (Phase 3).

1. Convert single-page form → **multi-step wizard** (Welcome → Basics → Media → Interests → Personality → Academic → Discover Prefs → Privacy → Notifications) with per-step server autosave + resume.
2. New profile columns: personality traits, languages, hostel/day-scholar, graduation year, discover preferences (gender/semester-range/verified-only), privacy defaults.
3. **Profile completeness %** (SQL function) + completion badge + one-time Aura bonus.
4. Keep the existing form fields and actions intact — wizard wraps them.

**Migration:** `0051_onboarding_identity_vector.sql`

## Phase 3 — Feed Ranking Engine & Post Upgrades (specs §04, §05, §06)

1. **Deterministic ranking RPC** `get_ranked_feed(cursor)`: recency decay + engagement rate + same-dept/semester affinity + shared-interest overlap + author Aura (log-scaled) − report penalty. Keep chronological as a user-selectable "Latest" filter (never remove existing behavior).
2. **Cursor pagination** on the ranked RPC (dedupe-safe).
3. **Saved posts (bookmarks)** — table + post-card action + Profile "Saved" tab.
4. **Post drafts + autosave** in composer (localStorage first, `post_drafts` table sync).
5. **Hashtags & mentions** — parse on publish, store in join tables, mention notifications, tappable chips.
6. **Polls in feed posts** — reuse the existing community `poll-card` component.
7. **Edit history + edited badge** on posts.

**Migrations:** `0052_feed_ranking.sql`, `0053_posts_saves_tags_polls.sql`
**Deferred:** video transcoding, voice notes in posts, scheduled posts, translate (external service).

## Phase 4 — Discover Compatibility Engine (spec §07)

1. Extend `get_discover_candidates` → **weighted compatibility score**: dept/campus identity + semester proximity + shared interests (Jaccard) + mutual communities + mutual event attendance + activity recency + log-scaled Aura + freshness bonus − skip-cooldown penalty. Weights in a `scoring_weights` config table (admin-editable).
2. **Compatibility % on the card** (normalized 0–100) + shared-interest chips.
3. **Diversity pass** — cap consecutive same-department results; exploration slot for new/low-data profiles.
4. **Filters sheet** — dept, semester range, verified-only, interests (applied pre-scoring).
5. **Undo last pass** (limited/day) + **daily swipe limit** enforcement server-side.

**Migration:** `0054_compatibility_engine.sql` (replaces RPC body, keeps signature + recycle behavior).

## Phase 5 — Aura, XP, Levels & Achievements (spec §09)

1. **XP ledger** parallel to Aura events; level = configurable XP curve function.
2. **Achievements engine** — `achievements` (catalog) + `user_achievements`; trigger-based unlock checks for First Post, Streaks, Event Organizer, Top Contributor, etc.
3. **Scoped leaderboards** — weekly/monthly/department/semester views via materialized-ish cached RPCs (existing leaderboard page gains tabs).
4. **Level/achievement notifications** through the existing notification pipeline.

**Migration:** `0055_xp_achievements.sql`
**Deferred:** seasons, cosmetic frames/themes marketplace.

## Phase 6 — Events Upgrades (spec §10)

1. **Waitlist** — auto-promote on cancellation (trigger); position notifications.
2. **QR check-in** — signed per-registration token rendered as QR; organizer scan page validates + awards attendance Aura/XP.
3. **Event discussion** — reuse community-chat component bound to event ID.
4. **Reminders** — notification rows scheduled at T-24h/T-1h (cron or on-load sweep).
5. **Post-event feedback** — 1–5 rating + comment; average on organizer profile.

**Migration:** `0056_events_waitlist_checkin_feedback.sql`
**Deferred:** NFC/geolocation check-in, ticket pricing, calendar export.

## Phase 7 — Notifications Hardening (spec §12)

1. **Grouping/collapse** ("X and 3 others liked…") via `group_key` column + upsert logic.
2. **Category mutes + quiet hours** in prefs (enforced at insert/delivery).
3. **Deduplication** (unique partial index on actor+target+type within window).
4. **Deep-link coverage audit** — every type routes correctly.

**Migration:** `0057_notifications_grouping.sql`

## Phase 8 — Settings Expansion (spec §15)

1. **Privacy section** — profile/search/discover visibility, online status, read receipts, Aura visibility, dept/semester visibility. Enforced in RPCs and presence logic.
2. **Security section** — active sessions list (from Phase 1 registry) with revoke + revoke-all.
3. **Appearance** — font size, reduced motion, compact mode (CSS vars on `<html>`; theme toggle already exists).
4. **Account** — deactivate (hide + restore) alongside existing delete; username change w/ 30-day cooldown.
5. **Blocked/muted users management UI.**

**Migration:** `0058_settings_privacy_security.sql`
**Deferred:** MFA/OTP flows (conflicts with magic-link + free-tier email constraint), phone numbers, connected accounts, biometrics.

## Phase 9 — Moderation & Trust (spec §16)

1. **Rule engine at creation** — `lib/moderation/rules.ts`: profanity list, spam-link, flood (rate windows), duplicate text, excessive tags/mentions → **risk score 0–100** stored on content; 41–70 auto-hidden pending review, 71+ blocked.
2. **Report lifecycle** — status machine (open → assigned → decided → archived), duplicate merge, priority buckets in existing admin reports page.
3. **Strike/warning system** — warnings table, escalating restrictions (post-cooldown → suspension), user-visible warning notices.
4. **Shadow ban** — flag excluded from feed ranking + Discover (messages unaffected).
5. **Appeals** — appeal form on punishment notice + admin appeals queue.

**Migrations:** `0059_moderation_risk_engine.sql`, `0060_strikes_appeals.sql`
**Deferred:** ML content classification, device fingerprinting, image scanning.

## Phase 10 — Chat & Profile Polish (specs §11, §14)

1. Chat: message **search**, **pinned messages**, **edit/unsend** (with edited marker + tombstone), read-receipt privacy honoring Phase 8 setting.
2. Profile: **statistics tab** (posts/reactions/events counts), **achievements/badges tab** (Phase 5 data), completeness meter.

**Migration:** `0061_chat_pins_edit.sql`
**Deferred:** voice/video calls, screen share, disappearing/scheduled messages, stickers.

---

## Explicitly Out of Scope (spec items that don't fit this product/stack)

- Password + OTP auth, CAPTCHA, MFA — existing auth is magic-link by design (free-tier email template constraint); replacing it violates the no-removal rule.
- Apple/Google OAuth — needs paid developer accounts/console setup; flag for product decision.
- Marketplace, jobs/internships post types — whole new product surface, not an enhancement of existing logic.
- Native permissions panel, NFC, PiP, crash SDKs — PWA limitations.
- External AI/translation services — spec itself mandates deterministic, no-AI engines.

## Execution Rules (every phase)

- One migration file per phase, additive only (new tables/columns/RPCs; `create or replace` for RPC bodies keeps signatures).
- RLS on every new table from the start (learned from security audit: use `(select auth.uid())` initplan pattern, mig 0032).
- Server actions validate + rate-limit; optimistic UI where it already exists.
- Logical commits per feature within a phase; verify with dev server before commit.
- `npm run lint` + typecheck must pass before each commit (React Compiler lint baseline).
