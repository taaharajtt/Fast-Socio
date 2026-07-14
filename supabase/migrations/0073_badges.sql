-- =============================================================================
-- FAST SOCIO — Badges: replace the generic achievements catalog with the 8
-- brand badges (public/brand/badge1..8.png).
--
--   * Reuses the achievements/user_achievements tables + checker from mig 0055,
--     but the catalog rows, metrics and artwork change:
--       rookie            badge2  first post
--       ice_breaker       badge5  interact with 20 distinct people (DMs, chat,
--                                 communities, comment section)
--       social_butterfly  badge1  20 matches
--       aura_follows_you  badge3  1000 all-time (lifetime positive) Aura
--       the_joiner        badge6  join 10 communities
--       event_organizer   badge7  host an approved event that reaches 10+ RSVPs
--       rising_star       badge8  contribute 10 days in a row (any Aura-earning
--                                 action counts as a contribution)
--       the_socio         badge4  admin-granted only (peacekeeping, spreading
--                                 love, contribution) — never auto-granted
--   * The checker gains the new metrics and now also runs on the actions that
--     don't touch the Aura ledger (messages, comments, community joins) plus an
--     event-host check when RSVPs land, so badges grant promptly.
--   * admin_grant_badge / admin_revoke_badge: audited SECURITY DEFINER RPCs for
--     the manual badge (the_socio) and corrections.
--
-- Deleting the old catalog cascades user_achievements; the backfill at the end
-- re-grants everything users already qualify for under the new rules (rewards
-- + notifications flow through the normal path).
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Catalog: badge artwork column + the 8 badges.
-- ---------------------------------------------------------------------------
alter table public.achievements
  add column if not exists image_url text;

delete from public.achievements;

insert into public.achievements
  (code, title, description, icon, image_url, category, metric, threshold, aura_reward, sort_order)
values
  ('rookie',           'The Rookie',          'Publish your first post.',                                          '📝', '/brand/badge2.png', 'content',    'posts',            1,    5,  10),
  ('ice_breaker',      'Ice Breaker',         'Interact with 20 different people across DMs, chats, communities and comments.', '🧊', '/brand/badge5.png', 'social',     'interactions',    20,   20,  20),
  ('social_butterfly', 'Social Butterfly',    'Reach 20 matches.',                                                 '🦋', '/brand/badge1.png', 'social',     'matches',         20,   30,  30),
  ('aura_follows_you', 'Aura Follows You',    'Earn 1,000 all-time Aura points.',                                  '⚡', '/brand/badge3.png', 'reputation', 'aura_alltime',  1000,  100,  40),
  ('the_joiner',       'The Joiner',          'Join 10 communities.',                                              '🤝', '/brand/badge6.png', 'social',     'communities',     10,   15,  50),
  ('event_organizer',  'The Event Organizer', 'Organize a successful event with 10+ attendees.',                   '🎤', '/brand/badge7.png', 'events',     'events_hosted_big', 1,  50,  60),
  ('rising_star',      'Rising Star',         'Contribute to FAST SOCIO 10 days in a row.',                        '⭐', '/brand/badge8.png', 'reputation', 'streak',          10,   40,  70),
  ('the_socio',        'The Socio',           'Awarded by the admins for peacekeeping, contributing and spreading love.', '💜', '/brand/badge4.png', 'special', 'manual',        1,   75,  80);

