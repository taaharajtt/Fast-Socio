# Production pre-launch security verification checklist

Run through this before a production launch or a major re-launch. Each item
either references one of the other runbooks in this directory or a specific
check to run directly. This is a checklist, not a re-explanation — see the
linked doc for the "why."

## Auth

- [ ] Supabase Auth rate limits reviewed and tightened (sign-in, sign-up/OTP,
      password recovery) — see [auth-rate-limits.md](./auth-rate-limits.md).
- [ ] Confirm the DB-backed limiter (`src/lib/rate-limit.ts`) is understood
      to NOT cover any auth endpoint — it only covers the student write
      actions listed there.
- [ ] Leaked-password (HIBP) protection: re-verify current plan-tier
      availability in the dashboard (previously 402'd on free tier, recorded
      2026-07-17 — may have changed) — see
      [leaked-password-protection.md](./leaked-password-protection.md).
- [ ] Password policy in Supabase dashboard still matches
      `src/lib/auth/password.ts` (`PASSWORD_MIN_LENGTH = 10`, lower+upper+digit).
      If one changes, update the other.

## Operator account security

- [ ] 2FA enabled on Supabase, Vercel, GitHub, domain registrar, Contabo,
      Sentry, and the email/SMTP provider — see
      [2fa-checklist.md](./2fa-checklist.md).
- [ ] Recovery codes for each are stored somewhere durable and not on the
      same machine/session that did the enrollment.

## Secrets

- [ ] Every secret in `.env.example` accounted for and rotated at least once
      since any known incident — see [secret-rotation.md](./secret-rotation.md).
- [ ] `.env.local.bak-*` files on any dev machine deleted once no longer
      needed.
- [ ] Ran the "was it ever committed" checks
      (`git log --all --full-history -- .env.local` etc.) and confirmed clean.
- [ ] GitHub secret scanning + push protection enabled — see
      [secret-scanning.md](./secret-scanning.md).

## Spend / abuse

- [ ] Billing/usage alerts configured on Vercel, Supabase, and Contabo — see
      [billing-alerts.md](./billing-alerts.md).

## Upload / storage

- [ ] Current upload controls (auth, path ownership, room membership,
      declared type/size) reviewed and understood as the actual current
      state — see [upload-scanning-roadmap.md](./upload-scanning-roadmap.md).
- [ ] Explicit acknowledgment that no server-side content sniffing,
      re-encoding, AV scanning, or takedown tooling exists yet — this is a
      known, documented gap, not an oversight to be surprised by post-launch.

## Database access control

- [ ] Run the RLS coverage audit:
      `supabase/tests/rls_coverage_audit.sql` — confirms every table that
      should have row-level security actually has it, and that policies
      exist for the operations the app relies on. (Script maintained
      separately from this doc set; run it directly against the target
      database, do not assume its last recorded result is current.)
- [ ] Run the admin console absence check:
      `supabase/tests/admin_sql_console_absent.sql` — confirms no ad-hoc
      SQL-console-style RPC or admin backdoor is exposed (relevant given the
      2026-07-15 admin privilege-escalation incident referenced elsewhere in
      project history).

## Content Security Policy

- [ ] Confirm `next.config.ts` still carries `script-src 'self'
      'unsafe-inline'` in production and that this is still an accepted,
      documented tradeoff — not a regression waiting to be tightened.
      Verified in `next.config.ts`: the comment block above the CSP array
      states this is deliberate, because switching to nonce-based CSP (to
      drop `unsafe-inline`) would force every page to render dynamically per
      Next's CSP guide — disabling static optimization, ISR, and CDN caching,
      which is incompatible with the PPR/Cache Components setup this app
      relies on, and would undo prior TTFB work (3s → 0.7s per project
      history). The documented path forward is Next's experimental
      hash-based `sri` CSP support (keeps static rendering) once it's no
      longer experimental — re-check Next's release notes periodically for
      that graduating out of experimental, since this doc will not
      self-update.
- [ ] Confirm `object-src 'none'` and `frame-ancestors 'none'` are still
      present (clickjacking / plugin-injection baseline) — both present as of
      this writing per `next.config.ts`.
- [ ] Confirm `connect-src`/`img-src`/`media-src` host allow-lists
      (Supabase host + Contabo storage host) are pinned to the actual
      project hosts, not a wildcard — verified in `next.config.ts`: Supabase
      host is derived from `NEXT_PUBLIC_SUPABASE_URL` with a wildcard
      fallback only if that env var is unset at build time. Confirm the env
      var is always set in the production build so the fallback never
      actually triggers.

## Sign-off

This checklist doesn't replace judgment — a launch under real time pressure
may reasonably defer an item (e.g., AV scanning from the upload roadmap) if
the risk is understood and accepted, not just skipped. Record explicitly
which items were deferred and why, rather than silently checking the box.
