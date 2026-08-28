-- 0157 — Discover deck exhaustion: give BOTH deck sources real continuation.
--
-- THE BUG. The deck ran dry after ~20-30 cards and showed "You're all caught up"
-- even when eligible profiles remained.
--
--   * `get_discover_candidates(p_limit)` has no continuation at all. Every client
--     top-up re-ran the SAME ranked query and got the SAME first 20 rows back.
--     The client filtered them against `seenThisSession`, ended up with zero new
--     cards, and the deck emptied for good. Persisted swipes are NOT a usable
--     implicit cursor: a PASS keeps the profile eligible (it is recycled), and a
--     swipe that has not been written yet — or one the user undid — leaves the
--     next page overlapping the last.
--   * `get_unified_discover_feed` DOES take `p_before`, but its cursor is
--     `created_at` alone, so two posts created in the same instant can straddle a
--     page boundary and one of them is silently skipped.
--
-- WHAT CHANGES.
--   1. `get_discover_candidates` gains `p_exclude uuid[]` — an explicit
--      server-side exclusion set of candidate ids the client already holds. This
--      is the continuation mechanism that is compatible with the existing
--      compatibility ranking: the ranking in 0140 is not a monotone key (it mixes
--      a per-department round-robin `dept_rank` with the score and several
--      tie-breakers), so a keyset over it is not well defined. Excluding the ids
--      already delivered keeps the exact 0140 ordering for what remains, and each
--      page is the best of the rest.
--
--      The recycle round still works: `seen` fires only when `fresh` is empty,
--      and because the exclusion shrinks `base`, that flips over naturally once
--      the fresh candidates have been paged through. Excluded ids are dropped
--      from BOTH tiers, so a passed profile is recycled at most once per paging
--      run instead of looping forever.
--
--      Every privacy / eligibility rule from 0140 is carried over byte for byte:
--      onboarding, ban, discoverable, deactivated, shadow-ban, suspension,
--      blocks (both directions), mutes, existing matches, and "a profile you
--      LIKED is gone for good". The exclusion is purely additive.
--
--   2. `get_unified_discover_feed` gains `p_before_id uuid` so the cursor is a
--      true keyset on `(created_at, id)`. `order by created_at desc, id desc` is
--      matched by `(smp.created_at, smp.id) < (p_before, p_before_id)`, which can
--      neither repeat nor skip a row across pages.
--
-- Both functions are DROPped and recreated rather than replaced: a new parameter
-- cannot be added by CREATE OR REPLACE, and leaving the old arity in place would
-- make the call ambiguous. Return types are unchanged, so no caller's row shape
-- moves. Bodies are otherwise identical to 0140 / 0141.

-- ---------------------------------------------------------------------------
-- 1. SOCIO candidates + exclusion set
-- ---------------------------------------------------------------------------

drop function if exists public.get_discover_candidates(integer);

