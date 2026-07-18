-- =============================================================================
-- FAST SOCIO — Admit pre-2023 Islamabad students on the org-wide email domain
--
-- Batches before Fall 2023 were issued addresses under the bare `nu.edu.pk`
-- domain (shared by every FAST campus) rather than `isb.nu.edu.pk`. Widens the
-- signup gate (0031_restrict_email_domain_isb.sql) to also accept those, but
-- only when the local-part is an Islamabad roll number — "i" followed by six
-- digits, e.g. i221000@nu.edu.pk — so other campuses stay excluded. Keep in
-- sync with isValidFastEmail in src/lib/auth/email.ts.
--
-- Username derivation is unaffected: username_from_email (mig 0094) takes the
-- local-part, which for these users is already the roll number.
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
  local_part text := split_part(email_norm, '@', 1);
  domain     text := split_part(email_norm, '@', 2);
  dev_allow  text;
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

  -- Optional dogfooding escape hatch: exact-match allow-list of full addresses.
  select value into dev_allow from private.app_config where key = 'dev_allowed_emails';
  if dev_allow is not null
     and email_norm = any (string_to_array(lower(replace(dev_allow, ' ', '')), ','))
  then
    return new;
  end if;

  raise exception 'Signups are restricted to FAST Islamabad email addresses'
    using errcode = 'check_violation';
end;
$$;
