-- =============================================================================
-- FAST SOCIO — UAT Phase 3 data layer
--
--   UAT-003  presence            profiles.last_seen_at + touch_last_seen()
--   UAT-009  message edit/delete messages.edited_at/deleted_at + RPCs
--   UAT-005  community chat      is_anonymous, polls, and an author-masking view
--   UAT-013  events badge        profiles.events_seen_at + touch_events_seen()
--
-- Everything a client may write goes through a SECURITY DEFINER RPC; no new
-- UPDATE/INSERT policies are opened on messages or on the poll tables.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- UAT-003 · Presence
--
-- `last_seen_at` is stamped by a heartbeat while the app tab is visible. It is
-- null for users who have not been seen since this migration, which reads as
-- "offline" — the previous behaviour (a hardcoded "Active now") reported every
-- user as online forever.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists last_seen_at   timestamptz,
  add column if not exists events_seen_at timestamptz;

create index if not exists profiles_last_seen_idx
  on public.profiles (last_seen_at desc nulls last);

create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

revoke all on function public.touch_last_seen() from public;
grant execute on function public.touch_last_seen() to authenticated;

-- UAT-013: stamp the last time the caller opened /events, so the dock badge can
-- count events created since.
create or replace function public.touch_events_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set events_seen_at = now() where id = auth.uid();
$$;

revoke all on function public.touch_events_seen() from public;
grant execute on function public.touch_events_seen() to authenticated;

-- ---------------------------------------------------------------------------
-- UAT-009 · Message edit / delete
--
-- Deleting is a soft delete: the row survives (moderation + read receipts still
-- reference it) but its content is destroyed. `messages` has a
-- `check (body is not null or attachment_url is not null)` constraint, so a
-- tombstone keeps body = '' rather than null.
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists edited_at  timestamptz,
  add column if not exists deleted_at timestamptz;

