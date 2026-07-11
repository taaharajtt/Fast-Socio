-- =============================================================================
-- FAST SOCIO — Refactor Phase 8: Settings privacy, security & account controls.
--
-- Additive. Adds the privacy/visibility surface the Settings module drives, an
-- account deactivate flag, a username-change cooldown, and a muted_users table.
-- Enforcement that must live in SQL (Discover eligibility) is folded into the
-- existing get_discover_candidates via create-or-replace (signature unchanged);
-- app-layer enforcement (profile page, chat receipts) lives in the client.
--
-- Deferred (per plan / stack): 2FA/OTP, phone, connected accounts, biometrics,
-- trusted-device scoring — incompatible with the magic-link + free-tier stack.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Privacy + account columns. All default to today's (open) behaviour so
--    nothing changes until a user opts in.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists discoverable        boolean not null default true,
  add column if not exists searchable          boolean not null default true,
  add column if not exists show_online         boolean not null default true,
  add column if not exists read_receipts       boolean not null default true,
  add column if not exists show_aura           boolean not null default true,
  add column if not exists show_department     boolean not null default true,
  add column if not exists show_semester       boolean not null default true,
  add column if not exists profile_visibility  text not null default 'public'
    check (profile_visibility in ('public', 'university')),
  add column if not exists deactivated_at      timestamptz,
  add column if not exists username_changed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Username-change cooldown (30 days). Enforced in a trigger so it holds no
--    matter which path performs the update; stamps username_changed_at.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_username_cooldown()
returns trigger
language plpgsql
as $$
begin
  -- Only cooldown post-onboarding changes; during onboarding the username may be
  -- set/edited freely (the wizard autosaves), and the clock starts on the first
  -- real change afterwards.
  if new.username is distinct from old.username and old.onboarding_completed then
    if old.username_changed_at is not null
       and old.username_changed_at > now() - interval '30 days' then
      raise exception 'username can only be changed once every 30 days'
        using errcode = 'check_violation';
    end if;
    new.username_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger profiles_username_cooldown
  before update on public.profiles
  for each row execute function public.enforce_username_cooldown();

-- ---------------------------------------------------------------------------
-- 3. muted_users — a soft, one-directional hide (weaker than a block; the muted
--    user is unaware). Self-managed.
-- ---------------------------------------------------------------------------
create table public.muted_users (
  muter_id    uuid not null references public.profiles (id) on delete cascade,
  muted_id    uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);

create index muted_users_muter_idx on public.muted_users (muter_id);

alter table public.muted_users enable row level security;

create policy "users read their mutes"
  on public.muted_users for select to authenticated
  using (muter_id = (select auth.uid()));

create policy "users add their mutes"
  on public.muted_users for insert to authenticated
  with check (muter_id = (select auth.uid()));

create policy "users remove their mutes"
  on public.muted_users for delete to authenticated
  using (muter_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Discover eligibility now honours discoverable + deactivation + mutes.
--    Body is identical to mig 0054 except the three added base filters.
-- ---------------------------------------------------------------------------
create or replace function public.get_discover_candidates(p_limit integer default 20)
returns table (
  id                    uuid,
  full_name             text,
  department            text,
  semester              smallint,
  bio                   text,
  avatar_url            text,
  interests             text[],
  gender                text,
  aura_score            integer,
  verified              boolean,
  is_recycled           boolean,
  compatibility         smallint,
  shared_interests      text[]
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select
      p.id as uid,
      p.department as my_dept,
      p.semester as my_sem,
      p.interests as my_interests,
      p.pref_semester_min,
      p.pref_semester_max,
      p.pref_verified_only,
      array(select community_id from public.community_members where user_id = p.id) as my_comms
    from public.profiles p
    where p.id = auth.uid()
  ),
  base as (
    select p.*
    from public.profiles p, me
    where p.id <> me.uid
      and p.onboarding_completed = true
      and p.is_banned = false
      -- Phase 8 privacy: respect Discover opt-out + account deactivation.
      and p.discoverable = true
      and p.deactivated_at is null
      and not exists (
        select 1 from public.blocked_users b
        where (b.blocker_id = me.uid and b.blocked_id = p.id)
           or (b.blocker_id = p.id and b.blocked_id = me.uid)
      )
      and not exists (
        select 1 from public.muted_users mu
        where mu.muter_id = me.uid and mu.muted_id = p.id
      )
      and not exists (
        select 1 from public.matches m
        where m.user_low = least(me.uid, p.id)
          and m.user_high = greatest(me.uid, p.id)
      )
  ),
  fresh as (
    select b.*, false as is_recycled, 0 as tier, b.created_at as sort_key
    from base b, me
    where not exists (
      select 1 from public.swipes s
      where s.swiper_id = me.uid and s.target_id = b.id
    )
  ),
  seen as (
    select b.*, true as is_recycled, 1 as tier, s.created_at as sort_key
    from base b
    join me on true
    join public.swipes s on s.swiper_id = me.uid and s.target_id = b.id
  ),
  merged as (
    select * from fresh
    union all
    select * from seen
  ),
  scored as (
    select
      m.*,
      si.shared as shared_arr,
      coalesce(array_length(si.shared, 1), 0) as shared_n,
      (select count(*) from public.community_members cm
        where cm.user_id = m.id and cm.community_id = any (me.my_comms)) as mutual_comms,
      me.my_dept, me.my_sem,
      me.pref_semester_min as v_pref_min,
      me.pref_semester_max as v_pref_max,
      me.pref_verified_only as v_pref_verified
    from merged m
    cross join me
    left join lateral (
      select array(select unnest(m.interests) intersect select unnest(me.my_interests)) as shared
    ) si on true
  ),
  weighted as (
    select
      s.*,
      least(100, greatest(1, round(
          (case when s.my_dept is not null and s.department = s.my_dept then 25 else 0 end)
        + (case when s.my_sem is not null and s.semester is not null
                then 15 * (1 - least(abs(s.semester - s.my_sem), 4) / 4.0) else 0 end)
        + least(s.shared_n, 4) * 8
        + least(s.mutual_comms, 3) * 6
        + least(10, 1.5 * ln(1 + greatest(s.aura_score, 0)))
        + (case when s.v_pref_min is not null and s.v_pref_max is not null
                 and s.semester between s.v_pref_min and s.v_pref_max then 8 else 0 end)
        + (case when s.v_pref_verified and s.verified then 5 else 0 end)
      ))::smallint) as compatibility
    from scored s
  ),
  diversified as (
    select w.*,
      row_number() over (partition by w.tier, w.department
                         order by w.compatibility desc, w.sort_key desc) as dept_rank
    from weighted w
  )
  select
    id, full_name, department, semester, bio, avatar_url,
    interests, gender, aura_score, verified, is_recycled,
    compatibility,
    coalesce(shared_arr, '{}') as shared_interests
  from diversified
  order by
    tier asc,
    dept_rank asc,
    compatibility desc,
    case when tier = 0 then sort_key end desc nulls last,
    case when tier = 1 then sort_key end asc nulls last
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.get_discover_candidates(integer) from public;
revoke execute on function public.get_discover_candidates(integer) from anon;
grant execute on function public.get_discover_candidates(integer) to authenticated;
