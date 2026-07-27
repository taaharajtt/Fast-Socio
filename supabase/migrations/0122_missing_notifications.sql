-- =============================================================================
-- FAST SOCIO — Missing Notification Triggers (Phase 12 Polish)
-- Implements missing notification handlers for:
--   1. Comment likes
--   2. Post body mentions
--   3. Accepted message requests
--   4. Chat message emoji reactions
--   5. Community & Event rejections
--   6. Society executive role revocation
--   7. Event co-organizer assignment and removal
--   8. Manual admin Aura score adjustments
--   9. Weekly leaderboard title placement
--  10. Moderated content hiding
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Comment Likes Notification
-- ---------------------------------------------------------------------------
create or replace function public.notify_comment_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_post_id   uuid;
begin
  select author_id, post_id into v_recipient, v_post_id
    from public.post_comments
   where id = new.comment_id;

  perform public.create_notification(
    v_recipient, new.user_id, 'comment_like', 'likes',
    jsonb_build_object('post_id', v_post_id, 'comment_id', new.comment_id)
  );
  return null;
end;
$$;

drop trigger if exists comment_likes_notify on public.comment_likes;
create trigger comment_likes_notify
  after insert on public.comment_likes
  for each row execute function public.notify_comment_like();

-- ---------------------------------------------------------------------------
-- 2. Post Body Mentions Notification
-- ---------------------------------------------------------------------------
create or replace function public.notify_post_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec   record;
  v_uid uuid;