create function public.get_discover_candidates(
  p_limit integer default 20,
  p_exclude uuid[] default '{}'::uuid[]
)
returns table(
  id uuid, full_name text, department text, semester smallint, bio text,
  avatar_url text, interests text[], gender text, aura_score integer,
  verified boolean, is_recycled boolean, compatibility smallint,
  shared_interests text[]
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select
      p.id as uid,
      p.department as my_dept,
      public.current_semester(p.username) as my_sem,
      p.interests as my_interests,
      lower(nullif(btrim(p.gender), '')) as my_gender,
      public.roll_batch_year(p.username) as my_batch,
      array(select community_id from public.community_members where user_id = p.id) as my_comms
    from public.profiles p
    where p.id = auth.uid()
  ),
  base as (
    select p.*, public.current_semester(p.username) as sem_derived
    from public.profiles p, me
    where p.id <> me.uid
      -- 0157: continuation — ids the caller already holds in its deck.
      and not (p.id = any (coalesce(p_exclude, '{}'::uuid[])))
      and p.onboarding_completed = true
      and p.is_banned = false
      and p.discoverable = true
      and p.deactivated_at is null
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
      -- A profile you LIKED is gone for good — you're committed, waiting on them.
      and not exists (
        select 1 from public.swipes s
        where s.swiper_id = me.uid and s.target_id = p.id
          and s.direction = 'like'
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
  -- Recycle round: PASSED profiles only, surfaced once no fresh candidate remains
  -- ("You're all caught up"), least-recently-passed first.
  seen as (
    select b.*, true as is_recycled, 1 as tier, s.created_at as sort_key
    from base b
    join me on true
    join public.swipes s
      on s.swiper_id = me.uid and s.target_id = b.id and s.direction = 'pass'
    where not exists (select 1 from fresh)
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
      exists (
        select 1 from public.swipes s2
        where s2.swiper_id = m.id and s2.target_id = me.uid and s2.direction = 'like'
      ) as they_liked_me,
      me.my_dept, me.my_sem, me.my_gender, me.my_batch
    from merged m
    cross join me
    left join lateral (
      select array(select unnest(m.interests) intersect select unnest(me.my_interests)) as shared
    ) si on true
  ),
  weighted as (
    select
      s.*,
      least(99, greatest(5, round(
          7 * least(s.shared_n, 6)
        + 8.0 * greatest(s.shared_n - 6, 0) / (greatest(s.shared_n - 6, 0) + 6)
        + (case when s.my_gender in ('male', 'female')
                 and lower(nullif(btrim(s.gender), '')) in ('male', 'female')
                 and lower(nullif(btrim(s.gender), '')) <> s.my_gender
                then 15 else 0 end)
        + (case when s.my_sem is not null and s.sem_derived is not null
                 and s.sem_derived = s.my_sem
                then 13 else 0 end)
        + (case when s.my_dept is not null and s.department is not null
                 and s.department <> s.my_dept
                then 12 else 0 end)
        + (case when s.my_batch is not null
                 and public.roll_batch_year(s.username) is not null
                 and public.roll_batch_year(s.username) = s.my_batch
                then 10 else 0 end)
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
    id, full_name, department, sem_derived as semester, bio, avatar_url,
    interests, gender, aura_score, verified, is_recycled,
    compatibility,
    coalesce(shared_arr, '{}') as shared_interests
  from diversified
  order by
    tier asc,
    dept_rank asc,
    compatibility desc,
    -- Tie-breakers only: these shape the ORDER, never the displayed number.
    they_liked_me desc,
    mutual_comms desc,
    case when tier = 0 then sort_key end desc nulls last,
    case when tier = 1 then sort_key end asc nulls last
  limit greatest(1, least(p_limit, 50));
$function$;

revoke all on function public.get_discover_candidates(integer, uuid[]) from public;
revoke execute on function public.get_discover_candidates(integer, uuid[]) from anon;
grant execute on function public.get_discover_candidates(integer, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Opportunity feed: keyset cursor on (created_at, id)
-- ---------------------------------------------------------------------------

drop function if exists public.get_unified_discover_feed(text[], integer, timestamp with time zone);

create function public.get_unified_discover_feed(
  p_modes text[] default null::text[],
  p_limit integer default 40,
  p_before timestamp with time zone default null::timestamp with time zone,
  p_before_id uuid default null::uuid
)
returns table(
  id uuid, mode text, author_id uuid, author_name text, author_avatar text,
  author_gender text, author_username text, author_department text,
  author_semester smallint, author_graduation_year smallint, author_verified boolean,
  author_aura integer, title text, description text, course_code text, degree text,
  semester smallint, people_needed smallint, skills_needed text[], interests text[],
  roles_needed text[], place text, scheduled_at timestamp with time zone,
  hackathon_name text, hackathon_url text, meeting_preference text,
  preferred_commitment text, skill_level text, availability text, portfolio_url text,
  recruitment_url text, deadline timestamp with time zone,
  expires_at timestamp with time zone, society_id uuid, society_name text,
  event_id uuid, event_title text, team_members jsonb, team_member_count integer,
  mutual_communities integer, application_count integer, my_application_status text,
  my_application_id uuid, created_at timestamp with time zone,
  place_id text, place_x numeric, place_y numeric
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select
      p.id as uid,
      array(select community_id from public.community_members where user_id = p.id) as my_comms,
      p.department                          as my_department,
      p.degree                              as my_degree,
      public.current_semester(p.username)   as my_semester
    from public.profiles p
    where p.id = auth.uid()
  )
  select
    smp.id,
    smp.mode,
    smp.author_id,
    ap.full_name as author_name,
    ap.avatar_url as author_avatar,
    ap.gender as author_gender,
    ap.username as author_username,
    case when coalesce(ap.show_department, true) then ap.department else null end,
    case when coalesce(ap.show_semester, true)
         then public.current_semester(ap.username) else null end,
    ap.graduation_year,
    coalesce(ap.verified, false),
    case when coalesce(ap.show_aura, true) then ap.aura_score else 0 end,
    smp.title,
    smp.description,
    smp.course_code,
    smp.degree,
    smp.semester,
    smp.people_needed,
    smp.skills_needed,
    smp.interests,
    smp.roles_needed,
    smp.place,
    smp.scheduled_at,
    smp.hackathon_name,
    smp.hackathon_url,
    smp.meeting_preference,
    smp.preferred_commitment,
    smp.skill_level,
    smp.availability,
    smp.portfolio_url,
    smp.recruitment_url,
    smp.deadline,
    smp.expires_at,
    smp.society_id,
    sc.name as society_name,
    smp.event_id,
    ev.title as event_title,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', tp.id, 'username', tp.username,
        'full_name', tp.full_name, 'avatar_url', tp.avatar_url,
        'gender', tp.gender) order by tm.created_at), '[]'::jsonb)
      from public.smart_match_team_members tm
      join public.profiles tp on tp.id = tm.user_id
      where tm.post_id = smp.id
    ) as team_members,
    (select count(*)::int from public.smart_match_team_members tm2 where tm2.post_id = smp.id),
    (select count(*)::int from public.community_members cm
       where cm.user_id = smp.author_id and cm.community_id = any (me.my_comms)),
    (select count(*)::int from public.smart_match_applications ac
       where ac.post_id = smp.id and ac.status in ('pending','accepted')),
    (
      select a.status from public.smart_match_applications a
      where a.post_id = smp.id and a.applicant_id = me.uid
      order by a.created_at desc limit 1
    ) as my_application_status,
    (
      select a.id from public.smart_match_applications a
      where a.post_id = smp.id and a.applicant_id = me.uid
      order by a.created_at desc limit 1
    ) as my_application_id,
    smp.created_at,
    smp.place_id,
    smp.place_x,
    smp.place_y
  from public.smart_match_posts smp
  join me on true
  join public.profiles ap on ap.id = smp.author_id
  left join public.communities sc on sc.id = smp.society_id
  left join public.events ev on ev.id = smp.event_id
  where (p_modes is null or array_length(p_modes, 1) is null or smp.mode = any (p_modes))
    and smp.status = 'open'
    and (smp.expires_at is null or smp.expires_at > now())
    -- 0157: true keyset. With p_before_id null this degrades to the old
    -- created_at-only cursor, so a caller passing three arguments is unchanged.
    and (
      p_before is null
      or (p_before_id is null and smp.created_at < p_before)
      or (p_before_id is not null and (smp.created_at, smp.id) < (p_before, p_before_id))
    )
    and smp.author_id <> me.uid
    and ap.onboarding_completed = true
    and ap.is_banned = false
    and ap.deactivated_at is null
    and ap.shadow_banned = false
    and (ap.suspended_until is null or ap.suspended_until < now())
    -- fix-043 cohort predicate, carried forward unchanged
    and (
      smp.mode not in ('project_partner', 'fyp_teammate')
      or (
            me.my_department is not null and ap.department = me.my_department
        and me.my_degree     is not null and ap.degree     = me.my_degree
        and me.my_semester   is not null
        and public.current_semester(ap.username) = me.my_semester
      )
    )
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = me.uid and b.blocked_id = smp.author_id)
         or (b.blocker_id = smp.author_id and b.blocked_id = me.uid)
    )
    and not exists (
      select 1 from public.muted_users mu
      where mu.muter_id = me.uid and mu.muted_id = smp.author_id
    )
    and not exists (
      select 1 from public.smart_match_passes sp
      where sp.user_id = me.uid and sp.post_id = smp.id
    )
  order by smp.created_at desc, smp.id desc
  limit greatest(1, least(p_limit, 80));
$function$;

revoke all on function public.get_unified_discover_feed(text[], integer, timestamp with time zone, uuid) from public;
grant execute on function public.get_unified_discover_feed(text[], integer, timestamp with time zone, uuid) to authenticated;
