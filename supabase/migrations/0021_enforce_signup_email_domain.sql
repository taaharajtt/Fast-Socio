-- =============================================================================
-- FAST SOCIO — Server-side signup email-domain enforcement (audit fix P1-02)
--
-- The @nu.edu.pk restriction was enforced ONLY in the login React component
-- (src/lib/auth/email.ts). Because the public anon key + URL ship in every
-- client bundle, anyone could call auth.signInWithOtp({ shouldCreateUser:true })
-- directly with an off-domain address and self-provision a fully-privileged
-- account in the closed campus network. This adds a BEFORE INSERT trigger on
-- auth.users that rejects non-allowed domains at the database — the single
-- authoritative gate. Mirrors the existing on_auth_user_created trigger pattern
-- (0001) which already fires on auth.users.
--
-- Keep the allow-list in sync with ALLOWED_EMAIL_DOMAINS in
-- src/lib/auth/email.ts. An optional comma-separated dogfooding allow-list of
-- FULL addresses can be stored in private.app_config (key 'dev_allowed_emails')
-- so off-domain test accounts can be permitted without a code/schema change —
-- absent by default, so production only accepts nu.edu.pk.
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
  -- Primary rule: FAST NUCES domain (and any campus subdomain, e.g. khi.nu.edu.pk).
  if domain = 'nu.edu.pk' or domain like '%.nu.edu.pk' then
    return new;
  end if;

  -- Optional dogfooding escape hatch: exact-match allow-list of full addresses.
  select value into dev_allow from private.app_config where key = 'dev_allowed_emails';
  if dev_allow is not null
     and email_norm = any (string_to_array(lower(replace(dev_allow, ' ', '')), ','))
  then
    return new;
  end if;

  raise exception 'Signups are restricted to @nu.edu.pk email addresses'
    using errcode = 'check_violation';
end;
$$;

-- Fire before the app's own handle_new_user bootstrap so a rejected signup never
-- creates a profile row.
drop trigger if exists enforce_signup_email_domain_before_insert on auth.users;
create trigger enforce_signup_email_domain_before_insert
  before insert on auth.users
  for each row execute function public.enforce_signup_email_domain();
