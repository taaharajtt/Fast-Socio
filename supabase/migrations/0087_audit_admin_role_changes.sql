-- =============================================================================
-- FAST SOCIO — F8/F15: tamper-evident audit of every admin_role change
--
-- Gap named directly in SECURITY-INCIDENT-2026-07-15.md §3: the attacker's
-- self-grant of super_admin happened "with no approval and no audit entry".
-- The only thing writing moderation_audit_log was the admin console, and a
-- direct PATCH /rest/v1/profiles bypasses it entirely -- so the single most
-- important event of the whole incident (10:24:36 UTC, the escalation) left no
-- trace in our own records. It had to be reconstructed afterwards from Supabase
-- edge logs, which retain only ~24h (§9 recommends preserving them urgently).
--
-- Migration 0084's column allowlist now blocks non-owner grants at the grant
-- layer, but that is not a reason to skip auditing: a service-role or postgres
-- level grant -- e.g. via the leaked platform access token whose rotation is
-- still outstanding per incident §7 -- bypasses grants entirely and would
-- otherwise be silent all over again.
--
-- This AFTER trigger records EVERY admin_role assignment or change at the
-- database level and captures the SQL role that made it (current_user), so a
-- direct SQL or service-role grant is logged and attributable rather than
-- invisible. It is the detection half of the fix; 0084 is the prevention half.
--
-- PROVENANCE: this trigger is ALREADY LIVE on production -- it was applied
-- out-of-band during the 2026-07-15 remediation and never recorded in
-- supabase_migrations.schema_migrations. That is exactly the drift the
-- hardening plan flags as F15 ("hardening migrations applied out-of-band").
-- This file is reverse-engineered from the live definition (captured
-- 2026-07-17 via pg_get_functiondef) so the repo and the database agree.
-- It proved itself in the meantime: it is what logged the legitimate
-- 2026-07-15 17:51 super_admin grant, with db_user=postgres attributed.
--
-- Idempotent (create or replace + drop/create trigger): re-running against live
-- is a no-op.
--
-- Follow-up, not covered here: hook an external alert off
-- `action like 'security.admin_role%'` so a future grant pages a human instead
-- of merely being recorded (plan Phase 2, item 10).
-- =============================================================================
set check_function_bodies = off;

create or replace function public.audit_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.admin_role is not null then
      insert into public.moderation_audit_log(actor_id, action, target_id, reason, metadata)
      values (auth.uid(), 'security.admin_role_set', new.id,
              'admin_role assigned at row creation',
              jsonb_build_object('new_role', new.admin_role, 'db_user', current_user));
    end if;
  elsif new.admin_role is distinct from old.admin_role then
    insert into public.moderation_audit_log(actor_id, action, target_id, reason, metadata)
    values (auth.uid(), 'security.admin_role_change', new.id,
            format('admin_role %s -> %s',
                   coalesce(old.admin_role::text, 'none'),
                   coalesce(new.admin_role::text, 'none')),
            jsonb_build_object('old_role', old.admin_role, 'new_role', new.admin_role,
                               'db_user', current_user));
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_audit_admin_role on public.profiles;
create trigger trg_audit_admin_role
after insert or update of admin_role on public.profiles
for each row execute function public.audit_admin_role_change();
