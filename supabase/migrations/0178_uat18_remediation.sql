-- =============================================================================
-- FAST SOCIO — UAT-18 remediation (UAT-01 … UAT-18)
--
-- Forward-only and idempotent. Nothing already applied is edited; every object
-- here is `create or replace` / `if not exists` / `drop … if exists` first.
--
-- WHAT THIS MIGRATION IS FOR, IN ONE PLACE
--
--   UAT-01/02  send_message_request / accept_message_request / decline —
--              one canonical, atomic, idempotent path for first contact.
--   UAT-04     society broadcast capability matrix (member < moderator <
--              president < owner), anonymous broadcasts + president reveal,
--              replies and reactions, single-president rule, owner transfer.
--   UAT-05     block and mute enforced at ONE chokepoint (create_notification)
--              instead of per-trigger, so a new notification source cannot
--              bypass them by forgetting to check.
--   UAT-08     rename RPCs for communities/chat rooms and events, which touch
--              exactly one column and re-check authority server-side.
--   UAT-12     a database backstop that makes a match row without reciprocal
--              explicit likes impossible, plus a read-only audit view.
--   UAT-15     a per-session seed threaded through get_discover_candidates.
--   UAT-17     poll_ballots(): the poll creator (or an admin) only.
--   UAT-18     stable group keys for high-volume chat-surface notifications.
--
-- `check_function_bodies` is off for the same reason every migration in this
-- repo turns it off: bodies referencing columns added later in the same
-- transaction would otherwise fail to parse. See the migration-drift note —
-- functions are verified by EXECUTING them, not by trusting creation.
-- =============================================================================

set check_function_bodies = off;

-- ===========================================================================
-- 1. UAT-05 — one predicate for "may this actor reach this recipient at all"
-- ===========================================================================

-- Mute is ONE-DIRECTIONAL and notification-only: if A mutes B, A stops hearing
-- about B. B is never told, and B's content is not hidden from A.
create or replace function public.is_muted(p_muter uuid, p_muted uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.muted_users mu
    where mu.muter_id = p_muter and mu.muted_id = p_muted
  );
$$;

revoke all on function public.is_muted(uuid, uuid) from public, anon;
grant execute on function public.is_muted(uuid, uuid) to authenticated;