-- ---------------------------------------------------------------------------
-- 2. Checker: new metrics. 'manual' always evaluates to 0 so the_socio can only
--    arrive via admin_grant_badge.
-- ---------------------------------------------------------------------------
create or replace function public.check_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  -- Fast exit once everything is earned (this runs on hot paths like messages).
  if not exists (
    select 1 from public.achievements a
    where not exists (
      select 1 from public.user_achievements ua
      where ua.user_id = p_user and ua.code = a.code
    )
  ) then
    return;
  end if;

  for rec in
    with m as (
      select
        (select count(*) from public.posts
          where author_id = p_user and not is_anonymous)                          as posts,
        (select count(*) from public.matches
          where user_low = p_user or user_high = p_user)                          as matches,
        (select count(*) from public.community_members
          where user_id = p_user)                                                 as communities,
        -- Lifetime positive Aura (identical to XP): penalties never subtract.
        (select coalesce(sum(delta), 0) from public.aura_transactions
          where user_id = p_user and delta > 0)                                    as aura_alltime,
        -- Distinct people interacted with: DM counterparts you actually messaged,
        -- authors of posts you commented on (feed + community posts), and authors
        -- of comments you replied to.
        (select count(*) from (
            select case when c.user_low = p_user then c.user_high else c.user_low end
              from public.conversations c
              where exists (
                select 1 from public.messages msg
                where msg.conversation_id = c.id and msg.sender_id = p_user
              )
              and p_user in (c.user_low, c.user_high)
            union
            select p.author_id
              from public.post_comments pc
              join public.posts p on p.id = pc.post_id
              where pc.author_id = p_user and p.author_id <> p_user
            union
            select parent.author_id
              from public.post_comments pc
              join public.post_comments parent on parent.id = pc.parent_id
              where pc.author_id = p_user and parent.author_id <> p_user
          ) others)                                                                as interactions,
        -- "Successful event": an approved event you host that reaches 10+ RSVPs.
        (select count(*) from public.events e
          where e.host_id = p_user
            and e.status = 'approved'
            and (select count(*) from public.event_attendees ea
                  where ea.event_id = e.id) >= 10)                                 as events_hosted_big,
        -- Longest run of consecutive days (Pakistan time) with any Aura-earning
        -- contribution (gaps-and-islands over distinct activity dates).
        (select coalesce(max(run), 0) from (
            select count(*) as run
            from (
              select d, d - (row_number() over (order by d))::int as grp
              from (
                select distinct (created_at at time zone 'Asia/Karachi')::date as d
                from public.aura_transactions
                where user_id = p_user and delta > 0
              ) days
            ) islands
            group by grp
          ) runs)                                                                  as streak
    )
    insert into public.user_achievements (user_id, code)
    select p_user, a.code
    from public.achievements a, m
    where not exists (
        select 1 from public.user_achievements ua
        where ua.user_id = p_user and ua.code = a.code
      )
      and (case a.metric
             when 'posts'             then m.posts
             when 'matches'           then m.matches
             when 'communities'       then m.communities
             when 'aura_alltime'      then m.aura_alltime
             when 'interactions'      then m.interactions
             when 'events_hosted_big' then m.events_hosted_big
             when 'streak'            then m.streak
             else 0
           end) >= a.threshold
    returning code
  loop
    declare
      v_reward integer;
      v_title  text;
      v_image  text;
    begin
      select aura_reward, title, image_url into v_reward, v_title, v_image
        from public.achievements where code = rec.code;

      if v_reward > 0 then
        insert into public.aura_transactions (user_id, delta, reason, metadata)
          values (p_user, v_reward, 'achievement',
                  jsonb_build_object('code', rec.code));
      end if;

      perform public.create_notification(
        p_user, null, 'achievement', 'system',
        jsonb_build_object('code', rec.code, 'title', v_title, 'image_url', v_image)
      );
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Run the checker on the actions that never touch the Aura ledger, so
--    Ice Breaker / The Joiner / The Event Organizer grant promptly. The existing
--    aura_transactions trigger (mig 0055) stays and covers everything else.
-- ---------------------------------------------------------------------------
create or replace function public.trg_check_achievements_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_achievements(
    case tg_table_name
      when 'messages'          then new.sender_id
      when 'post_comments'     then new.author_id
      when 'community_members' then new.user_id
    end
  );
  return null;
end;
$$;

drop trigger if exists messages_check_achievements on public.messages;
create trigger messages_check_achievements
  after insert on public.messages
  for each row execute function public.trg_check_achievements_actor();

drop trigger if exists post_comments_check_achievements on public.post_comments;
create trigger post_comments_check_achievements
  after insert on public.post_comments
  for each row execute function public.trg_check_achievements_actor();

drop trigger if exists community_members_check_achievements on public.community_members;
create trigger community_members_check_achievements
  after insert on public.community_members
  for each row execute function public.trg_check_achievements_actor();

-- An RSVP can push the HOST over the 10-attendee bar — check the host too
-- (the attendee's own check already fires via their event_attend Aura txn).
create or replace function public.trg_check_achievements_event_host()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
begin
  select host_id into v_host from public.events where id = new.event_id;
  if v_host is not null then
    perform public.check_achievements(v_host);
  end if;
  return null;
end;
$$;

drop trigger if exists event_attendees_check_host_achievements on public.event_attendees;
create trigger event_attendees_check_host_achievements
  after insert on public.event_attendees
  for each row execute function public.trg_check_achievements_event_host();

-- ---------------------------------------------------------------------------
-- 4. Admin grant / revoke for The Socio (and corrections). Audited.
-- ---------------------------------------------------------------------------
create or replace function public.admin_grant_badge(p_user uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
  v_reward integer;
  v_title  text;
  v_image  text;
  v_count  integer;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  select aura_reward, title, image_url into v_reward, v_title, v_image
    from public.achievements where code = p_code;
  if not found then
    raise exception 'unknown badge %', p_code;
  end if;

  insert into public.user_achievements (user_id, code)
    values (p_user, p_code)
    on conflict do nothing;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return; -- already earned; no double reward
  end if;

  if v_reward > 0 then
    insert into public.aura_transactions (user_id, delta, reason, metadata)
      values (p_user, v_reward, 'achievement',
              jsonb_build_object('code', p_code, 'admin', admin_id));
  end if;

  perform public.create_notification(
    p_user, null, 'achievement', 'system',
    jsonb_build_object('code', p_code, 'title', v_title, 'image_url', v_image)
  );

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason, metadata)
    values (admin_id, 'badge_grant', 'profile', p_user, p_code,
            jsonb_build_object('code', p_code));
end;
$$;

create or replace function public.admin_revoke_badge(p_user uuid, p_code text)
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

  delete from public.user_achievements
    where user_id = p_user and code = p_code;

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason, metadata)
    values (admin_id, 'badge_revoke', 'profile', p_user, p_code,
            jsonb_build_object('code', p_code));
end;
$$;

revoke all on function public.admin_grant_badge(uuid, text) from public;
revoke all on function public.admin_revoke_badge(uuid, text) from public;
grant execute on function public.admin_grant_badge(uuid, text) to authenticated;
grant execute on function public.admin_revoke_badge(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill: grant every badge users already qualify for under the new rules.
--    Rewards + notifications flow through the normal checker path.
-- ---------------------------------------------------------------------------
do $$
declare
  u uuid;
begin
  for u in select id from public.profiles loop
    perform public.check_achievements(u);
  end loop;
end;
$$;
