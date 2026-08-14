# Security operator runbooks

This directory is operator documentation, not a security policy or a compliance
claim. It is a set of practical runbooks for a solo maintainer covering the
settings, checks, and rotations that live outside the repo — in the Supabase
dashboard, Vercel dashboard, GitHub settings, and other provider consoles.

**The live security posture of this project is whatever those dashboards are
actually configured to, not what these documents describe.** Code in this repo
(RLS policies, the CSP header, the DB-backed rate limiter, upload validation)
is verifiable by reading it; dashboard settings are not, and can drift. Where a
doc states a dashboard setting, treat it as "this is what to check/set," not
"this is guaranteed to be set."

## Index

- [auth-rate-limits.md](./auth-rate-limits.md) — Supabase Auth rate limits vs. the app's own DB-backed limiter.
- [leaked-password-protection.md](./leaked-password-protection.md) — current password rules + enabling HIBP breach checking.
- [2fa-checklist.md](./2fa-checklist.md) — MFA on operator accounts (Supabase, Vercel, GitHub, registrar, storage, Sentry, SMTP) + end-user MFA status.
- [secret-rotation.md](./secret-rotation.md) — every secret this project has, blast radius, rotation steps.
- [secret-scanning.md](./secret-scanning.md) — GitHub secret scanning/push protection + local pre-commit scanning.
- [billing-alerts.md](./billing-alerts.md) — spend/usage alerts on Vercel, Supabase, and object storage.
- [upload-scanning-roadmap.md](./upload-scanning-roadmap.md) — current upload controls + staged roadmap for content validation (none of it implemented today).
- [admin-database-browser.md](./admin-database-browser.md) — what `/admin/database` may and may not mutate, and why (migration 0149).
- [prelaunch-verification.md](./prelaunch-verification.md) — single pre-launch checklist tying the above together, plus the SQL audit scripts.

## Scope

These are runbooks for *this* project's actual stack: Next.js on Vercel,
Supabase (Auth + Postgres), Contabo S3-compatible object storage, Sentry, and
GitHub. They are written against what is in the repo today (2026-08) and will
go stale as the app changes — re-verify code references before following a doc
that looks old.
