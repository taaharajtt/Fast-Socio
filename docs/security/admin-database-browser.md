# The admin database browser is a browser, not a SQL console

`/admin/database` is a generic table viewer and row editor, gated to
`super_admin`. This note records what it can and cannot do, and why the limits
are where they are. Read it before widening them.

## Background

Migration `0038_admin_db_browser_rpcs.sql` gave the browser three generic
mutation RPCs:

- `admin_update_row(p_table, p_pk_col, p_pk_val, p_row)`
- `admin_insert_row(p_table, p_row)`
- `admin_delete_row(p_table, p_pk_col, p_pk_val)`

Their dynamic SQL is sound: identifiers go through `format('%I')`, literals
through `format('%L')`, and values are cast via `jsonb_populate_record` against
the table's own rowtype. Injection is not the problem.

**Reach** is the problem. All three are `SECURITY DEFINER`, so they execute as
the table owner. That means they run past every layer the app relies on for
ordinary writes:

| Layer | Where it comes from | Does it apply to these RPCs? |
| --- | --- | --- |
| Row-level security | policies across the migrations | No — definer bypasses RLS |
| Column-level `GRANT`s on `profiles` | `0084_profiles_column_allowlist.sql` | No — grants are checked against the definer |
| `protect_profile_columns()` trigger | `0080_protect_profile_columns_on_insert.sql` | No — its body is gated on `current_user = 'authenticated'`, and here `current_user` is the definer |

So before migration 0149, a `super_admin` editing a row in the generic table
editor could set `profiles.admin_role`, `is_banned`, `verified`, `aura_score`
and `xp` directly — the exact columns the 2026-07-15 privilege-escalation
incident abused, and the ones migrations 0080 and 0084 were written to lock
down. The same editor could also modify or delete rows in
`moderation_audit_log`, the table that is supposed to record what admins did.

That is not a hypothetical about a malicious owner. It matters because it means
a single compromised admin session — phished, XSS'd, or an escalation bug —
inherits full, unaudited-in-effect control of the privilege model, and the
audit trail cannot be trusted to show it afterwards.

## What migration 0149 does

It does **not** change `admin_update_row` and friends. Those are called by real,
intentional, audited features:

- `setUserRole` and `setVerified` in `src/app/admin/users/actions.ts` write
  `profiles.admin_role` and `profiles.verified` through `admin_update_row`
  precisely because it is the audited writer.
- `src/app/admin/{communities,events,matching}/actions.ts` call
  `admin_delete_row` for their own tables.

Denylisting inside those functions would break all of that.

Instead, 0149 adds three **browser-only** wrappers that apply a policy and then
delegate:

- `admin_browser_update_row`
- `admin_browser_insert_row`
- `admin_browser_delete_row`

Only `src/app/admin/database/actions.ts` calls them. The dedicated admin actions
keep calling the unwrapped functions, so their behaviour is unchanged.

### The policy

**Tables the browser may not insert into, update, or delete from at all:**

| Table | Why |
| --- | --- |
| `moderation_audit_log` | An audit trail a privileged user can rewrite is not an audit trail |
| `security_events` | Same argument, for the security-event stream |
| `rate_limit_events` | Deleting rows resets any limit for anyone, invisibly |
| `user_sessions` | Editing session records is a session-fixation primitive, not an admin task |
| `profile_private` | The private-PII sidecar; no admin workflow edits it |
| `push_subscriptions` | User-owned device endpoints; writing them means pushing to someone else's device |

**`profiles` columns the browser may not write:** `id`, `admin_role`,
`is_admin`, `is_banned`, `verified`, `shadow_banned`, `suspended_until`,
`posting_restricted_until`, `aura_score`, `xp`, `level`.

Every one of those has a dedicated audited action that captures a reason and
fires the right side effects (`admin_set_ban`, `admin_adjust_aura`,
`set_shadow_ban`, `issue_strike`, `setUserRole`, `setVerified`). Blocking them in
the *generic* editor costs no capability; it removes a redundant weaker path.

**`profiles` rows may not be inserted or deleted from the browser.** A profile
exists because `handle_new_user()` created it from an `auth.users` insert — one
made here would have no matching auth user. And deleting one cascades across the
whole social graph with a single audit row to show for it.

### The policy is hardcoded on purpose

It lives in `_admin_browser_denied_tables()` and
`_admin_browser_denied_profile_columns()`, not in a config table. A policy table
would be self-defeating: the browser could edit the table that says what the
browser may edit. Changing the policy requires a migration and a code review.
That is the feature.

## What is still true

- **Reads are unconstrained.** `admin_table_rows` is `SECURITY DEFINER` and
  bypasses RLS, so a `super_admin` can read every row of every table in
  `public`, including private messages and the PII sidecar. This is deliberate
  for an owner-operated campus app, but it is a real property to be aware of:
  `super_admin` is not a "moderator with extra buttons", it is full read access
  to the database. Grant it accordingly, and keep 2FA on the accounts that hold
  it (`docs/security/2fa-checklist.md`).
- **`app_settings` and `feature_flags` remain editable** from the browser. They
  have no other admin UI, so denying them would remove a capability rather than
  redirect it. If a dedicated settings screen is ever built, add them to the
  denied-tables list at that point.
- **There is no SQL console.** Migration `0042` created
  `public.admin_run_sql(text, boolean)`; migration `0067` dropped it. Ad-hoc SQL
  goes through the Supabase dashboard editor, behind the Supabase account and
  its 2FA. Verify the function is really absent in production with
  `supabase/tests/admin_sql_console_absent.sql`.

## Deployment order

Migration 0149 must be applied **before** the application code that calls the
wrappers is deployed. `src/app/admin/database/actions.ts` now calls
`admin_browser_*`; if those functions do not exist yet, every edit in the table
browser fails with an "unknown function" error until the migration lands.

Nothing else in the app calls them, so the blast radius of getting the order
wrong is the `/admin/database` edit buttons only — but get it right anyway.

## If the guard refuses something

The error names the table or column and points at the dedicated action. That is
the guard working as designed. Do not "fix" it by pointing
`src/app/admin/database/actions.ts` back at the unwrapped RPCs. Either use the
dedicated action, or — for a genuine one-off — use the Supabase dashboard SQL
editor, where the action is attributable to a Supabase account rather than an
application session.
