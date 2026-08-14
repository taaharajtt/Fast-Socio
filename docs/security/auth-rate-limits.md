# Supabase Auth rate limits

## Why this matters here specifically

The four auth flows — login, signup, forgot-password, set-password — call
`supabase.auth.*` directly from client components, not through any app API
route:

- `src/app/(auth)/login/page.tsx` — `supabase.auth.signInWithPassword(...)`
- `src/app/(auth)/signup/page.tsx` — `supabase.auth.signInWithOtp(...)`
- `src/app/(auth)/forgot-password/page.tsx` — `supabase.auth.resetPasswordForEmail(...)`
- `src/app/(auth)/set-password/set-password-form.tsx` — `supabase.auth.updateUser({ password })`

Each of these is a browser-to-GoTrue call over the Supabase anon key. There is
no Next.js route handler in front of any of them, which means the app's own
DB-backed rate limiter (`src/lib/rate-limit.ts`) never sees these requests —
it can't, because there's no server code in the path to call it from. The
*only* rate limiting standing between an attacker and repeated
`/token`, `/signup`, `/recover`, `/user` calls is whatever is configured in
Supabase Auth itself.

This was the root cause referenced in `password.ts`'s comments: the
2026-07-15 incident involved brute-forcing `/token` because the server-side
password floor was weak. Rate limits are the other half of that defense —
even a strong password policy doesn't stop credential stuffing if `/token`
can be hit unlimited times.

## What `src/lib/rate-limit.ts` actually covers (and doesn't)

`RATE_LIMITS` in that file covers student write actions, called from server
actions/route handlers that already have a session:

| action | limit |
|---|---|
| `like` | 100 / hour |
| `pass` | 300 / hour |
| `messageRequest` | 20 / hour |
| `chatSend` | 120 / minute |
| `report` | 20 / day |
| `postLike` | 60 / minute |

None of these are auth endpoints. Do not assume this file protects login,
signup, password reset, or password set — it structurally cannot, since those
calls never reach the Next.js server.

## Where to set the real limits

Supabase Dashboard → **Authentication → Rate Limits** (per-project, under
Auth settings). This is a plan-independent setting, not a Pro-only feature —
UNVERIFIED, confirm current plan availability in the dashboard.

Set (or verify) at minimum:

- **Sign-in attempts (email/password)** — the knob covering `/token` with
  `grant_type=password`. This is the one that mattered in the 2026-07-15
  incident. Set conservatively: a real user rarely needs more than a handful
  of attempts per hour; an attacker needs many. Recommend the lowest value the
  dashboard allows that doesn't lock out normal mistyped-password behavior —
  check the dashboard's current default and tighten it, don't leave it at a
  permissive default.
- **Sign-up / OTP requests (email)** — covers `signInWithOtp` on `/signup`.
  Keep this low per-IP and per-email; signup here also sends an email, so a
  loose limit is also an email-bombing vector against the free-tier SMTP
  quota (see `docs/security/billing-alerts.md` and the auth-setup memory note
  on the free-tier email template constraint).
- **Password recovery requests** — covers `resetPasswordForEmail` on
  `/forgot-password`. Same reasoning: low per-email, low per-IP.
- **Token refresh** — leave at a level that doesn't break normal session
  refresh on the PWA (the app refreshes on every page navigation via the
  server client); don't tighten this one blindly.
- **Anonymous sign-ins**, if shown and unused by this app, set to the
  minimum/disable — this app does not use anonymous auth (UNVERIFIED, confirm
  no code path relies on it before disabling).

There is no single "correct" number published here because Supabase's
dashboard defaults change and the right value depends on real traffic
patterns for a campus-scale app (~thousands of users, not millions) — go into
the dashboard, read the current values, and tighten anything that looks
built for a much larger consumer app than this one.

## Additional layer: Vercel WAF / BotID

Supabase's rate limits are the only thing that actually gates GoTrue itself.
As an optional additional layer at the edge, Vercel's WAF can rate-limit or
challenge requests to the `/login`, `/signup`, `/forgot-password` *pages*
before they even load client JS that would call Supabase — this doesn't
replace the Supabase-side limit (a direct API call bypasses page-level
protection entirely) but raises the cost of scripted abuse against the pages
themselves. Vercel BotID can similarly challenge suspicious traffic. Neither
is configured by application code in this repo — set up via the Vercel
dashboard (Firewall / BotID) if desired. UNVERIFIED whether either is
currently enabled for this project — confirm in the Vercel dashboard.

## Verification after changing anything

After adjusting a limit, do a manual test: attempt several rapid
`signInWithPassword` calls with a wrong password from the login page and
confirm Supabase starts rejecting with a rate-limit error before the account
lockout or CAPTCHA (if any) would kick in. Do this from a throwaway test
account, not a real student account.
