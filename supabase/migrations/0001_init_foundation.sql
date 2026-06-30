-- =============================================================================
-- FAST SOCIO — Foundation schema (Phase 0/1)
-- Encodes the 2026-06-24 kickoff architecture review (Decision #005):
--   * RLS enabled on EVERY table in the same migration that creates it.
--   * profiles.aura_score is a READ-ONLY cache recomputed by a trigger from
--     aura_transactions (the single source of truth).
--   * reports are polymorphic (target_type / target_id).
--   * moderation_audit_log is insert-only (no update/delete, even by admins).
--   * day-one indexes on every foreign key and hot filter column.
-- =============================================================================

-- Allow forward references in function bodies (e.g. is_admin references
-- profiles before it is created). Scoped to this migration transaction.
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.report_target_type as enum (
  'profile', 'post', 'comment', 'message', 'community', 'event'
);

create type public.report_status as enum (
  'pending', 'reviewing', 'actioned', 'dismissed'
);

create type public.aura_reason as enum (
  'match', 'event_attend', 'post_created', 'post_liked',
  'community_join', 'daily_login', 'profile_completed', 'admin_adjust'
);

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Keep updated_at fresh on any table that has the column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Admin check used across RLS policies. SECURITY DEFINER so policies can read
-- profiles.is_admin without recursing into profiles' own RLS.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = uid), false);
$$;

-- ===========================================================================
-- profiles  (1:1 with auth.users)
-- ===========================================================================
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique,
  full_name    text,
  department   text,
  semester     smallint check (semester between 1 and 12),
  bio          text check (char_length(bio) <= 300),
  avatar_url   text,
  -- Read-only cache; recomputed by trigger from aura_transactions.
  aura_score   integer not null default 0,
  is_admin     boolean not null default false,
  is_banned    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_department_idx on public.profiles (department);
create index profiles_aura_score_idx on public.profiles (aura_score desc);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- Any authenticated user can read profiles (Discover/Feed need this).
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

-- A user can insert only their own profile row.
create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- A user can update their own profile, but NOT privileged/cache columns.
create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Guard privileged columns against self-escalation. aura_score, is_admin and
-- is_banned may only change via SECURITY DEFINER functions / service role.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    new.aura_score := old.aura_score;
    new.is_admin   := old.is_admin;
    new.is_banned  := old.is_banned;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ===========================================================================
-- aura_transactions  (single source of truth for Aura points)
-- ===========================================================================
create table public.aura_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  delta       integer not null,
  reason      public.aura_reason not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index aura_transactions_user_id_idx on public.aura_transactions (user_id);
create index aura_transactions_created_at_idx on public.aura_transactions (created_at desc);

alter table public.aura_transactions enable row level security;

-- A user may read their own ledger; admins may read all.
create policy "users read own aura transactions"
  on public.aura_transactions for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- No client writes: Aura is awarded only via SECURITY DEFINER functions /
-- service role, never directly from the app. (No insert/update/delete policy.)

-- Recompute the cached aura_score whenever the ledger changes.
create or replace function public.recompute_aura_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.user_id, old.user_id);
begin
  update public.profiles
     set aura_score = coalesce(
       (select sum(delta) from public.aura_transactions where user_id = target), 0)
   where id = target;
  return null;
end;
$$;

create trigger aura_transactions_recompute
  after insert or update or delete on public.aura_transactions
  for each row execute function public.recompute_aura_score();

-- ===========================================================================
-- blocked_users
-- ===========================================================================
create table public.blocked_users (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocked_users_blocked_id_idx on public.blocked_users (blocked_id);

alter table public.blocked_users enable row level security;

create policy "users manage their own block list"
  on public.blocked_users for all
  to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- ===========================================================================
-- reports  (polymorphic: target_type / target_id)
-- ===========================================================================
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references public.profiles (id) on delete cascade,
  target_type   public.report_target_type not null,
  target_id     uuid not null,
  reason        text not null,
  details       text,
  status        public.report_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index reports_target_idx on public.reports (target_type, target_id);
create index reports_status_idx on public.reports (status);
create index reports_reporter_id_idx on public.reports (reporter_id);

create trigger reports_set_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

alter table public.reports enable row level security;

create policy "users can file reports"
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

create policy "reporters read own reports, admins read all"
  on public.reports for select
  to authenticated
  using (reporter_id = auth.uid() or public.is_admin(auth.uid()));

create policy "admins update report status"
  on public.reports for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- moderation_audit_log  (insert-only; immutable record of mod actions)
-- ===========================================================================
create table public.moderation_audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references public.profiles (id) on delete set null,
  action        text not null,
  target_type   public.report_target_type,
  target_id     uuid,
  reason        text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index moderation_audit_log_target_idx
  on public.moderation_audit_log (target_type, target_id);
create index moderation_audit_log_actor_idx
  on public.moderation_audit_log (actor_id);

alter table public.moderation_audit_log enable row level security;

-- Admins may read; nobody may update or delete (insert-only by design, written
-- via SECURITY DEFINER functions such as the deanonymization routine).
create policy "admins read moderation audit log"
  on public.moderation_audit_log for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ===========================================================================
-- notification_preferences  (1:1 with profiles)
-- ===========================================================================
create table public.notification_preferences (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  matches        boolean not null default true,
  messages       boolean not null default true,
  likes          boolean not null default true,
  events         boolean not null default true,
  communities    boolean not null default true,
  system         boolean not null default true,
  updated_at     timestamptz not null default now()
);

create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;

create policy "users manage their own notification preferences"
  on public.notification_preferences for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===========================================================================
-- push_subscriptions  (one row per user x device endpoint)
-- ===========================================================================
create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "users manage their own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===========================================================================
-- rate_limit_events  (server-side throttle ledger; no client access)
-- ===========================================================================
create table public.rate_limit_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete cascade,
  action      text not null,
  created_at  timestamptz not null default now()
);

create index rate_limit_events_lookup_idx
  on public.rate_limit_events (user_id, action, created_at desc);

alter table public.rate_limit_events enable row level security;
-- No policies: only the service role / SECURITY DEFINER functions touch this.

-- ===========================================================================
-- New-user bootstrap: create profile + default notification preferences when
-- an auth user is created.
-- ===========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', null))
    on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
