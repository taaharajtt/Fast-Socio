-- =============================================================================
-- FAST SOCIO — Refactor Phase 9b: Strikes, shadow ban & appeals.
--
--   * user_strikes + escalating restrictions (warn → post-cooldown → suspend →
--     permanent review), each notifying the user.
--   * shadow_banned / posting_restricted_until / suspended_until on profiles;
--     shadow ban is excluded from Discover + the feed (messages unaffected, no
--     visible indication). This also closes the Phase 8 feed-mute gap.
--   * appeals: a user-submittable queue with an admin decision that lifts the
--     matching restriction.
--
-- Discover RPC + feed_posts view are re-issued (create-or-replace, signatures
-- unchanged) to fold in the new exclusions.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Enforcement columns.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists shadow_banned            boolean not null default false,
  add column if not exists posting_restricted_until timestamptz,
  add column if not exists suspended_until          timestamptz;

-- Guard the new punitive columns from self-edit (extends the existing trigger).
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    new.aura_score := old.aura_score;
    new.is_admin   := old.is_admin;
    new.is_banned  := old.is_banned;
    new.xp         := old.xp;
    new.level      := old.level;
    new.shadow_banned            := old.shadow_banned;
    new.posting_restricted_until := old.posting_restricted_until;
    new.suspended_until          := old.suspended_until;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. user_strikes.
-- ---------------------------------------------------------------------------
create table public.user_strikes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  level       smallint not null,
  reason      text not null,
  issued_by   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index user_strikes_user_idx on public.user_strikes (user_id, created_at desc);

alter table public.user_strikes enable row level security;

-- A user can see their own strikes (transparency); admins see all.
create policy "users read own strikes"
  on public.user_strikes for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin((select auth.uid())));

-- ---------------------------------------------------------------------------
-- 3. appeals.
-- ---------------------------------------------------------------------------
create table public.appeals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  subject      text not null check (subject in
                 ('strike', 'posting_restriction', 'suspension', 'shadow_ban', 'content', 'ban')),
  explanation  text not null check (char_length(explanation) between 10 and 1000),
  status       text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index appeals_open_idx on public.appeals (created_at desc) where status = 'open';
create index appeals_user_idx on public.appeals (user_id, created_at desc);

alter table public.appeals enable row level security;

create policy "users read own appeals"
  on public.appeals for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin((select auth.uid())));

create policy "users file their own appeals"
  on public.appeals for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open');

-- ---------------------------------------------------------------------------
-- 4. issue_strike — escalating discipline + notification. Admin only.
-- ---------------------------------------------------------------------------
create or replace function public.issue_strike(p_user uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
  v_level  integer;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  select count(*) + 1 into v_level from public.user_strikes where user_id = p_user;

  insert into public.user_strikes (user_id, level, reason, issued_by)
    values (p_user, v_level, p_reason, admin_id);

  -- Escalating restriction (admins may override via the ban tools).
  if v_level = 2 then
    update public.profiles set posting_restricted_until = now() + interval '24 hours'
      where id = p_user;
  elsif v_level = 3 then
    update public.profiles set suspended_until = now() + interval '7 days'
      where id = p_user;
  elsif v_level >= 4 then
    update public.profiles set suspended_until = now() + interval '3650 days'
      where id = p_user;
  end if;

  perform public.create_notification(
    p_user, null, 'moderation_warning', 'system',
    jsonb_build_object('level', v_level, 'reason', p_reason)
  );

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id, 'issue_strike', 'profile', p_user, p_reason);

  return v_level;
end;
$$;

revoke all on function public.issue_strike(uuid, text) from public;
grant execute on function public.issue_strike(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. set_shadow_ban — silent exclusion toggle. Admin only.
-- ---------------------------------------------------------------------------
create or replace function public.set_shadow_ban(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;
  update public.profiles set shadow_banned = p_on where id = p_user;
  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id, case when p_on then 'shadow_ban' else 'unshadow_ban' end,
            'profile', p_user, null);
end;
$$;

revoke all on function public.set_shadow_ban(uuid, boolean) from public;
grant execute on function public.set_shadow_ban(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. decide_appeal — approve lifts the matching restriction. Admin only.
-- ---------------------------------------------------------------------------
create or replace function public.decide_appeal(p_appeal uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
  v_user   uuid;
  v_subject text;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  update public.appeals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = admin_id, decided_at = now()
   where id = p_appeal and status = 'open'
   returning user_id, subject into v_user, v_subject;

  if v_user is null then
    return; -- already decided or missing
  end if;

  if p_approve then
    if v_subject = 'posting_restriction' then
      update public.profiles set posting_restricted_until = null where id = v_user;
    elsif v_subject = 'suspension' then
      update public.profiles set suspended_until = null where id = v_user;
    elsif v_subject = 'shadow_ban' then
      update public.profiles set shadow_banned = false where id = v_user;
    elsif v_subject = 'ban' then
      update public.profiles set is_banned = false where id = v_user;
    end if;
  end if;

  perform public.create_notification(
    v_user, null, 'appeal_result', 'system',
    jsonb_build_object('approved', p_approve, 'subject', v_subject)
  );

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id, case when p_approve then 'appeal_approved' else 'appeal_rejected' end,
            'profile', v_user, v_subject);
end;
$$;

revoke all on function public.decide_appeal(uuid, boolean) from public;
grant execute on function public.decide_appeal(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Feed: exclude shadow-banned authors (except from their own view) and any
--    author the viewer has muted (closes the Phase 8 feed-mute gap). Body is
--    the mig 0052 view + two filters.
-- ---------------------------------------------------------------------------
create or replace view public.feed_posts as
select
  p.id, p.body, p.image_url, p.is_anonymous, p.community_id,
  p.like_count, p.comment_count, p.created_at,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::uuid else p.author_id end as author_id,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.full_name end as author_name,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.avatar_url end as author_avatar,
  (exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid()))
    as liked_by_me,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.department end as author_department,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then false else pr.verified end as author_verified,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::smallint else pr.semester end as author_semester,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::integer else pr.aura_score end as author_aura,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text[] else pr.interests end as author_interests
from posts p
join profiles pr on pr.id = p.author_id
where p.hidden = false
  and not exists (
    select 1 from blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
       or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
  -- Phase 9 shadow ban: hidden from everyone but the author (no indication).
  and (not pr.shadow_banned or p.author_id = auth.uid())
  -- Phase 8 mute: hide authors the viewer has muted.
  and not exists (
    select 1 from muted_users mu
    where mu.muter_id = auth.uid() and mu.muted_id = p.author_id)
  and (p.community_id is null
       or exists (select 1 from communities c
                  where c.id = p.community_id and c.status = 'approved'::community_status))
  and p.moderation_status = 'approved'::post_moderation;

grant select on public.feed_posts to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Discover: also exclude shadow-banned + suspended profiles. Body is the mig
--    0058 version plus two base filters.
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
      and p.discoverable = true
      and p.deactivated_at is null
      -- Phase 9: silent exclusions.
      and p.shadow_banned = false
      and (p.suspended_until is null or p.suspended_until < now())
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