-- The single predicate every notification insert passes through. Block is
-- bidirectional; mute is the recipient's own one-way switch.
create or replace function public.may_notify(p_recipient uuid, p_actor uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    p_recipient is not null
    and (
      p_actor is null
      or (
        p_actor <> p_recipient
        and not public.is_blocked(p_recipient, p_actor)
        and not public.is_muted(p_recipient, p_actor)
      )
    );
$$;

revoke all on function public.may_notify(uuid, uuid) from public, anon;
grant execute on function public.may_notify(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_notification gains the block/mute gate.
--
-- This is deliberately the ONLY place the rule lives. Auditing the ~25 notify_*
-- triggers individually was the previous design, and it is exactly the design
-- that lets a new surface (chat rooms in 0168, say) ship without the check.
-- Signature, grouping behaviour and preference gating are otherwise carried
-- over from 0057 unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.create_notification(
  p_recipient uuid,
  p_actor     uuid,
  p_type      text,
  p_pref_col  text,
  p_data      jsonb default '{}'::jsonb,
  p_group_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  enabled boolean;
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;

  -- UAT-05. Blocked pairs create no interactions in either direction; a muted
  -- actor produces no notification for the muter. Both are silent to the actor.
  if not public.may_notify(p_recipient, p_actor) then
    return;
  end if;

  execute format(
    'select %I from public.notification_preferences where user_id = $1', p_pref_col
  ) into enabled using p_recipient;
  if enabled is distinct from true then
    return; -- category off (or no row) → skip
  end if;

  if p_group_key is null then
    insert into public.notifications (user_id, actor_id, type, data)
      values (p_recipient, p_actor, p_type, coalesce(p_data, '{}'::jsonb));
  else
    insert into public.notifications
      (user_id, actor_id, type, data, group_key, group_count)
      values (p_recipient, p_actor, p_type, coalesce(p_data, '{}'::jsonb), p_group_key, 1)
    on conflict (user_id, type, group_key) where read_at is null and group_key is not null
    do update set
      group_count = notifications.group_count
        + case when notifications.actor_id is distinct from excluded.actor_id then 1 else 0 end,
      actor_id   = excluded.actor_id,
      data       = excluded.data,
      created_at = now();
  end if;
end;
$$;

revoke all on function
  public.create_notification(uuid, uuid, text, text, jsonb, text) from public, anon;


-- ===========================================================================
-- 2. UAT-01 / UAT-02 — message requests: one canonical path, atomic accept
-- ===========================================================================
--
-- The two entry points (the Discover card's message bubble and the profile's
-- "Request to chat") used to be one server action doing a bare INSERT, with the
-- accept path doing THREE separate statements from the app: read the sender,
-- UPDATE the status, then call get_or_create_conversation. That sequence is
-- racy (two devices accepting at once), non-atomic (an accepted request with no
-- conversation if the third step fails), and it is why an accepted request could
-- vanish from Requests before appearing in Messages.
--
-- All three operations are now single SECURITY DEFINER statements the client
-- cannot half-perform.
--
-- The table CHECK stays at 1..500 on purpose: historical rows written under the
-- old limit must remain valid. 1..250 is the product rule and is enforced here,
-- at the only door new rows come through.

create or replace function public.send_message_request(
  p_recipient uuid,
  p_message   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_text    text;
  v_id      uuid;
  v_status  public.message_request_status;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_recipient is null or p_recipient = uid then
    raise exception 'you cannot send a request to yourself' using errcode = '22023';
  end if;

  v_text := btrim(coalesce(p_message, ''));
  if char_length(v_text) < 1 or char_length(v_text) > 250 then
    raise exception 'message must be 1-250 characters' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_recipient
      and p.is_banned = false
      and p.deactivated_at is null
  ) then
    raise exception 'that account is not available' using errcode = '22023';
  end if;

  -- Block is bidirectional and silent: the same message either way, so neither
  -- side can probe the other's block list by comparing error text.
  if public.is_blocked(uid, p_recipient) then
    raise exception 'that account is not available' using errcode = '22023';
  end if;

  -- IDEMPOTENCE, not an error. A double tap, a retried transition, or a second
  -- tab must all end with exactly one pending request and a success the UI can
  -- render as "request sent".
  select r.id, r.status into v_id, v_status
    from public.message_requests r
   where r.sender_id = uid
     and r.recipient_id = p_recipient
     and r.status in ('pending', 'accepted')
   order by r.created_at desc
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.message_requests (sender_id, recipient_id, message)
    values (uid, p_recipient, v_text)
  on conflict (sender_id, recipient_id) where status = 'pending'
  do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost the race with a concurrent identical send; return the winner's row.
    select r.id into v_id
      from public.message_requests r
     where r.sender_id = uid and r.recipient_id = p_recipient and r.status = 'pending';
  end if;

  return v_id;
end;
$$;

revoke all on function public.send_message_request(uuid, text) from public, anon;
grant execute on function public.send_message_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Accept: status flip AND conversation creation in one transaction, and safe to
-- call twice. Returns the conversation id so the caller never has to go looking
-- for it (the step that used to be able to fail on its own).
-- ---------------------------------------------------------------------------
create or replace function public.accept_message_request(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_sender uuid;
  v_status public.message_request_status;
  lo       uuid;
  hi       uuid;
  v_conv   uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- FOR UPDATE serialises two devices accepting the same request: the second
  -- one waits, then sees 'accepted' and takes the idempotent path below.
  select r.sender_id, r.status into v_sender, v_status
    from public.message_requests r
   where r.id = p_id and r.recipient_id = uid
   for update;

  if v_sender is null then
    raise exception 'request not found' using errcode = '22023';
  end if;
  if v_status = 'declined' then
    raise exception 'that request was declined' using errcode = '22023';
  end if;
  if public.is_blocked(uid, v_sender) then
    raise exception 'that account is not available' using errcode = '22023';
  end if;

  if v_status <> 'accepted' then
    update public.message_requests set status = 'accepted' where id = p_id;
  end if;

  lo := least(uid, v_sender);
  hi := greatest(uid, v_sender);

  -- Written directly rather than through get_or_create_conversation: the row
  -- that makes the pair eligible was written microseconds ago in THIS
  -- transaction, and re-deriving eligibility from it would be a second read of
  -- something already known. `on conflict do nothing` is what makes a
  -- simultaneous accept-from-both-sides produce one conversation, not two.
  insert into public.conversations (user_low, user_high)
    values (lo, hi)
  on conflict (user_low, user_high) do nothing;

  select c.id into v_conv
    from public.conversations c
   where c.user_low = lo and c.user_high = hi;

  return v_conv;
end;
$$;

revoke all on function public.accept_message_request(uuid) from public, anon;
grant execute on function public.accept_message_request(uuid) to authenticated;

create or replace function public.decline_message_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- Idempotent: declining an already-declined request is a no-op, not an error.
  update public.message_requests
     set status = 'declined'
   where id = p_id and recipient_id = uid and status = 'pending';
end;
$$;

revoke all on function public.decline_message_request(uuid) from public, anon;
grant execute on function public.decline_message_request(uuid) to authenticated;

-- Sender-side status list (UAT-02): the half of the lifecycle the inbox never
-- showed, which is why a sent request looked like it had disappeared.
create index if not exists message_requests_sender_status_idx
  on public.message_requests (sender_id, status, created_at desc);


-- ===========================================================================
-- 3. UAT-12 — a match requires two explicit likes, enforced by the database
-- ===========================================================================
--
-- `handle_swipe_match` is the only intended writer, but `matches` had an
-- INSERT-shaped hole: anything holding a definer context (a future RPC, an
-- admin tool, a migration) could mint a match with no likes behind it, and the
-- product's strongest privacy promise — that a DM channel opens only by mutual
-- consent — rests on that not happening. This makes it structurally impossible
-- rather than merely unintended.
--
-- The escape hatch is deliberate and narrow: a lawful bulk import sets
-- `app.match_import` for the duration of its transaction, exactly the pattern
-- `protect_community_status` already uses for moderation. Nothing in the
-- application ever sets it.
create or replace function public.enforce_mutual_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.match_import', true) = '1' then
    return new;
  end if;

  -- Canonical pair, once. Without this, (a,b) and (b,a) are two rows and the
  -- unique index does not see them as the same match.
  if new.user_low is null or new.user_high is null
     or new.user_low >= new.user_high then
    raise exception 'match pair must be canonical (user_low < user_high)'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.swipes s
    where s.swiper_id = new.user_low
      and s.target_id = new.user_high
      and s.direction = 'like'
  ) or not exists (
    select 1 from public.swipes s
    where s.swiper_id = new.user_high
      and s.target_id = new.user_low
      and s.direction = 'like'
  ) then
    raise exception 'a match requires an explicit like from both users'
      using errcode = '23514';
  end if;

  if public.is_blocked(new.user_low, new.user_high) then
    raise exception 'blocked users cannot match' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists matches_require_mutual_like on public.matches;
create trigger matches_require_mutual_like
  before insert on public.matches
  for each row execute function public.enforce_mutual_match();

revoke all on function public.enforce_mutual_match() from public, anon, authenticated;

-- READ-ONLY operator audit. Deliberately a view and not a DELETE: pre-existing
-- rows are reported for review, never silently removed (a false positive would
-- destroy a real relationship and its whole conversation).
create or replace view public.matches_without_mutual_likes as
  select
    m.id,
    m.user_low,
    m.user_high,
    m.created_at,
    exists (
      select 1 from public.swipes s
      where s.swiper_id = m.user_low and s.target_id = m.user_high
        and s.direction = 'like'
    ) as low_liked_high,
    exists (
      select 1 from public.swipes s
      where s.swiper_id = m.user_high and s.target_id = m.user_low
        and s.direction = 'like'
    ) as high_liked_low
  from public.matches m
  where not exists (
      select 1 from public.swipes s
      where s.swiper_id = m.user_low and s.target_id = m.user_high
        and s.direction = 'like'
    )
     or not exists (
      select 1 from public.swipes s
      where s.swiper_id = m.user_high and s.target_id = m.user_low
        and s.direction = 'like'
    );

revoke all on public.matches_without_mutual_likes from public, anon, authenticated;


-- ===========================================================================
-- 4. UAT-04 — the broadcast capability matrix, mapped onto the roles that
--    already exist (community_role + society_roles). No second role system.
-- ===========================================================================
--
-- THE POLICY, stated once so RLS, RPCs and UI can all be checked against it.
-- Ranks are society_role_rank()'s, unchanged: owner 100, president 90,
-- vice_president 80, officer 60, event_manager 50, media 40, moderator 30,
-- plain member 10.
--
--   member      (>=10)  send text / image / poll, vote, react, reply, and post
--                       anonymously in the broadcast channel
--   moderator   (>=30)  + approve/decline membership requests
--   president   (>=90)  + reveal the true author of an anonymous broadcast,
--                       create/manage society events,
--                       assign/remove the MODERATOR role only
--   owner       (=100)  + remove members, assign/remove ANY officer role
--                       including president, and transfer ownership
--
-- MULTIPLE PRESIDENTS: no. A society has at most one, enforced by a partial
-- unique index below rather than by convention, because "reveal an anonymous
-- author" is a real privacy power and it must be attributable to one person.
-- vice_president (80) deliberately does NOT inherit reveal.
--
-- OWNER TRANSFER: `transfer_society_ownership` moves communities.owner_id and
-- leaves the outgoing owner as president, so a society is never left with
-- nobody able to run it. Demotion of an owner is only ever this operation.

-- 4a. Broadcast columns: anonymity and threading -----------------------------
alter table public.society_announcements
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists reply_to_id  uuid references public.society_announcements (id) on delete set null;

create index if not exists society_announcements_reply_idx
  on public.society_announcements (reply_to_id)
  where reply_to_id is not null;

-- 4b. Reactions on a broadcast message ---------------------------------------
create table if not exists public.society_announcement_reactions (
  announcement_id uuid not null references public.society_announcements (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  emoji           text not null check (char_length(emoji) between 1 and 8),
  created_at      timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists society_announcement_reactions_ann_idx
  on public.society_announcement_reactions (announcement_id);

alter table public.society_announcement_reactions enable row level security;

revoke all on public.society_announcement_reactions from anon, authenticated;
grant select on public.society_announcement_reactions to authenticated;

drop policy if exists "reactions are visible" on public.society_announcement_reactions;
create policy "reactions are visible"
  on public.society_announcement_reactions for select to authenticated using (true);

-- Writes go through the RPC below, never a client INSERT: the RPC is what
-- checks society membership and the block predicate.

-- 4c. The one authority the UI mirrors ---------------------------------------
--     Returns the caller's capabilities as flags. The UI reads this to decide
--     what to RENDER; every RPC below still re-checks its own rank, so hiding a
--     button is never the only thing standing between a member and a power.
create or replace function public.society_capabilities(p_society uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with r as (
    select
      public.society_role_rank(p_society, auth.uid()) as rank,
      public.is_admin(auth.uid())                     as adm,
      exists (
        select 1 from public.community_members m
        where m.community_id = p_society and m.user_id = auth.uid()
      ) as is_member
  )
  select jsonb_build_object(
    'rank',              r.rank,
    'is_admin',          r.adm,
    'can_post',          (r.is_member or r.rank >= 30 or r.adm),
    'can_react',         (r.is_member or r.rank >= 30 or r.adm),
    'can_reply',         (r.is_member or r.rank >= 30 or r.adm),
    'can_post_anonymously', (r.is_member or r.rank >= 30 or r.adm),
    'can_moderate_members', (r.rank >= 30 or r.adm),
    'can_reveal_anonymous', (r.rank >= 90 or r.adm),
    'can_manage_events',    (r.rank >= 90 or r.adm),
    'can_assign_moderator', (r.rank >= 90 or r.adm),
    'can_assign_officers',  (r.rank >= 100 or r.adm),
    'can_remove_members',   (r.rank >= 100 or r.adm)
  )
  from r;
$$;

revoke all on function public.society_capabilities(uuid) from public, anon;
grant execute on function public.society_capabilities(uuid) to authenticated;

-- 4d. At most one president --------------------------------------------------
--     Created only when the data already satisfies it, so this migration cannot
--     fail on a society that somehow has two. The operator query to find them is
--     the same predicate; see the report at the end of this file.
do $$
begin
  if not exists (
    select 1 from public.society_roles
    where role = 'president'
    group by society_id having count(*) > 1
  ) then
    create unique index if not exists society_roles_one_president
      on public.society_roles (society_id)
      where role = 'president';
  end if;
end
$$;


-- 4e. The feed view: anonymity is masked HERE, in the only read path ---------
--     Not in the client. A member reading the broadcast channel gets NULLs for
--     the author of an anonymous message; the author sees their own; and only
--     a president (>=90), the owner, or an admin gets the real identity — which
--     is the same rule reveal_announcement_author enforces for the explicit
--     reveal action. Realtime is never subscribed to the raw table, so a
--     payload cannot leak what this masks.
-- COLUMN ORDER IS LOAD-BEARING HERE. `create or replace view` may only APPEND
-- columns: it cannot rename, reorder or retype an existing one, and inserting
-- `is_anonymous` next to the author fields (where it reads best) makes column 9
-- change name from `author_id` to `is_anonymous`, which PostgreSQL rejects with
-- 42P16. The two new columns are therefore appended at the END, and the
-- existing sixteen keep their exact names, order and types.
--
-- The alternative — DROP then CREATE — would also drop the grant and any
-- dependent object, for a purely cosmetic gain. Not worth it on a live view.
create or replace view public.society_announcement_feed
with (security_invoker = false) as
 select a.id,
    a.society_id,
    a.title,
    a.body,
    a.pinned,
    a.visibility,
    a.created_at,
    a.updated_at,
    case
      when not a.is_anonymous
        or a.author_id = auth.uid()
        or is_admin(auth.uid())
        or public.society_role_rank(a.society_id, auth.uid()) >= 90
      then a.author_id
      else null
    end as author_id,
    case
      when not a.is_anonymous
        or a.author_id = auth.uid()
        or is_admin(auth.uid())
        or public.society_role_rank(a.society_id, auth.uid()) >= 90
      then pr.full_name
      else null
    end as author_name,
    case
      when not a.is_anonymous
        or a.author_id = auth.uid()
        or is_admin(auth.uid())
        or public.society_role_rank(a.society_id, auth.uid()) >= 90
      then pr.username
      else null
    end as author_username,
    case
      when not a.is_anonymous
        or a.author_id = auth.uid()
        or is_admin(auth.uid())
        or public.society_role_rank(a.society_id, auth.uid()) >= 90
      then pr.avatar_url
      else null
    end as author_avatar,
    a.author_id = auth.uid() as is_mine,
    a.poll_id,
    a.attachment_url,
    a.attachment_type,
    -- Appended in 0178 (see the note above).
    a.is_anonymous,
    a.reply_to_id
   from society_announcements a
     join communities c on c.id = a.society_id
     join profiles pr on pr.id = a.author_id
  where c.status = 'approved'::community_status
    and (a.visibility = 'public'::text
         or a.author_id = auth.uid()
         or is_admin(auth.uid())
         or (exists ( select 1
               from community_members m
              where m.community_id = a.society_id and m.user_id = auth.uid())));

grant select on public.society_announcement_feed to authenticated;

-- 4f. Posting: members may now speak in the broadcast channel ----------------
--
-- THE OLD 5-ARGUMENT FORM MUST BE DROPPED FIRST, and this is not a tidy-up.
--
-- `create or replace function` only replaces a function of the SAME arity;
-- adding two parameters creates an OVERLOAD and leaves the 5-arg version in
-- place. The deployed app calls this with five NAMED arguments, which would
-- then match both candidates — the 5-arg exactly, and the 7-arg via its
-- defaults — and PostgreSQL answers "function is not unique". Posting a
-- broadcast would break the moment this migration landed, before any app
-- deploy could fix it.
--
-- Verified against the live schema (2026-09-02): the 5-arg form is what is
-- there today. After the drop, those same five named arguments resolve to the
-- new function through its defaults, so the currently deployed client keeps
-- working unchanged.
--
-- This is the same hazard `get_discover_candidates` is dropped for below.
drop function if exists public.post_society_announcement(uuid, text, text, text, text);

--     UAT-04 changes this surface from a one-way officer announcement board to
--     a shared, role-aware channel. Officers keep every power they had; what is
--     new is that an ordinary member can post, reply, and post anonymously.
create or replace function public.post_society_announcement(
  p_society         uuid,
  p_body            text,
  p_visibility      text default 'public',
  p_attachment_url  text default null,
  p_attachment_type text default null,
  p_is_anonymous    boolean default false,
  p_reply_to        uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid  uuid := auth.uid();
  v_id uuid;
  v_caps jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_caps := public.society_capabilities(p_society);
  if not (v_caps->>'can_post')::boolean then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_visibility not in ('public', 'members') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  if coalesce(btrim(p_body), '') = '' and p_attachment_url is null then
    raise exception 'say something or attach an image' using errcode = '22023';
  end if;
  -- A reply must point INSIDE this channel; otherwise a caller could graft a
  -- message onto another society thread.
  if p_reply_to is not null and not exists (
    select 1 from public.society_announcements a
    where a.id = p_reply_to and a.society_id = p_society
  ) then
    raise exception 'reply target is not in this channel' using errcode = '22023';
  end if;

  insert into public.society_announcements
    (society_id, author_id, title, body, visibility,
     attachment_url, attachment_type, is_anonymous, reply_to_id)
  values
    (p_society, uid, null, coalesce(btrim(p_body), ''), p_visibility,
     p_attachment_url, p_attachment_type,
     coalesce(p_is_anonymous, false), p_reply_to)
  returning id into v_id;

  -- Anonymous broadcasts carry NO actor: an actor id on the notification would
  -- undo the masking the feed view performs.
  perform public.notify_society_members(
    p_society,
    case when coalesce(p_is_anonymous, false) then null else uid end,
    'society_announcement',
    jsonb_build_object(
      'society_id', p_society,
      'community_id', p_society,
      'announcement_id', v_id,
      'is_anonymous', coalesce(p_is_anonymous, false)
    )
  );

  return v_id;
end;
$function$;

revoke all on function
  public.post_society_announcement(uuid, text, text, text, text, boolean, uuid)
  from public, anon;
grant execute on function
  public.post_society_announcement(uuid, text, text, text, text, boolean, uuid)
  to authenticated;

-- 4g. Reveal — president, owner, or admin only -------------------------------
create or replace function public.reveal_announcement_author(p_id uuid)
returns table (author_id uuid, full_name text, username text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_society uuid;
begin
  select a.society_id into v_society
    from public.society_announcements a where a.id = p_id;
  if v_society is null then
    raise exception 'not found' using errcode = '22023';
  end if;
  if not (public.society_role_rank(v_society, auth.uid()) >= 90
          or public.is_admin(auth.uid())) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, p.username, p.avatar_url
      from public.society_announcements a
      join public.profiles p on p.id = a.author_id
     where a.id = p_id;
end;
$$;

revoke all on function public.reveal_announcement_author(uuid) from public, anon;
grant execute on function public.reveal_announcement_author(uuid) to authenticated;

-- 4h. React to a broadcast message (one per user, toggling) ------------------
create or replace function public.toggle_announcement_reaction(
  p_id uuid, p_emoji text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  v_society  uuid;
  v_existing text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select a.society_id into v_society
    from public.society_announcements a where a.id = p_id;
  if v_society is null then
    raise exception 'not found' using errcode = '22023';
  end if;
  if not (public.society_capabilities(v_society)->>'can_react')::boolean then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select emoji into v_existing
    from public.society_announcement_reactions
   where announcement_id = p_id and user_id = uid;

  if v_existing is not null and v_existing = p_emoji then
    delete from public.society_announcement_reactions
     where announcement_id = p_id and user_id = uid;
    return false;
  end if;

  insert into public.society_announcement_reactions (announcement_id, user_id, emoji)
    values (p_id, uid, p_emoji)
  on conflict (announcement_id, user_id) do update set emoji = excluded.emoji;
  return true;
end;
$$;

revoke all on function public.toggle_announcement_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_announcement_reaction(uuid, text) to authenticated;

-- 4i. Role administration follows the matrix ---------------------------------
--     Widening, not loosening: the owner keeps everything, and the president
--     gains exactly one new power — appointing and removing MODERATORS. Every
--     other officer role stays the owner's alone (fix-024 is preserved for
--     those), because a president who could appoint presidents would make the
--     single-president rule unenforceable from inside the app.
create or replace function public.assign_society_role(
  p_society uuid, p_user uuid, p_role text, p_title text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid      uuid := auth.uid();
  is_adm   boolean := public.is_admin(auth.uid());
  v_owner  uuid;
  v_rank   integer := public.society_role_rank(p_society, auth.uid());
begin
  select owner_id into v_owner from public.communities where id = p_society;
  if v_owner is null then
    raise exception 'society not found';
  end if;
  if p_role not in
     ('president','vice_president','officer','media','event_manager','moderator') then
    raise exception 'invalid role';
  end if;
  if p_user = v_owner then
    raise exception 'the owner already leads this society';
  end if;

  if not is_adm
     and uid is distinct from v_owner
     and not (v_rank >= 90 and p_role = 'moderator') then
    raise exception 'only the owner can appoint officers';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user and onboarding_completed and not is_banned
  ) then
    raise exception 'that student was not found';
  end if;

  insert into public.community_members (community_id, user_id, role)
    values (p_society, p_user, 'member')
    on conflict do nothing;

  insert into public.society_roles (society_id, user_id, role, title, created_by)
    values (p_society, p_user, p_role, nullif(btrim(p_title), ''), uid)
    on conflict (society_id, user_id)
      do update set role = excluded.role, title = excluded.title;

  perform public.create_notification(
    p_user, uid, 'society_role', 'communities',
    jsonb_build_object('society_id', p_society, 'role', p_role)
  );
end;
$function$;

create or replace function public.remove_society_role(p_society uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid      uuid := auth.uid();
  is_adm   boolean := public.is_admin(auth.uid());
  v_owner  uuid;
  v_rank   integer := public.society_role_rank(p_society, auth.uid());
  v_target text;
begin
  select role into v_target from public.society_roles
   where society_id = p_society and user_id = p_user;
  if v_target is null then
    return; -- idempotent
  end if;
  select owner_id into v_owner from public.communities where id = p_society;

  if not is_adm
     and uid is distinct from v_owner
     and p_user is distinct from uid
     and not (v_rank >= 90 and v_target = 'moderator') then
    raise exception 'only the owner can change officer roles';
  end if;

  if p_user is distinct from uid then
    perform public.create_notification(
      p_user, uid, 'society_role_removed', 'communities',
      jsonb_build_object('society_id', p_society)
    );
  end if;

  delete from public.society_roles where society_id = p_society and user_id = p_user;
end;
$function$;

-- 4j. Owner transfer — the only way an owner is ever demoted ----------------
create or replace function public.transfer_society_ownership(
  p_society uuid, p_new_owner uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid     uuid := auth.uid();
  is_adm  boolean := public.is_admin(auth.uid());
  v_owner uuid;
begin
  select owner_id into v_owner from public.communities where id = p_society;
  if v_owner is null then
    raise exception 'society not found' using errcode = '22023';
  end if;
  if not is_adm and uid is distinct from v_owner then
    raise exception 'only the owner can transfer ownership' using errcode = '42501';
  end if;
  if p_new_owner = v_owner then
    return;
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_new_owner and onboarding_completed and not is_banned
  ) then
    raise exception 'that student was not found' using errcode = '22023';
  end if;

  -- The incoming owner must be a member; the outgoing one becomes president so
  -- the society is never left without someone who can run it. Their officer row
  -- (if any) is cleared first, and any sitting president is stepped down to
  -- vice_president so the one-president index still holds.
  insert into public.community_members (community_id, user_id, role)
    values (p_society, p_new_owner, 'owner')
  on conflict (community_id, user_id) do update set role = 'owner';

  delete from public.society_roles
   where society_id = p_society and user_id = p_new_owner;

  update public.society_roles set role = 'vice_president'
   where society_id = p_society and role = 'president';

  update public.communities set owner_id = p_new_owner where id = p_society;

  insert into public.community_members (community_id, user_id, role)
    values (p_society, v_owner, 'member')
  on conflict (community_id, user_id) do update set role = 'member';

  insert into public.society_roles (society_id, user_id, role, created_by)
    values (p_society, v_owner, 'president', uid)
  on conflict (society_id, user_id) do update set role = 'president';

  perform public.create_notification(
    p_new_owner, uid, 'society_role', 'communities',
    jsonb_build_object('society_id', p_society, 'role', 'owner')
  );
end;
$function$;

revoke all on function public.transfer_society_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_society_ownership(uuid, uuid) to authenticated;


-- ===========================================================================
-- 5. UAT-17 — the poll creator, and only the creator, may inspect ballots
-- ===========================================================================
--
-- Hiding the tap target is not a control: post_poll_votes / community_poll_votes
-- are readable tables, and a determined voter could enumerate them from the
-- client. So the ballot list is served by a definer RPC that checks ownership
-- BEFORE returning a single row, and the underlying per-voter reads stay where
-- they were.
--
-- ANONYMITY IS NOT LEAKED BY THIS. A poll attached to an anonymous broadcast or
-- an anonymous community message reveals the VOTERS (who chose openly), never
-- the poll's own author — the two identities are unrelated, and the RPC returns
-- nothing about the carrying message.

create or replace function public.poll_ballots(p_poll_id uuid)
returns table (
  user_id    uuid,
  full_name  text,
  avatar_url text,
  gender     text,
  option_id  uuid,
  label      text,
  voted_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_creator uuid;
  v_kind    text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select cp.creator_id, 'community' into v_creator, v_kind
    from public.community_polls cp where cp.id = p_poll_id;

  if v_creator is null then
    select pp.creator_id, 'post' into v_creator, v_kind
      from public.post_polls pp where pp.id = p_poll_id;
  end if;

  if v_creator is null then
    raise exception 'poll not found' using errcode = '22023';
  end if;
  if v_creator <> uid and not public.is_admin(uid) then
    raise exception 'only the poll creator can see who voted' using errcode = '42501';
  end if;

  if v_kind = 'community' then
    return query
      select v.user_id, p.full_name, p.avatar_url, p.gender,
             v.option_id, o.label, v.created_at
        from public.community_poll_votes v
        join public.community_poll_options o on o.id = v.option_id
        left join public.profiles p on p.id = v.user_id
       where v.poll_id = p_poll_id
       order by o.position asc, v.created_at asc;
  else
    return query
      select v.user_id, p.full_name, p.avatar_url, p.gender,
             v.option_id, o.label, v.created_at
        from public.post_poll_votes v
        join public.post_poll_options o on o.id = v.option_id
        left join public.profiles p on p.id = v.user_id
       where v.poll_id = p_poll_id
       order by o.position asc, v.created_at asc;
  end if;
end;
$$;

revoke all on function public.poll_ballots(uuid) from public, anon;
grant execute on function public.poll_ballots(uuid) to authenticated;

-- Who owns a poll, cheaply, so a client can decide whether to render the tap
-- target without asking for the ballots it may not be allowed to have.
create or replace function public.poll_is_mine(p_poll_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select cp.creator_id = auth.uid() from public.community_polls cp where cp.id = p_poll_id),
    (select pp.creator_id = auth.uid() from public.post_polls pp where pp.id = p_poll_id),
    false
  );
$$;

revoke all on function public.poll_is_mine(uuid) from public, anon;
grant execute on function public.poll_is_mine(uuid) to authenticated;


-- ===========================================================================
-- 6. UAT-08 — renaming, as a narrow operation rather than a broad UPDATE
-- ===========================================================================
--
-- The point of an RPC here (rather than relying on the existing "owners edit
-- their community" UPDATE policy) is that a rename must be able to touch the
-- NAME and nothing else. A policy that permits the row also permits status,
-- owner_id, is_discover_group and every other column in the same statement,
-- which is how the admin_role privesc happened once already.

create or replace function public.rename_community(p_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  v_owner uuid;
  v_name  text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'name must be 2-60 characters' using errcode = '22023';
  end if;

  select owner_id into v_owner from public.communities where id = p_id;
  if v_owner is null then
    raise exception 'not found' using errcode = '22023';
  end if;
  -- Owner or admin only. A moderator runs the queues; renaming the space is an
  -- identity change and stays with whoever owns it (UAT-04 grants no rename to
  -- moderators or presidents, so none is granted here).
  if uid is distinct from v_owner and not public.is_admin(uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- No-op when unchanged, so a double submit does not bump updated_at or fire
  -- a needless realtime event.
  update public.communities set name = v_name
   where id = p_id and name is distinct from v_name;

  return v_name;
end;
$$;

revoke all on function public.rename_community(uuid, text) from public, anon;
grant execute on function public.rename_community(uuid, text) to authenticated;

create or replace function public.rename_event(p_id uuid, p_title text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_host   uuid;
  v_title  text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if char_length(v_title) < 2 or char_length(v_title) > 120 then
    raise exception 'title must be 2-120 characters' using errcode = '22023';
  end if;

  select host_id into v_host from public.events where id = p_id;
  if v_host is null then
    raise exception 'not found' using errcode = '22023';
  end if;

  -- Host, a co-organizer, or an admin: the same authority that already manages
  -- the event elsewhere.
  if uid is distinct from v_host
     and not exists (
       select 1 from public.event_organizers o
       where o.event_id = p_id and o.user_id = uid
     )
     and not public.is_admin(uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.events set title = v_title
   where id = p_id and title is distinct from v_title;

  return v_title;
end;
$$;

revoke all on function public.rename_event(uuid, text) from public, anon;
grant execute on function public.rename_event(uuid, text) to authenticated;


-- ===========================================================================
-- 7. UAT-15 — a per-session seed, threaded through the whole deck
-- ===========================================================================
--
-- WHAT THIS IS NOT: `order by random()`. That would reshuffle on every page,
-- which in a keyset-paginated deck means duplicates and skips — the exact
-- failure the 0157 pagination work exists to prevent. It would also throw away
-- relevance entirely.
--
-- WHAT IT IS: the SAME ordering as 0177, with two keys inserted between the
-- department diversification and the exact compatibility score:
--
--   1. a coarse compatibility BAND (compatibility / 10, descending), so a 90%
--      candidate still outranks a 40% one however the seed falls;
--   2. a seeded hash of the candidate id, which shuffles freely WITHIN a band.
--
-- One session therefore sees a stable, non-repeating, correctly paginated deck;
-- the next session sees a different order among comparably-relevant people.
--
-- PARITY IS PRESERVED WHEN p_seed IS NULL. Both new keys collapse to constants
-- in that case, so the function reduces exactly to 0177 and
-- `supabase/tests/discover_candidates_parity.sql` still passes against it. That
-- is deliberate: the seed is a caller-supplied behaviour, not a silent change to
-- every existing call site.
--
-- Every eligibility predicate, the scoring formula, the gender pacing and the
-- recycle tiers are carried over untouched, so `lib/discover/match-score.ts`
-- and `lib/discover/gender-pacing.ts` remain accurate mirrors.
--
-- Arity changes, so the 2-arg function is dropped rather than replaced: leaving
-- both would make `get_discover_candidates(p_limit := 20, p_exclude := …)`
-- ambiguous and fail at the call site with "function is not unique".

drop function if exists public.get_discover_candidates(integer, uuid[]);

create function public.get_discover_candidates(
  p_limit integer default 20,
  p_exclude uuid[] default '{}'::uuid[],
  p_seed text default null
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
    select
      p.id, p.username, p.full_name, p.department, p.bio, p.avatar_url,
      p.aura_score, p.created_at, p.interests, p.gender, p.verified,
      public.current_semester(p.username) as sem_derived
    from public.profiles p, me
    where p.id <> me.uid
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
  scored as materialized (
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
          9 * least(s.shared_n, 6)
        + 11.0 * greatest(s.shared_n - 6, 0) / (greatest(s.shared_n - 6, 0) + 6)
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
  ),
  ordered as (
    select d.*,
      coalesce(lower(nullif(btrim(d.gender), '')) = 'female', false) as is_female,
      row_number() over (
        partition by d.tier
        order by
          d.dept_rank asc,
          -- UAT-15: both keys are constant when no seed is supplied, so the
          -- unseeded ordering is byte-identical to 0177.
          (case when p_seed is null then 0 else (d.compatibility / 10) end) desc,
          (case when p_seed is null then 0
                else hashtextextended(p_seed || ':' || d.id::text, 0) end) asc,
          d.compatibility desc,
          d.they_liked_me desc,
          d.mutual_comms desc,
          case when d.tier = 0 then d.sort_key end desc nulls last,
          case when d.tier = 1 then d.sort_key end asc nulls last,
          d.id asc
      ) as ord
    from diversified d
  ),
  bucketed as (
    select o.*,
      row_number() over (partition by o.tier, o.is_female order by o.ord) as bucket_rank
    from ordered o
  ),
  paced as (
    select b.*,
      case
        when b.my_gender is distinct from 'female' then b.ord
        when b.is_female then ((b.bucket_rank - 1) / 2) * 3 + ((b.bucket_rank - 1) % 2) + 1
        else b.bucket_rank * 3
      end as slot
    from bucketed b
  )
  select
    id, full_name, department, sem_derived as semester, bio, avatar_url,
    interests, gender, aura_score, verified, is_recycled,
    compatibility,
    coalesce(shared_arr, '{}') as shared_interests
  from paced
  order by tier asc, slot asc, ord asc
  limit greatest(1, least(p_limit, 50));
$function$;

revoke all on function public.get_discover_candidates(integer, uuid[], text)
  from public, anon;
grant execute on function public.get_discover_candidates(integer, uuid[], text)
  to authenticated;


-- ===========================================================================
-- 8. UAT-18 — high-volume chat surfaces get a GROUP KEY
-- ===========================================================================
--
-- Notifications for room/broadcast/event traffic already existed (0168) but
-- were excluded from the Notifications page, partly because a busy room emits
-- one row per message and would bury everything else.
--
-- `create_notification` has collapsed on (user_id, type, group_key) since 0057;
-- these three fan-outs simply never passed one. Keying on the SUBJECT (the room,
-- the society, the event) collapses a burst into a single live unread row that
-- carries the newest actor and a group_count, and the row splits again as soon
-- as the reader marks it read — which is what makes "3 new messages in Robotics"
-- one line instead of thirty.
--
-- The fan-out sets, the anonymity handling and the payloads are otherwise
-- carried over from 0168 unchanged.

create or replace function public.notify_community_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_member record;
begin
  select name into v_name from public.communities where id = new.community_id;

  for v_member in
    select m.user_id
      from public.community_members m
     where m.community_id = new.community_id
       and m.user_id <> new.sender_id
  loop
    perform public.create_notification(
      v_member.user_id,
      case when new.is_anonymous then null else new.sender_id end,
      'community_message',
      'communities',
      jsonb_build_object(
        'community_id', new.community_id,
        'message_id', new.id,
        'community_name', v_name,
        'is_anonymous', new.is_anonymous
      ),
      'community:' || new.community_id::text
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.notify_community_message() from public, anon, authenticated;

create or replace function public.notify_society_members(
  p_society uuid,
  p_actor uuid,
  p_type text,
  p_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_name text;
begin
  select name into v_name from public.communities where id = p_society;

  for m in
    select user_id from public.community_followers where community_id = p_society
    union
    select user_id from public.community_members where community_id = p_society
  loop
    perform public.create_notification(
      m.user_id,
      p_actor,
      p_type,
      'communities',
      coalesce(p_data, '{}'::jsonb) || jsonb_build_object('community_name', v_name),
      p_type || ':' || p_society::text
    );
  end loop;
end;
$$;

revoke all on function public.notify_society_members(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.notify_event_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_title text;
  r record;
begin
  select host_id, title into v_host, v_title
    from public.events where id = new.event_id;

  for r in
    select distinct user_id
    from (
      select a.user_id
        from public.event_attendees a
       where a.event_id = new.event_id
      union
      select v_host
      union
      select o.user_id
        from public.event_organizers o
       where o.event_id = new.event_id
    ) recipients
    where user_id is not null
      and user_id <> new.sender_id
  loop
    perform public.create_notification(
      r.user_id,
      new.sender_id,
      'event_message',
      'events',
      jsonb_build_object(
        'event_id', new.event_id,
        'message_id', new.id,
        'event_title', v_title
      ),
      'event:' || new.event_id::text
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.notify_event_message() from public, anon, authenticated;


-- ===========================================================================
-- 9. Operator reports (read-only; run manually, nothing here mutates)
-- ===========================================================================
--
--   -- UAT-12: matches with no reciprocal like, for review. NEVER auto-deleted.
--   select * from public.matches_without_mutual_likes order by created_at desc;
--
--   -- UAT-04: societies that held more than one president before this
--   -- migration (the single-president index is skipped when any exist).
--   select society_id, count(*) from public.society_roles
--    where role = 'president' group by society_id having count(*) > 1;
