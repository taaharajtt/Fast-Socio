-- ===========================================================================
-- 0179 — conversation parity for every non-DM surface
--
-- Direct messages have had replies, reactions, edits, unsend, pins and
-- optimistic/retryable sends for several releases. Community chat rooms, event
-- discussions and society broadcast channels have had a subset each, and the
-- subsets do not overlap:
--
--                        reply   react   edit   delete   pin
--   messages (DM)          y       y      y       y       y     (0045/0049/0167)
--   community_chat         -       -      -       y       -     (0142)
--   event_messages         -       -      -       -       -     (0056)
--   society_announcements  y       y      -       y       y     (0178)
--
-- This migration closes the gaps. It adds NO new authorization model: every
-- new write goes through the same shape the surface already used — an RLS
-- policy where one exists (community tombstones, event messages), a definer
-- RPC that re-checks rank where the surface is role-based (societies).
--
-- WHAT IS DELIBERATELY NOT HERE
--
--  * No new tables in the `supabase_realtime` publication for reactions.
--    Migration 0176 measured `realtime.apply_rls` at 57% of total database
--    time — the cost is (write rate x subscriber count) and a reaction is a
--    high-rate, low-value write. Reactions therefore synchronise the way poll
--    votes already do on these surfaces: the actor broadcasts a message id on
--    the channel that is already open, and every subscriber re-reads that
--    message's reactions through RLS. Same freshness, none of the WAL.
--  * No soft-delete for broadcasts. `delete_society_announcement` hard-deletes
--    today and the runbook is explicit that existing delete behaviour is
--    preserved; the client handles the realtime DELETE instead.
--  * No voice notes outside DMs — there is no column for one on any of these
--    tables and no product ask for it.
--
-- The one publication change IS `society_announcements`, and it is a fix
-- rather than an addition: `announcement-thread.tsx` has subscribed to that
-- table since it was written, but the table has never been published, so the
-- broadcast channel has never once updated live. Migration 0176 flagged this
-- and left it as a product call. The call is made here — a broadcast channel
-- is low-rate by construction (it is rate-limited to 20 posts per society per
-- day in `postSocietyAnnouncement`), so the WAL cost is bounded in a way a
-- chat room's is not.
-- ===========================================================================

-- Report targets for the two message kinds that could not be reported before.
-- Added at the top and NOT referenced anywhere below: a new enum value may not
-- be used in the transaction that creates it.
alter type public.report_target_type add value if not exists 'community_message';
alter type public.report_target_type add value if not exists 'event_message';


-- ===========================================================================
-- 1. COMMUNITY / CHAT-ROOM / DISCOVER-ROOM CHAT  (community_chat_messages)
-- ===========================================================================

-- 1a. Columns ---------------------------------------------------------------
alter table public.community_chat_messages
  add column if not exists reply_to_id uuid
    references public.community_chat_messages (id) on delete set null,
  add column if not exists edited_at  timestamptz,
  add column if not exists pinned_at  timestamptz,
  add column if not exists pinned_by  uuid references public.profiles (id) on delete set null;

create index if not exists community_chat_messages_reply_idx
  on public.community_chat_messages (reply_to_id)
  where reply_to_id is not null;

create index if not exists community_chat_messages_pinned_idx
  on public.community_chat_messages (community_id, pinned_at desc)
  where pinned_at is not null;

-- 1b. A reply must stay inside its own room ---------------------------------
--     Same guard, same reasoning, as `enforce_reply_same_conversation` (0167):
--     the INSERT policy checks the sender and the room but says nothing about
--     the columns' CONTENTS, so a crafted insert could otherwise point
--     `reply_to_id` at a message in a room the sender is not in. It would not
--     leak the quoted body (the reader still cannot select that row) but it
--     would let a message dangle a reference across rooms. A trigger, not a
--     CHECK, because a CHECK may not query another table.
create or replace function public.enforce_community_reply_same_room()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  target_room uuid;
begin
  if new.reply_to_id is null then
    return new;
  end if;
  if new.reply_to_id = new.id then
    raise exception 'A message cannot reply to itself';
  end if;

  select m.community_id into target_room
    from public.community_chat_messages m
   where m.id = new.reply_to_id;

  if target_room is null then
    raise exception 'Replied-to message does not exist';
  end if;
  if target_room <> new.community_id then
    raise exception 'A reply must target a message in the same room';
  end if;
  return new;