create or replace function public.edit_message(p_message_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  text_body text := btrim(p_body);
begin
  if char_length(text_body) < 1 or char_length(text_body) > 4000 then
    raise exception 'message must be 1-4000 characters';
  end if;

  -- Only a plain text message the caller sent, still alive, may be edited.
  update public.messages
     set body = text_body,
         edited_at = now()
   where id = p_message_id
     and sender_id = me
     and deleted_at is null
     and attachment_url is null
     and shared_post_id is null;

  if not found then
    raise exception 'message not editable';
  end if;
end;
$$;

revoke all on function public.edit_message(uuid, text) from public;
grant execute on function public.edit_message(uuid, text) to authenticated;

create or replace function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  update public.messages
     set body            = '',
         attachment_url  = null,
         attachment_type = null,
         shared_post_id  = null,
         deleted_at      = now()
   where id = p_message_id
     and sender_id = me
     and deleted_at is null;

  if not found then
    raise exception 'message not deletable';
  end if;
end;
$$;

revoke all on function public.delete_message(uuid) from public;
grant execute on function public.delete_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- UAT-005 · Community chat: anonymous messages + polls
-- ---------------------------------------------------------------------------
create table if not exists public.community_polls (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities (id) on delete cascade,
  creator_id    uuid not null references public.profiles (id) on delete cascade,
  question      text not null check (char_length(question) between 1 and 300),
  created_at    timestamptz not null default now()
);

create table if not exists public.community_poll_options (
  id        uuid primary key default gen_random_uuid(),
  poll_id   uuid not null references public.community_polls (id) on delete cascade,
  label     text not null check (char_length(label) between 1 and 80),
  position  int  not null
);

create table if not exists public.community_poll_votes (
  poll_id    uuid not null references public.community_polls (id) on delete cascade,
  option_id  uuid not null references public.community_poll_options (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create index if not exists community_polls_community_idx
  on public.community_polls (community_id, created_at desc);
create index if not exists community_poll_options_poll_idx
  on public.community_poll_options (poll_id, position);
create index if not exists community_poll_votes_option_idx
  on public.community_poll_votes (option_id);
create index if not exists community_poll_votes_user_idx
  on public.community_poll_votes (user_id);

alter table public.community_polls        enable row level security;
alter table public.community_poll_options enable row level security;
alter table public.community_poll_votes   enable row level security;

create policy "members read community polls"
  on public.community_polls for select to authenticated
  using (
    exists (
      select 1 from public.community_members m
      where m.community_id = community_polls.community_id
        and m.user_id = (select auth.uid())
    )
  );

create policy "members read community poll options"
  on public.community_poll_options for select to authenticated
  using (
    exists (
      select 1
      from public.community_polls p
      join public.community_members m on m.community_id = p.community_id
      where p.id = community_poll_options.poll_id
        and m.user_id = (select auth.uid())
    )
  );

-- Individual ballots are private: a member may read only their OWN vote. Tallies
-- come from community_poll_results below, which aggregates under definer rights.
create policy "users read their own poll vote"
  on public.community_poll_votes for select to authenticated
  using (user_id = (select auth.uid()));

-- No client INSERT/UPDATE on any of the three: writes go through the RPCs.

alter table public.community_chat_messages
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists poll_id uuid references public.community_polls (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- community_chat_view: the read path for the chat room. Masks sender identity on
-- anonymous messages (mirroring the feed_posts view). The base table stays
-- readable by members — realtime needs that — so the client must NOT trust a
-- realtime INSERT payload's sender_id and instead refetches the row from here.
-- ---------------------------------------------------------------------------
create or replace view public.community_chat_view as
select
  m.id,
  m.community_id,
  m.body,
  m.poll_id,
  m.is_anonymous,
  m.created_at,
  case when m.is_anonymous and m.sender_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else m.sender_id end as sender_id,
  case when m.is_anonymous and m.sender_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else pr.full_name end as sender_name,
  case when m.is_anonymous and m.sender_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else pr.avatar_url end as sender_avatar
from public.community_chat_messages m
join public.profiles pr on pr.id = m.sender_id
where exists (
  select 1 from public.community_members cm
  where cm.community_id = m.community_id
    and cm.user_id = auth.uid()
);

grant select on public.community_chat_view to authenticated;

-- ---------------------------------------------------------------------------
-- community_poll_results: per-option tallies + whether the caller picked it.
-- Definer rights let it count ballots the caller cannot read directly.
-- ---------------------------------------------------------------------------
create or replace view public.community_poll_results as
select
  o.poll_id,
  o.id       as option_id,
  o.label,
  o.position,
  (select count(*) from public.community_poll_votes v where v.option_id = o.id) as votes,
  exists (
    select 1 from public.community_poll_votes v
    where v.option_id = o.id and v.user_id = auth.uid()
  ) as voted_by_me
from public.community_poll_options o
where exists (
  select 1
  from public.community_polls p
  join public.community_members m on m.community_id = p.community_id
  where p.id = o.poll_id
    and m.user_id = auth.uid()
);

grant select on public.community_poll_results to authenticated;

-- ---------------------------------------------------------------------------
-- create_community_poll: poll + options + the chat message that carries it, in
-- one transaction. The message body is the question, so existing chat rendering
-- (previews, moderation) still has text to work with.
-- ---------------------------------------------------------------------------
create or replace function public.create_community_poll(
  p_community_id uuid,
  p_question     text,
  p_options      text[],
  p_anonymous    boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  v_poll  uuid;
  v_label text;
  i       int := 0;
  n       int := 0;
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = me
  ) then
    raise exception 'not a member';
  end if;

  if char_length(btrim(p_question)) < 1 then
    raise exception 'question is required';
  end if;

  -- Count the non-blank options up front: 2..6 distinct choices.
  select count(*) into n
    from unnest(p_options) o where btrim(o) <> '';
  if n < 2 or n > 6 then
    raise exception 'a poll needs 2-6 options';
  end if;

  insert into public.community_polls (community_id, creator_id, question)
    values (p_community_id, me, btrim(p_question))
    returning id into v_poll;

  foreach v_label in array p_options loop
    if btrim(v_label) <> '' then
      insert into public.community_poll_options (poll_id, label, position)
        values (v_poll, btrim(v_label), i);
      i := i + 1;
    end if;
  end loop;

  insert into public.community_chat_messages (community_id, sender_id, body, poll_id, is_anonymous)
    values (p_community_id, me, btrim(p_question), v_poll, coalesce(p_anonymous, false));

  return v_poll;
end;
$$;

revoke all on function public.create_community_poll(uuid, text, text[], boolean) from public;
grant execute on function public.create_community_poll(uuid, text, text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- vote_community_poll: one ballot per member per poll; re-voting moves it.
-- ---------------------------------------------------------------------------
create or replace function public.vote_community_poll(p_poll_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (
    select 1
    from public.community_polls p
    join public.community_members m on m.community_id = p.community_id
    where p.id = p_poll_id and m.user_id = me
  ) then
    raise exception 'not a member';
  end if;

  if not exists (
    select 1 from public.community_poll_options o
    where o.id = p_option_id and o.poll_id = p_poll_id
  ) then
    raise exception 'option does not belong to this poll';
  end if;

  insert into public.community_poll_votes (poll_id, option_id, user_id)
    values (p_poll_id, p_option_id, me)
    on conflict (poll_id, user_id)
    do update set option_id = excluded.option_id, created_at = now();
end;
$$;

revoke all on function public.vote_community_poll(uuid, uuid) from public;
grant execute on function public.vote_community_poll(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- send_community_message: replaces the direct INSERT so the anonymity flag is
-- set server-side. The plain INSERT policy stays for backwards compatibility
-- (it can only ever write is_anonymous = false, the column default).
-- ---------------------------------------------------------------------------
create or replace function public.send_community_message(
  p_community_id uuid,
  p_body         text,
  p_anonymous    boolean default false
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

  insert into public.community_chat_messages (community_id, sender_id, body, is_anonymous)
    values (p_community_id, me, v_body, coalesce(p_anonymous, false))
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.send_community_message(uuid, text, boolean) from public;
grant execute on function public.send_community_message(uuid, text, boolean) to authenticated;
