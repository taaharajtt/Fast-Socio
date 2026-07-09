-- M0 foundation for the admin console: two-tier roles + audit enrichment.
-- (Applied to the live DB as migration 0036_admin_m0_foundation.)

-- 1. Role tier. NULL admin_role = not an admin.
create type public.admin_role as enum ('moderator', 'super_admin');

alter table public.profiles add column admin_role public.admin_role;

-- Backfill: every current admin becomes a super_admin.
update public.profiles set admin_role = 'super_admin' where is_admin;

-- 2. Keep the legacy is_admin boolean (read by is_admin() + RLS everywhere) in
--    perfect sync with admin_role, so nothing downstream breaks.
create or replace function public.sync_is_admin()
returns trigger language plpgsql as $$
begin
  new.is_admin := new.admin_role is not null;
  return new;
end $$;

create trigger trg_profiles_sync_is_admin
  before insert or update of admin_role on public.profiles
  for each row execute function public.sync_is_admin();

-- 3. Role helper for RLS / server gating.
create or replace function public.is_super_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.admin_role = 'super_admin' from public.profiles p where p.id = uid), false);
$$;

-- 4. Audit enrichment: before/after snapshots + request IP.
alter table public.moderation_audit_log
  add column before_data jsonb,
  add column after_data jsonb,
  add column ip text;

-- 5. Generic audit sink for console actions. target_type is a fixed enum, so
--    generic actions leave it null and carry their semantic type in metadata.
create or replace function public.log_admin_action(
  p_action   text,
  p_reason   text  default null,
  p_target_id uuid default null,
  p_before   jsonb default null,
  p_after    jsonb default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  insert into public.moderation_audit_log
    (actor_id, action, target_id, reason, metadata, before_data, after_data)
  values
    (auth.uid(), p_action, p_target_id, p_reason, coalesce(p_metadata, '{}'::jsonb), p_before, p_after);
end $$;

grant execute on function public.is_super_admin(uuid) to authenticated;
grant execute on function public.log_admin_action(text, text, uuid, jsonb, jsonb, jsonb) to authenticated;
