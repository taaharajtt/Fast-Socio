# Leaked-password (HIBP) protection

## What the app validates today

`src/lib/auth/password.ts` defines `passwordError()`, used client-side in
`src/app/(auth)/set-password/set-password-form.tsx`. Current rule:

- Minimum length: **10 characters** (`PASSWORD_MIN_LENGTH`)
- Must contain a lowercase letter
- Must contain an uppercase letter
- Must contain a digit

This is a client-side pre-check only — its own doc comment is explicit that
it "must mirror" the real enforcement, which is server-side in Supabase Auth
(GoTrue): `password_min_length = 10`, `password_required_characters =
lower : upper : digits` (recorded as live config as of 2026-07-17 in that
file's comments — re-verify current values in the dashboard, since they can
drift independently of this file).

The file's own comments are candid about the limitation: composition rules
(requiring specific character classes) are not a best practice per NIST SP
800-63B — they block strong passphrases while accepting weak-but-compliant
strings like `Password12`. What actually stops common weak passwords
(`password1234`, breach-list entries) is a breach-list check, which this app
does not perform itself.

There is no server-side re-validation in this repo beyond what GoTrue itself
enforces — the app trusts Supabase Auth as the authoritative gate, matching
the "GoTrue enforces the real policy" comment in `password.ts`.

## Enabling HIBP protection in Supabase

Dashboard path: **Authentication → Policies** (or **Authentication →
Settings**, depending on current dashboard layout) → look for **"Leaked
password protection"** / **HaveIBeenPwned (HIBP) integration**. Toggle it on.

Once enabled, GoTrue checks new passwords against the HIBP breach corpus at
signup and password-change time and rejects known-breached passwords, in
addition to the length/character-class rule already configured.

### Recorded plan-tier caveat

`password.ts`'s comments record that this returned **HTTP 402** when
attempted on this project's plan, verified 2026-07-17: "the better control is
a breach list ... but that is Pro-tier only and this project is on the free
plan (HTTP 402, verified 2026-07-17)." Treat this as a recorded historical
observation, not a current guarantee — Supabase pricing/feature gating
changes over time. **Re-verify by attempting to toggle it in the dashboard
before assuming it's still gated.** If the project has since moved to Pro (or
Supabase has changed the gating), this may now be available for free.

If it becomes available: enable `password_hibp_enabled`, and per the
`password.ts` comment, consider dropping `password_required_characters` in
favor of length + breach-list (the NIST-recommended combination), and update
`passwordError()` to match so the client-side and server-side rules stay in
sync.

## Why the app doesn't call HIBP itself

Two reasons, both intentional design choices already implicit in the
codebase:

1. **Network dependency in the auth path.** Calling the HIBP API (or a local
   k-anonymity range lookup) from `passwordError()` or from a server action
   would add an external network call to every password-set/change flow.
   That's a new failure mode (HIBP down or slow → signup broken) for a check
   that Supabase can do server-side without the app being involved at all.
2. **Supabase already owns the password at signup/change time.** The actual
   password value is sent straight to GoTrue via `supabase.auth.updateUser()`
   / the signup flow — the app never holds it beyond the browser form state.
   Re-implementing breach checking in the app would mean either sending the
   password (or its hash prefix) to a second third party, or duplicating a
   check GoTrue can already do internally before the password is even
   persisted. There's no security benefit to the app doing this instead of
   the identity provider that already has the password.
