-- =============================================================================
-- FAST SOCIO — data-driven allow-list for cross-campus signup exceptions
--
-- WHY
-- The signup gate (0031 → 0097) is a hard-coded rule set: Islamabad domain,
-- plus pre-2023 Islamabad roll numbers on the org-wide domain. Admitting one
-- individual from another campus (the first case: a Lahore student on
-- lhr.nu.edu.pk) meant editing the trigger body, which is both a migration and
-- a deploy for a single row of data. Worse, the tempting shortcut — editing
-- 0097 in place — is a silent no-op, because 0097 has already run against
-- production; only a NEW migration can change a live function.
--
-- WHAT
-- Moves the exception list into `private.app_config` under the key
-- `signup_allowed_emails` (same shape as the existing `dev_allowed_emails`:
-- a comma-separated list of full addresses, matched case-insensitively). The
-- next exception is then one UPDATE, no migration and no deploy.
--
-- The two keys stay separate on purpose. `dev_allowed_emails` is the
-- dogfooding escape hatch and is expected to be empty in production;
-- `signup_allowed_emails` is a permanent record of individually approved
-- students and is expected to be non-empty. Collapsing them would make
-- "should this be empty in prod?" unanswerable.
--
-- Campus rules are NOT moved here. They are policy, they belong in code where
-- they can be reviewed, and src/lib/auth/email.ts must mirror them for the
-- client-side form gate. Only individual exceptions become data.
--
-- NOTE ON THE CLIENT
-- src/lib/auth/email.ts keeps its own tiny hard-coded exception list. That
-- check is UX only (it greys out the submit button); this trigger is the
-- authoritative gate. An address present here but missing there simply gets a
-- disabled button until the next deploy — it cannot let an unapproved address
-- through.
-- =============================================================================

insert into private.app_config (key, value)
values ('signup_allowed_emails', 'l257838@lhr.nu.edu.pk')
on conflict (key) do update set value = excluded.value;

set check_function_bodies = off;

create or replace function public.enforce_signup_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  email_norm  text := lower(coalesce(new.email, ''));
  local_part  text := split_part(email_norm, '@', 1);
  domain      text := split_part(email_norm, '@', 2);
  allow_list  text;
begin
  -- Primary rule: FAST NUCES Islamabad campus (and any sub-subdomain of it).
  if domain = 'isb.nu.edu.pk' or domain like '%.isb.nu.edu.pk' then
    return new;
  end if;

  -- Legacy rule: pre-2023 Islamabad batches on the org-wide domain. The "i"
  -- prefix is the Islamabad campus code, so other campuses remain excluded.
  if domain = 'nu.edu.pk' and local_part ~ '^i[0-9]{6}$' then
    return new;
  end if;

  -- Individually approved cross-campus students, and the dogfooding hatch.
  for allow_list in
    select value from private.app_config
     where key in ('signup_allowed_emails', 'dev_allowed_emails')
  loop
    if allow_list is not null
       and email_norm = any (string_to_array(lower(replace(allow_list, ' ', '')), ','))
    then
      return new;
    end if;
  end loop;

  raise exception 'Signups are restricted to FAST Islamabad email addresses'
    using errcode = 'check_violation';
end;
$$;
