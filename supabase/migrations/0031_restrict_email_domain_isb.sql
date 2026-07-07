-- =============================================================================
-- FAST SOCIO — Restrict signups to the Islamabad campus domain
--
-- Narrows the server-side signup gate from the org-wide `nu.edu.pk` (plus any
-- campus subdomain) to the Islamabad campus only: `isb.nu.edu.pk`. Replaces the
-- rule installed in 0021_enforce_signup_email_domain.sql. Existing accounts are
-- unaffected (the trigger fires BEFORE INSERT on auth.users, i.e. on new signups
-- only). Keep in sync with ALLOWED_EMAIL_DOMAINS in src/lib/auth/email.ts.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.enforce_signup_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  email_norm text := lower(coalesce(new.email, ''));
  domain     text := split_part(email_norm, '@', 2);
  dev_allow  text;
begin
  -- Primary rule: FAST NUCES Islamabad campus (and any sub-subdomain of it).
  if domain = 'isb.nu.edu.pk' or domain like '%.isb.nu.edu.pk' then
    return new;
  end if;

  -- Optional dogfooding escape hatch: exact-match allow-list of full addresses.
  select value into dev_allow from private.app_config where key = 'dev_allowed_emails';
  if dev_allow is not null
     and email_norm = any (string_to_array(lower(replace(dev_allow, ' ', '')), ','))
  then
    return new;
  end if;

  raise exception 'Signups are restricted to @isb.nu.edu.pk email addresses'
    using errcode = 'check_violation';
end;
$$;
