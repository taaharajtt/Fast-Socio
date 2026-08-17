# 2FA / MFA checklist — operator accounts

These are the accounts that, if compromised, can hurt this project directly
(deploy malicious code, drop the database, redirect the domain, empty the
storage bucket, or read production secrets). Enable MFA on all of them.
Store recovery codes somewhere other than the same device/browser profile
that holds the 2FA app — a password manager's secure notes, or printed and
kept offline, not a plaintext file in this repo or on the same laptop.

## Supabase

- Where: Supabase Dashboard → account avatar → **Account preferences** →
  **Security** (org/account level, not per-project).
- Action: enable TOTP-based 2FA.
- Recovery codes: Supabase issues recovery codes on enrollment — save them
  outside the browser session that enrolled them. Losing both the TOTP device
  and the recovery codes means going through Supabase support for account
  recovery, which will be slow.
- This account can read/write the production Postgres database and rotate
  the service role key — highest blast radius of anything on this list.

## Vercel

- Where: Vercel Dashboard → account settings → **Security** (or team
  settings → Security, if the project lives under a team).
- Action: enable 2FA (TOTP or a hardware key/WebAuthn).
- Recovery codes: Vercel provides them at enrollment — store them offline.
- This account can push deployments (i.e., ship arbitrary code to
  production), read/write environment variables (including
  `SUPABASE_SERVICE_ROLE_KEY`, `CONTABO_S3_SECRET_ACCESS_KEY`, etc.), and
  control the custom domain.

## GitHub

- Where: GitHub → Settings → **Password and authentication** → **Two-factor
  authentication**.
- Action: enable 2FA. Prefer a hardware security key or TOTP app over SMS.
- Recovery codes: GitHub gives a one-time set at enrollment — download and
  store offline; regenerate if you suspect exposure.
- This account controls repo write access (this repo is public per
  `.gitignore`'s own comments), any CI secrets stored in GitHub Actions if
  configured, and — if GitHub is connected to Vercel for deploys — is an
  indirect path to production deploys.

## Domain registrar

- Where: whichever registrar holds the project's domain — check the
  registrar's account security settings.
- Action: enable 2FA, and separately enable **registrar/registry domain
  lock** if available (prevents unauthorized transfer even with account
  access).
- Recovery codes: store offline per the registrar's enrollment flow.
- Losing this account means the domain can be pointed elsewhere entirely,
  which also breaks the auth redirect URLs Supabase is configured to trust —
  a compromised domain is close to a full compromise of the login flow.

## Contabo (object storage account)

- Where: Contabo customer control panel → account/security settings.
- Action: enable 2FA if the panel offers it (verify current UI — Contabo's
  control panel security options are UNVERIFIED here since this doc can't
  check the live dashboard). Separately, treat the S3 access key/secret
  (`CONTABO_S3_ACCESS_KEY_ID` / `CONTABO_S3_SECRET_ACCESS_KEY`) as the
  higher-value credential day to day — 2FA protects the *control panel*
  login, not requests made with those already-issued keys.
- Recovery codes: store per Contabo's enrollment flow.
- Blast radius: full read/write/delete on every uploaded avatar, post image,
  and chat attachment (`fast-socio` bucket).

## Sentry

- Where: Sentry → Organization Settings → **Security & Privacy** → Two-Factor
  Authentication (or per-user account settings → Security).
- Action: enable 2FA.
- Recovery codes: store per Sentry's enrollment flow.
- Blast radius: read access to error reports, which can contain request
  metadata, stack traces, and potentially user-identifying details depending
  on what's captured — not a direct path to production compromise, but a
  privacy exposure if an attacker reads through issue history.

## Email / SMTP provider

- Where: whichever provider sends the app's auth emails (magic
  links, password resets) — check its account security page.
- Action: enable 2FA.
- Recovery codes: store per that provider's enrollment flow.
- Blast radius: if compromised, an attacker could intercept or redirect
  outbound auth emails, or exhaust send quota (denial of service on
  signup/password-reset for real users). Given the free-tier email template
  constraint noted elsewhere in project notes, also confirm this account's
  billing/quota alerts are set (see `docs/security/billing-alerts.md`).

## End-user MFA (students using the app)

Grepping `src/` for `mfa` (case-insensitive) returns **no matches**. The app
does not implement or expose Supabase Auth's end-user MFA (TOTP/phone
factors) anywhere in the login, signup, or account-settings flows today.
Enabling it for end users would require actual app work: a UI to enroll a
factor, a challenge step in the login flow, and handling the
`aal1`/`aal2` session states GoTrue exposes — none of that exists in this
codebase currently. This is a product feature gap, not a configuration
toggle; it can't be turned on purely from the Supabase dashboard the way
HIBP protection or rate limits can.
