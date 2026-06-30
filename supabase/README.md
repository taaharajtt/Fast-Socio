# Supabase

Database schema, migrations, and (later) Edge Functions for FAST SOCIO.

## Layout

```
supabase/
  migrations/   Ordered SQL migrations (0001_*.sql, 0002_*.sql, …)
```

## Conventions

- **RLS in the same migration as the table.** Every table is created with
  `enable row level security` and its policies in the *same* file. Never defer
  RLS to a later migration (Decision #005, kickoff architecture review).
- **Aura is server-authoritative.** `aura_transactions` is the single source of
  truth; `profiles.aura_score` is a read-only cache recomputed by a trigger.
  Clients have no write policy on `aura_transactions`.
- **Audit log is insert-only.** `moderation_audit_log` has no update/delete
  policy and is written via `SECURITY DEFINER` functions.

## Applying migrations

Either paste the SQL into the Supabase Studio SQL editor (Database → SQL), or
use the Supabase CLI once a project is linked:

```bash
# one-time
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>

# apply everything in migrations/
supabase db push
```

## Required environment

Copy `.env.example` → `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)

## Migrations

| File | Purpose |
|------|---------|
| `0001_init_foundation.sql` | profiles, aura_transactions (+ score trigger), blocked_users, polymorphic reports, insert-only moderation_audit_log, notification_preferences, push_subscriptions, rate_limit_events, new-user bootstrap. RLS on every table. |
