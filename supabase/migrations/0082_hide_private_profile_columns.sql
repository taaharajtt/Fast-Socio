-- =============================================================================
-- FAST SOCIO — VULN-04 attempt: column-level SELECT restriction on profiles
--
-- NOTE: This migration is immediately reverted by 0083. It is kept in the
-- history for traceability. DO NOT reintroduce this approach as-is.
--
-- Goal: stop any authenticated user from reading every profile's private
-- matching preferences + date_of_birth via the REST API. Since RLS is row-level
-- only, this tried PostgreSQL COLUMN-level SELECT privileges (revoke blanket
-- SELECT, re-grant all columns except the private ones).
--
-- Why it was reverted: PostgreSQL requires table-level SELECT for
-- `INSERT ... ON CONFLICT DO UPDATE` on the written columns. The onboarding
-- wizard upserts these exact preference columns, so the restriction broke the
-- onboarding save (42501). VULN-04 must instead be solved with a schema change
-- (move private prefs into an owner-only side table, and/or a public_profiles
-- view for cross-user reads) — see 0083 and the security notes.
-- =============================================================================

create or replace function public.get_my_profile()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select to_jsonb(p) from public.profiles p where p.id = auth.uid();
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name not in (
      'relationship_pref','pref_genders','pref_semester_min',
      'pref_semester_max','pref_verified_only','date_of_birth'
    );

  revoke select on public.profiles from authenticated, anon;
  execute format('grant select (%s) on public.profiles to authenticated', cols);
end $$;