end;
$$;

drop trigger if exists community_chat_reply_same_room on public.community_chat_messages;
create trigger community_chat_reply_same_room
  before insert or update of reply_to_id on public.community_chat_messages
  for each row execute function public.enforce_community_reply_same_room();

-- 1c. Who may moderate a room's chat ----------------------------------------
--     `can_delete_community_message` (0142) answers "may I delete THIS
--     message", which is true for your own message. Pinning is a moderation
--     act on someone else's words, so it needs the narrower question — the
--     same set minus "because I wrote it".
create or replace function public.can_moderate_community_chat(p_community uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    exists (
      select 1 from public.community_members m
       where m.community_id = p_community
         and m.user_id = (select auth.uid())
         and m.role = any (array['owner', 'moderator']::public.community_role[])
    )
    or exists (
      select 1 from public.communities c
       where c.id = p_community
         and c.is_society
         and public.is_society_officer(c.id, (select auth.uid()))
    )
    or public.is_admin((select auth.uid()));
$function$;

revoke all on function public.can_moderate_community_chat(uuid) from public, anon;
grant execute on function public.can_moderate_community_chat(uuid) to authenticated;

-- 1d. Sending a reply --------------------------------------------------------
--
-- THE 3-ARGUMENT FORM MUST BE DROPPED FIRST, and this is not a tidy-up.
-- `create or replace function` only replaces a function of the SAME arity, so
-- adding a parameter creates an OVERLOAD. The deployed client calls this with
-- three NAMED arguments, which would then match both candidates — the 3-arg
-- exactly and the 4-arg through its default — and PostgreSQL answers
-- "function is not unique", breaking every room the moment this landed and
-- before any app deploy could fix it. Same hazard 0178 documents for
-- `post_society_announcement`.
--
-- After the drop, those same three named arguments resolve to the new function
-- through its default, so the currently deployed client keeps working.
drop function if exists public.send_community_message(uuid, text, boolean);

create or replace function public.send_community_message(
  p_community_id uuid,
  p_body         text,
  p_anonymous    boolean default false,
  p_reply_to     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  v_body text := btrim(p_body);
  v_id   uuid;
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = me
  ) then
    raise exception 'not a member';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'message must be 1-2000 characters';
  end if;

  insert into public.community_chat_messages
    (community_id, sender_id, body, is_anonymous, reply_to_id)
  values
    (p_community_id, me, v_body, coalesce(p_anonymous, false), p_reply_to)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.send_community_message(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.send_community_message(uuid, text, boolean, uuid) to authenticated;

-- 1e. Editing your own message ----------------------------------------------
--     Text only, mirroring `edit_message` for DMs: an image or a poll has no
--     editable text, and allowing the body of a poll row to change would
--     rewrite a question people have already voted on.
create or replace function public.edit_community_chat_message(
  p_message_id uuid,
  p_body       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  v_body text := btrim(p_body);
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'message must be 1-2000 characters' using errcode = '22023';
  end if;

  update public.community_chat_messages
     set body = v_body, edited_at = now()
   where id = p_message_id
     and sender_id = me
     and deleted_at is null
     and poll_id is null
     and attachment_url is null;

  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.edit_community_chat_message(uuid, text) from public, anon;
grant execute on function public.edit_community_chat_message(uuid, text) to authenticated;

-- 1f. Pin / unpin ------------------------------------------------------------
create or replace function public.set_community_chat_pin(
  p_message_id uuid,
  p_pinned     boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me    uuid := auth.uid();
  v_com uuid;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select community_id into v_com
    from public.community_chat_messages
   where id = p_message_id and deleted_at is null;
  if v_com is null then
    raise exception 'not found' using errcode = '22023';
  end if;
  if not public.can_moderate_community_chat(v_com) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.community_chat_messages
     set pinned_at = case when p_pinned then now() else null end,
         pinned_by = case when p_pinned then me else null end
   where id = p_message_id;

  return coalesce(p_pinned, false);
end;
$$;

revoke all on function public.set_community_chat_pin(uuid, boolean) from public, anon;
grant execute on function public.set_community_chat_pin(uuid, boolean) to authenticated;

-- 1g. Reactions --------------------------------------------------------------
--     One per user per message, exactly like `message_reactions` (0049):
--     picking a new emoji replaces your old one, picking the same one clears
--     it. Reads are open to room members; there is NO client write path, so a
--     reaction can only ever be forged through the RPC, which checks
--     membership.
create table if not exists public.community_chat_reactions (
  message_id uuid not null references public.community_chat_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists community_chat_reactions_message_idx
  on public.community_chat_reactions (message_id);

alter table public.community_chat_reactions enable row level security;

revoke all on public.community_chat_reactions from anon, authenticated;
grant select on public.community_chat_reactions to authenticated;

drop policy if exists "members read room reactions" on public.community_chat_reactions;
create policy "members read room reactions"
  on public.community_chat_reactions for select to authenticated
  using (
    exists (
      select 1
        from public.community_chat_messages m
        join public.community_members cm
          on cm.community_id = m.community_id
       where m.id = community_chat_reactions.message_id
         and cm.user_id = (select auth.uid())
    )
  );

create or replace function public.toggle_community_chat_reaction(
  p_message_id uuid,
  p_emoji      text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me         uuid := auth.uid();
  v_emoji    text := btrim(p_emoji);
  v_com      uuid;
  v_existing text;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_emoji) < 1 or char_length(v_emoji) > 8 then
    raise exception 'invalid emoji' using errcode = '22023';
  end if;

  select community_id into v_com
    from public.community_chat_messages
   where id = p_message_id and deleted_at is null;
  if v_com is null then
    raise exception 'not found' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.community_members m
     where m.community_id = v_com and m.user_id = me
  ) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  select emoji into v_existing
    from public.community_chat_reactions
   where message_id = p_message_id and user_id = me;

  if v_existing is not null and v_existing = v_emoji then
    delete from public.community_chat_reactions
     where message_id = p_message_id and user_id = me;
    return false;
  end if;

  insert into public.community_chat_reactions (message_id, user_id, emoji)
    values (p_message_id, me, v_emoji)
  on conflict (message_id, user_id)
    do update set emoji = excluded.emoji, created_at = now();
  return true;
end;
$$;

revoke all on function public.toggle_community_chat_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_community_chat_reaction(uuid, text) to authenticated;

-- 1h. Surface the new columns ------------------------------------------------
--     Columns are APPENDED. `create or replace view` may not rename, reorder or
--     retype an existing column (42P16), and the anonymity masking below is
--     reproduced verbatim from 0142 rather than rewritten.
create or replace view public.community_chat_view as
 select m.id,
    m.community_id,
    m.body,
    m.poll_id,
    m.is_anonymous,
    m.created_at,
        case
            when m.is_anonymous and m.sender_id <> auth.uid() and not is_admin(auth.uid()) then null::uuid
            else m.sender_id
        end as sender_id,
        case
            when m.is_anonymous and m.sender_id <> auth.uid() and not is_admin(auth.uid()) then null::text
            else pr.full_name
        end as sender_name,
        case
            when m.is_anonymous and m.sender_id <> auth.uid() and not is_admin(auth.uid()) then null::text
            else pr.avatar_url
        end as sender_avatar,
        case
            when m.is_anonymous and m.sender_id <> auth.uid() and not is_admin(auth.uid()) then null::text
            else pr.gender
        end as sender_gender,
    m.deleted_at,
    m.attachment_url,
    m.attachment_type,
    -- new in 0179
    m.edited_at,
    m.pinned_at,
    m.reply_to_id
   from community_chat_messages m
     join profiles pr on pr.id = m.sender_id
  where (exists ( select 1
           from community_members cm
          where cm.community_id = m.community_id and cm.user_id = auth.uid()));

-- Re-assert explicitly: CREATE OR REPLACE VIEW has silently reset this before
-- (see the note in migration 0126), which would turn the view SECURITY DEFINER
-- and bypass RLS.
alter view public.community_chat_view set (security_invoker = on);


-- ===========================================================================
-- 2. EVENT DISCUSSION  (event_messages)
-- ===========================================================================
--
-- The most under-built of the three: no delete, no edit, no attachments, no
-- replies, no reactions. Gating is unchanged throughout — reading needs an
-- attendee row (or the host/an admin), and posting needs an attendee row on an
-- APPROVED event. Every new capability below is gated by the same predicates,
-- so a non-attendee still cannot send, react, edit or delete.

-- 2a. Columns ---------------------------------------------------------------
alter table public.event_messages
  add column if not exists reply_to_id uuid
    references public.event_messages (id) on delete set null,
  add column if not exists edited_at       timestamptz,
  add column if not exists deleted_at      timestamptz,
  add column if not exists attachment_url  text,
  add column if not exists attachment_type text;

alter table public.event_messages
  drop constraint if exists event_messages_attachment_type_check,
  add  constraint event_messages_attachment_type_check
    check (attachment_type is null or attachment_type = 'image');

alter table public.event_messages
  drop constraint if exists event_messages_attachment_pair_check,
  add  constraint event_messages_attachment_pair_check
    check ((attachment_url is null) = (attachment_type is null));

-- The original CHECK is `char_length(body) between 1 and 1000`, which blocks
-- BOTH new cases: a photo with no caption, and a tombstone. Same trap 0143
-- caught on community chat, where it was found by executing the write rather
-- than by reading the DDL. The ceiling is unchanged.
alter table public.event_messages
  drop constraint if exists event_messages_body_check;
alter table public.event_messages
  add constraint event_messages_body_check
  check (
    char_length(body) <= 1000
    and (
      char_length(body) >= 1        -- an ordinary text message
      or attachment_url is not null -- an image, caption optional
      or deleted_at is not null     -- a tombstone
    )
  );

create index if not exists event_messages_reply_idx
  on public.event_messages (reply_to_id)
  where reply_to_id is not null;

create index if not exists event_messages_live_idx
  on public.event_messages (event_id, created_at)
  where deleted_at is null;

-- 2b. A reply must stay inside its own event --------------------------------
create or replace function public.enforce_event_reply_same_event()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  target_event uuid;
begin
  if new.reply_to_id is null then
    return new;
  end if;
  if new.reply_to_id = new.id then
    raise exception 'A message cannot reply to itself';
  end if;

  select m.event_id into target_event
    from public.event_messages m
   where m.id = new.reply_to_id;

  if target_event is null then
    raise exception 'Replied-to message does not exist';
  end if;
  if target_event <> new.event_id then
    raise exception 'A reply must target a message in the same event';
  end if;
  return new;
end;
$$;

drop trigger if exists event_messages_reply_same_event on public.event_messages;
create trigger event_messages_reply_same_event
  before insert or update of reply_to_id on public.event_messages
  for each row execute function public.enforce_event_reply_same_event();

-- 2c. Who may take part ------------------------------------------------------
--     Definer so it can read the attendee row under a caller who can only see
--     their own; it returns a boolean about the caller and nothing else.
create or replace function public.can_post_event_message(p_event uuid, p_user uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.event_attendees a
      join public.events e on e.id = a.event_id
     where a.event_id = p_event
       and a.user_id  = p_user
       and e.status   = 'approved'
  );
$function$;

revoke all on function public.can_post_event_message(uuid, uuid) from public, anon;
grant execute on function public.can_post_event_message(uuid, uuid) to authenticated;

/* Moderation authority over the thread: the host, an organizer, or an admin. */
create or replace function public.can_moderate_event_messages(p_event uuid, p_user uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    exists (select 1 from public.events e where e.id = p_event and e.host_id = p_user)
    or exists (
      select 1 from public.event_organizers o
       where o.event_id = p_event and o.user_id = p_user
    )
    or public.is_admin(p_user);
$function$;

revoke all on function public.can_moderate_event_messages(uuid, uuid) from public, anon;
grant execute on function public.can_moderate_event_messages(uuid, uuid) to authenticated;

-- 2d. The UPDATE policies that enforce edit and unsend -----------------------
--     `event_messages` had no UPDATE policy at all, so nothing could be edited
--     or removed by anyone. These are the first two, and they are written the
--     way 0142 wrote community chat's: the POLICY is the authorization, and the
--     RPCs below are SECURITY INVOKER so they cannot bypass it.
--
--     Two permissive UPDATE policies OR together, in both USING and WITH CHECK.
--     That is intended and safe here: the tombstone policy's WITH CHECK forces
--     the row to become content-free, so a host who is not the author can only
--     ever produce a tombstone; the edit policy's USING requires authorship, so
--     nobody can rewrite someone else's words through it.
drop policy if exists "authorized may tombstone event messages" on public.event_messages;
create policy "authorized may tombstone event messages"
  on public.event_messages
  for update to authenticated
  using (
    deleted_at is null
    and (
      sender_id = (select auth.uid())
      or public.can_moderate_event_messages(event_id, (select auth.uid()))
    )
  )
  with check (
    deleted_at is not null
    and body = ''
    and attachment_url is null
    and attachment_type is null
  );

drop policy if exists "authors may edit their event message" on public.event_messages;
create policy "authors may edit their event message"
  on public.event_messages
  for update to authenticated
  using (
    sender_id = (select auth.uid())
    and deleted_at is null
    -- Text only, like every other edit in the app: an image message has no
    -- editable text and this path must not be able to swap its attachment.
    and attachment_url is null
  )
  with check (
    sender_id = (select auth.uid())
    and deleted_at is null
    and attachment_url is null
    and edited_at is not null
  );

create or replace function public.edit_event_message(
  p_message_id uuid,
  p_body       text
) returns void
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_body text := btrim(p_body);
begin
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'message must be 1-1000 characters' using errcode = '22023';
  end if;

  update public.event_messages
     set body = v_body, edited_at = now()
   where id = p_message_id;

  if not found then
    -- The row is missing, is a tombstone, carries an image, or RLS filtered it
    -- out because this caller is not the author. Deliberately one message for
    -- all four so the call cannot be used to probe which messages exist.
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.edit_event_message(uuid, text) from public, anon;
grant execute on function public.edit_event_message(uuid, text) to authenticated;

create or replace function public.delete_event_message(p_message_id uuid)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $function$
begin
  update public.event_messages
     set body            = '',
         attachment_url  = null,
         attachment_type = null,
         deleted_at      = now()
   where id = p_message_id
     and deleted_at is null;

  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.delete_event_message(uuid) from public, anon;
grant execute on function public.delete_event_message(uuid) to authenticated;

-- 2e. Reactions --------------------------------------------------------------
create table if not exists public.event_message_reactions (
  message_id uuid not null references public.event_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists event_message_reactions_message_idx
  on public.event_message_reactions (message_id);

alter table public.event_message_reactions enable row level security;

revoke all on public.event_message_reactions from anon, authenticated;
grant select on public.event_message_reactions to authenticated;

drop policy if exists "event thread readers read reactions" on public.event_message_reactions;
create policy "event thread readers read reactions"
  on public.event_message_reactions for select to authenticated
  using (
    exists (
      select 1
        from public.event_messages m
       where m.id = event_message_reactions.message_id
         -- The same predicate as the thread's own SELECT policy, so anyone who
         -- can read a message can read its reactions and nobody else can.
         and (
           exists (
             select 1 from public.events e
              where e.id = m.event_id
                and (e.host_id = (select auth.uid()) or public.is_admin((select auth.uid())))
           )
           or exists (
             select 1 from public.event_attendees a
              where a.event_id = m.event_id and a.user_id = (select auth.uid())
           )
         )
    )
  );

-- Reacting requires the right to POST, not merely to read: a host watching a
-- thread they did not register for may moderate it but does not join in.
create or replace function public.toggle_event_message_reaction(
  p_message_id uuid,
  p_emoji      text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me         uuid := auth.uid();
  v_emoji    text := btrim(p_emoji);
  v_event    uuid;
  v_existing text;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_emoji) < 1 or char_length(v_emoji) > 8 then
    raise exception 'invalid emoji' using errcode = '22023';
  end if;

  select event_id into v_event
    from public.event_messages
   where id = p_message_id and deleted_at is null;
  if v_event is null then
    raise exception 'not found' using errcode = '22023';
  end if;
  if not public.can_post_event_message(v_event, me) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select emoji into v_existing
    from public.event_message_reactions
   where message_id = p_message_id and user_id = me;

  if v_existing is not null and v_existing = v_emoji then
    delete from public.event_message_reactions
     where message_id = p_message_id and user_id = me;
    return false;
  end if;

  insert into public.event_message_reactions (message_id, user_id, emoji)
    values (p_message_id, me, v_emoji)
  on conflict (message_id, user_id)
    do update set emoji = excluded.emoji, created_at = now();
  return true;
end;
$$;

revoke all on function public.toggle_event_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_event_message_reaction(uuid, text) to authenticated;

-- 2f. A tombstone must not raise a notification ------------------------------
--     `notify_event_message` is an AFTER INSERT trigger, so an UPDATE cannot
--     reach it. Stated here because the equivalent is easy to get wrong when
--     someone later widens that trigger to UPDATE.


-- ===========================================================================
-- 3. SOCIETY BROADCAST CHANNEL  (society_announcements)
-- ===========================================================================
--
-- 0178 already gave this surface replies, reactions and anonymity. The two
-- gaps are an EDIT — every other surface lets you fix your own typo — and the
-- fact that none of it has ever arrived live.

create or replace function public.edit_society_announcement(
  p_announcement uuid,
  p_body         text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  v_body text := btrim(p_body);
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'message must be 1-4000 characters' using errcode = '22023';
  end if;

  -- The AUTHOR only, including the author of an anonymous broadcast (who is
  -- matched on the real column, not on the masked view). An officer may delete
  -- a broadcast but may never rewrite one: putting words in a member's mouth,
  -- under their name, is not a moderation power.
  update public.society_announcements
     set body = v_body, updated_at = now()
   where id = p_announcement
     and author_id = me
     and poll_id is null;

  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.edit_society_announcement(uuid, text) from public, anon;
grant execute on function public.edit_society_announcement(uuid, text) to authenticated;


-- ===========================================================================
-- 4. REALTIME
-- ===========================================================================
--
-- `society_announcements` only. See the header for why the reaction tables are
-- deliberately NOT published. Guarded so re-running this migration, or running
-- it against a database where someone has already added the table by hand, is
-- not an error — `alter publication ... add table` has no IF NOT EXISTS.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'society_announcements'
  ) then
    execute 'alter publication supabase_realtime add table public.society_announcements';
  end if;
end
$$;


-- ===========================================================================
-- 5. Post-apply verification (run manually; nothing here mutates)
-- ===========================================================================
--
--   -- Every new function exists at the arity the app calls it with.
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in (
--        'send_community_message', 'edit_community_chat_message',
--        'set_community_chat_pin', 'toggle_community_chat_reaction',
--        'can_moderate_community_chat', 'edit_event_message',
--        'delete_event_message', 'toggle_event_message_reaction',
--        'can_post_event_message', 'can_moderate_event_messages',
--        'edit_society_announcement')
--    order by 1;
--
--   -- send_community_message must be UNIQUE: exactly one row, 4 arguments.
--   -- Two rows here means the drop above did not take and every room is broken.
--
--   -- The view carries the three appended columns.
--   select column_name from information_schema.columns
--    where table_name = 'community_chat_view'
--      and column_name in ('edited_at', 'pinned_at', 'reply_to_id');
--
--   -- `check_function_bodies` does not catch a column that does not exist, so
--   -- the bodies above must be verified by EXECUTING them, not by applying
--   -- cleanly. See migration 0143 for the failure this exists to prevent.