begin
  if new.hidden or new.moderation_status <> 'approved' then
    return null;
  end if;

  for rec in
    select distinct (regexp_matches(
      new.body, '@\[[a-z0-9_]{1,20}\]\(([0-9a-fA-F-]{36})\)', 'g'))[1] as uid
  loop
    begin
      v_uid := rec.uid::uuid;
    exception when others then
      continue;
    end;

    perform public.create_notification(
      v_uid, new.author_id, 'mention', 'likes',
      jsonb_build_object('post_id', new.id)
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists posts_notify_mentions on public.posts;
create trigger posts_notify_mentions
  after insert or update of body on public.posts
  for each row execute function public.notify_post_mentions();

-- ---------------------------------------------------------------------------
-- 3. Accepted Message Request Notification
-- ---------------------------------------------------------------------------
create or replace function public.notify_message_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    perform public.create_notification(
      new.sender_id, new.recipient_id, 'message_request_accepted', 'messages',
      jsonb_build_object('request_id', new.id)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists message_requests_notify_status on public.message_requests;
create trigger message_requests_notify_status
  after update of status on public.message_requests
  for each row execute function public.notify_message_request_status();

-- ---------------------------------------------------------------------------
-- 4. Chat Message Emoji Reaction Notification
-- ---------------------------------------------------------------------------
create or replace function public.toggle_message_reaction(
  p_message_id uuid,
  p_emoji text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me         uuid := auth.uid();
  v_emoji    text := btrim(p_emoji);
  existing   text;
  v_author   uuid;
begin
  if char_length(v_emoji) < 1 or char_length(v_emoji) > 8 then
    raise exception 'invalid emoji';
  end if;

  if not exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = p_message_id
      and (c.user_low = me or c.user_high = me)
  ) then
    raise exception 'not a participant';
  end if;

  select sender_id into v_author from public.messages where id = p_message_id;
  select emoji into existing
    from public.message_reactions
   where message_id = p_message_id and user_id = me;

  if existing is not null and existing = v_emoji then
    delete from public.message_reactions
     where message_id = p_message_id and user_id = me;
  else
    insert into public.message_reactions (message_id, user_id, emoji)
      values (p_message_id, me, v_emoji)
      on conflict (message_id, user_id)
      do update set emoji = excluded.emoji, created_at = now();

    if v_author is not null then
      perform public.create_notification(
        v_author, me, 'message_reaction', 'messages',
        jsonb_build_object('message_id', p_message_id, 'emoji', v_emoji)
      );
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Community & Event Rejection Notifications
-- ---------------------------------------------------------------------------
create or replace function public.moderate_community(
  p_community_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
  owner uuid;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  perform set_config('app.community_moderation', '1', true);
  update public.communities
     set status = case when p_approve then 'approved'::public.community_status
                       else 'rejected'::public.community_status end
   where id = p_community_id
   returning owner_id into owner;
  perform set_config('app.community_moderation', '0', true);

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id,
            case when p_approve then 'approve_community' else 'reject_community' end,
            'community', p_community_id, null);

  if p_approve then
    perform public.create_notification(owner, admin_id, 'community_approved', 'communities',
      jsonb_build_object('community_id', p_community_id));
  else
    perform public.create_notification(owner, admin_id, 'community_rejected', 'communities',
      jsonb_build_object('community_id', p_community_id));
  end if;
end;
$$;

create or replace function public.moderate_event(
  p_event_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
  host uuid;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  perform set_config('app.event_moderation', '1', true);
  update public.events
     set status = case when p_approve then 'approved'::public.event_status
                       else 'rejected'::public.event_status end
   where id = p_event_id
   returning host_id into host;
  perform set_config('app.event_moderation', '0', true);

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id,
            case when p_approve then 'approve_event' else 'reject_event' end,
            'event', p_event_id, null);

  if p_approve then
    perform public.create_notification(host, admin_id, 'event_approved', 'events',
      jsonb_build_object('event_id', p_event_id));
  else
    perform public.create_notification(host, admin_id, 'event_rejected', 'events',
      jsonb_build_object('event_id', p_event_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Society Officer Role Removal Notification
-- ---------------------------------------------------------------------------
create or replace function public.remove_society_role(p_society uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  is_adm      boolean := public.is_admin(auth.uid());
  caller_rank integer := public.society_role_rank(p_society, auth.uid());
  target_rank integer := public.society_role_rank(p_society, p_user);
begin
  if not exists (select 1 from public.society_roles
                 where society_id = p_society and user_id = p_user) then
    return;
  end if;
  if not is_adm and caller_rank < 90 then
    raise exception 'not authorized';
  end if;
  if not is_adm and target_rank >= caller_rank then
    raise exception 'cannot remove someone at or above your own role';
  end if;

  perform public.create_notification(
    p_user, auth.uid(), 'society_role_removed', 'communities',
    jsonb_build_object('society_id', p_society)
  );

  delete from public.society_roles where society_id = p_society and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Event Co-Organizer Added / Removed Notifications
-- ---------------------------------------------------------------------------
create or replace function public.add_event_organizer(p_event uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  v_host uuid;
begin
  select host_id into v_host from public.events where id = p_event;
  if v_host is null then
    raise exception 'event not found';
  end if;
  if v_host <> uid and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  if p_user = v_host then
    raise exception 'the host is already the organizer';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user and onboarding_completed and not is_banned
  ) then
    raise exception 'that student was not found';
  end if;

  insert into public.event_organizers (event_id, user_id, added_by)
    values (p_event, p_user, uid)
    on conflict (event_id, user_id) do nothing;

  perform public.create_notification(
    p_user, uid, 'event_organizer_added', 'events',
    jsonb_build_object('event_id', p_event)
  );
end;
$$;

create or replace function public.remove_event_organizer(p_event uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  v_host uuid;
begin
  select host_id into v_host from public.events where id = p_event;
  if v_host is null then
    raise exception 'event not found';
  end if;
  if v_host <> uid and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;

  perform public.create_notification(
    p_user, uid, 'event_organizer_removed', 'events',
    jsonb_build_object('event_id', p_event)
  );

  delete from public.event_organizers where event_id = p_event and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Manual Admin Aura Score Adjustment Notification
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_aura(
  p_user_id uuid,
  p_delta integer,
  p_reason text
)
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
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;
  if p_delta = 0 then
    raise exception 'delta must be non-zero';
  end if;

  insert into public.aura_transactions (user_id, delta, reason, metadata)
    values (p_user_id, p_delta, 'admin_adjust',
            jsonb_build_object('reason', p_reason, 'admin', admin_id));

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason, metadata)
    values (admin_id, 'aura_adjust', 'profile', p_user_id, trim(p_reason),
            jsonb_build_object('delta', p_delta));

  perform public.create_notification(
    p_user_id, admin_id, 'aura_adjusted', 'likes',
    jsonb_build_object('delta', p_delta, 'reason', trim(p_reason))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Leaderboard Title Awarded Notification
--
-- Rebuilt on top of the dense-rank fix from mig 0108 (rank() SQL competition
-- ranking skips numbers after a tie and could split a tied group across the
-- top-10 boundary; dense_rank() does not). The insert keeps 0108's set-based
-- shape; only the top-10 notification loop is new.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_leaderboard()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_start timestamptz := public.current_week_start();
  prev_start timestamptz := cur_start - interval '7 days';
  prev_week_date date := (prev_start at time zone 'Asia/Karachi')::date;
  rec record;
begin
  insert into public.leaderboard_snapshots (week_start, user_id, rank, weekly_aura, title)
  select
    prev_week_date,
    ranked.user_id,
    ranked.rnk,
    ranked.weekly_aura,
    case ranked.rnk
      when 1 then 'Main Character'
      when 2 then 'Campus Celebrity'
      when 3 then 'Aura Farmer'
      else null
    end
  from (
    select
      a.user_id,
      sum(a.delta)::int as weekly_aura,
      dense_rank() over (order by sum(a.delta) desc) as rnk
    from public.aura_transactions a
    join public.profiles p on p.id = a.user_id and p.is_banned = false
    where a.created_at >= prev_start and a.created_at < cur_start
    group by a.user_id
    having sum(a.delta) > 0
  ) ranked
  where ranked.rnk <= 50
  on conflict (week_start, user_id) do nothing;

  for rec in (
    select user_id, rank, weekly_aura, title
      from public.leaderboard_snapshots
     where week_start = prev_week_date
       and rank <= 10
  )
  loop
    perform public.create_notification(
      rec.user_id, null, 'leaderboard_top_finish', 'likes',
      jsonb_build_object('rank', rec.rank, 'title', rec.title, 'weekly_aura', rec.weekly_aura)
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Moderated Content Hiding Notification
-- ---------------------------------------------------------------------------
create or replace function public.moderate_report(
  p_report_id uuid,
  p_status public.report_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id  uuid := auth.uid();
  v_type    public.report_target_type;
  v_target  uuid;
  v_hidden  boolean;
  v_author  uuid;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  select target_type, target_id into v_type, v_target
    from public.reports where id = p_report_id;
  if v_type is null then
    raise exception 'report not found';
  end if;

  update public.reports set status = p_status where id = p_report_id;

  v_hidden := (p_status = 'actioned');
  if v_type = 'post' then
    update public.posts set hidden = v_hidden where id = v_target
    returning author_id into v_author;
  elsif v_type = 'comment' then
    update public.post_comments set hidden = v_hidden where id = v_target
    returning author_id into v_author;
  elsif v_type = 'message' then
    update public.messages set hidden = v_hidden where id = v_target
    returning sender_id into v_author;
  end if;

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, metadata)
    values (admin_id, 'report_' || p_status::text, v_type, v_target,
            jsonb_build_object('report_id', p_report_id, 'hidden', v_hidden));

  if v_hidden and v_author is not null then
    perform public.create_notification(
      v_author, admin_id, 'content_moderated', 'likes',
      jsonb_build_object('target_type', v_type, 'target_id', v_target)
    );
  end if;
end;
$$;
