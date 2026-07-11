-- =============================================================================
-- FAST SOCIO — Refactor Phase 1: Foundation (feature flags, maintenance mode,
-- session/device registry, user-facing security audit).
--
-- Additive only. No existing table, column, policy or function is dropped or
-- altered. Everything here is new scaffolding that later phases build on:
--   * feature_flags   — client-gateable toggles with staged % rollout
--   * app_settings    — key/value config (maintenance mode, min version, …)
--   * user_sessions   — per-login device registry (Settings → Security, P8)
--   * security_events — user-visible audit trail (login, pw/email change, …)
--
-- RLS follows the audit-C1 initplan pattern: auth.uid() is always wrapped in a
-- scalar subquery so it evaluates once per statement, not once per row.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. feature_flags
--    Readable by every authenticated user so the client shell can gate tabs.
--    Only super_admins may mutate (via the existing admin console session).
-- ---------------------------------------------------------------------------
create table public.feature_flags (
  key          text primary key,
  enabled      boolean not null default false,
  -- Staged rollout: when enabled, a deterministic per-user hash decides
  -- exposure. 100 = everyone, 0 = nobody (but still "enabled" for targeting).
  rollout_pct  smallint not null default 100 check (rollout_pct between 0 and 100),
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null
);

alter table public.feature_flags enable row level security;

create policy "feature flags readable by authenticated users"
  on public.feature_flags for select
  to authenticated
  using (true);

create policy "super admins manage feature flags"
  on public.feature_flags for all
  to authenticated
  using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

-- Deterministic, stable per-user rollout check. Same user + same key always
-- resolves to the same bucket, so a 30% rollout is a fixed 30% cohort rather
-- than a coin flip on every request. Falls open (returns false) for unknown
-- keys so a missing flag never accidentally exposes a feature.
create or replace function public.flag_enabled(p_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when f.key is null then false
    when not f.enabled then false
    when f.rollout_pct >= 100 then true
    when f.rollout_pct <= 0 then false
    else (abs(hashtextextended(p_key || ':' || coalesce(auth.uid()::text, 'anon'), 0)) % 100) < f.rollout_pct
  end
  from (select 1) _
  left join public.feature_flags f on f.key = p_key;
$$;

grant execute on function public.flag_enabled(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app_settings — small key/value config store (non-secret operational knobs)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

alter table public.app_settings enable row level security;

create policy "app settings readable by authenticated users"
  on public.app_settings for select
  to authenticated
  using (true);

create policy "super admins manage app settings"
  on public.app_settings for all
  to authenticated
  using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- Convenience reader for the maintenance interstitial in the root shell.
create or replace function public.is_maintenance_mode()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> 'enabled')::boolean
                   from public.app_settings where key = 'maintenance'), false);
$$;

grant execute on function public.is_maintenance_mode() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. user_sessions — device registry captured at login
--    One row per (user, device) heartbeat window. last_active_at is refreshed
--    by the presence path; revoked_at powers "log out this device" in P8.
-- ---------------------------------------------------------------------------
create table public.user_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  device_label  text,
  user_agent    text,
  ip            text,
  created_at    timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  revoked_at    timestamptz
);

create index user_sessions_user_idx on public.user_sessions (user_id, last_active_at desc);

alter table public.user_sessions enable row level security;

-- A user sees and manages only their own sessions; admins may read all.
create policy "users read own sessions"
  on public.user_sessions for select
  to authenticated
  using ((user_id = (select auth.uid())) or public.is_admin((select auth.uid())));

create policy "users revoke own sessions"
  on public.user_sessions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Upsert-style session recorder. Collapses repeat logins from the same
-- user-agent into one live row (refreshing last_active_at) instead of spamming
-- the table on every server render.
create or replace function public.record_session(
  p_device_label text default null,
  p_user_agent   text default null,
  p_ip           text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    return null;
  end if;

  select id into v_id
  from public.user_sessions
  where user_id = v_uid
    and coalesce(user_agent, '') = coalesce(p_user_agent, '')
    and revoked_at is null
  order by last_active_at desc
  limit 1;

  if v_id is null then
    insert into public.user_sessions (user_id, device_label, user_agent, ip)
    values (v_uid, p_device_label, p_user_agent, p_ip)
    returning id into v_id;
  else
    update public.user_sessions
      set last_active_at = now(),
          ip = coalesce(p_ip, ip),
          device_label = coalesce(p_device_label, device_label)
      where id = v_id;
  end if;

  return v_id;
end $$;

grant execute on function public.record_session(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. security_events — user-visible security audit trail
--    Distinct from moderation_audit_log (admin actions on others). This is the
--    user's OWN security timeline: logins, password/email change, export, etc.
-- ---------------------------------------------------------------------------
create table public.security_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  event       text not null,
  ip          text,
  user_agent  text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index security_events_user_idx on public.security_events (user_id, created_at desc);

alter table public.security_events enable row level security;

-- Insert-only from the user's perspective (writes go through the definer fn).
-- Users read their own; admins read all. No update/delete policy => immutable.
create policy "users read own security events"
  on public.security_events for select
  to authenticated
  using ((user_id = (select auth.uid())) or public.is_admin((select auth.uid())));

create or replace function public.log_security_event(
  p_event      text,
  p_ip         text default null,
  p_user_agent text default null,
  p_metadata   jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  insert into public.security_events (user_id, event, ip, user_agent, metadata)
  values (v_uid, p_event, p_ip, p_user_agent, coalesce(p_metadata, '{}'::jsonb));
end $$;

grant execute on function public.log_security_event(text, text, text, jsonb) to authenticated;

-- Harden: Postgres grants EXECUTE to PUBLIC by default, which would let the
-- anon role call these definer functions. They all no-op for a null auth.uid(),
-- but we still lock them to authenticated to clear the security advisor and
-- keep the surface minimal.
revoke execute on function public.flag_enabled(text) from public, anon;
revoke execute on function public.is_maintenance_mode() from public, anon;
revoke execute on function public.record_session(text, text, text) from public, anon;
revoke execute on function public.log_security_event(text, text, text, jsonb) from public, anon;

-- ---------------------------------------------------------------------------
-- 5. Seed — flags for the primary destinations (all on) + maintenance off.
--    Idempotent so re-running the migration is safe.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, enabled, rollout_pct, description) values
  ('discover',    true, 100, 'Discover / compatibility swipe deck'),
  ('events',      true, 100, 'Events system'),
  ('leaderboard', true, 100, 'Aura leaderboard & rankings'),
  ('communities', true, 100, 'Communities / society channels')
on conflict (key) do nothing;

insert into public.app_settings (key, value) values
  ('maintenance', '{"enabled": false, "message": ""}'::jsonb),
  ('min_app_version', '{"version": "0.0.0"}'::jsonb)
on conflict (key) do nothing;
