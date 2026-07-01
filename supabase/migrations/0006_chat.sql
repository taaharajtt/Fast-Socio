-- =============================================================================
-- FAST SOCIO — Chat System (Phase 3)
-- 1:1 conversations between users who have a match OR an accepted message
-- request. blocked_users is enforced on conversation creation and on send.
-- Realtime is enabled on messages (RLS still applies to realtime delivery).
-- =============================================================================

set check_function_bodies = off;

create type public.attachment_type as enum ('image', 'voice');

-- ---------------------------------------------------------------------------
-- conversations: one row per ordered user pair.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  user_low         uuid not null references public.profiles (id) on delete cascade,
  user_high        uuid not null references public.profiles (id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  unique (user_low, user_high),
  check (user_low < user_high)
);

create index conversations_user_low_idx on public.conversations (user_low, last_message_at desc);
create index conversations_user_high_idx on public.conversations (user_high, last_message_at desc);

alter table public.conversations enable row level security;

create policy "participants read their conversations"
  on public.conversations for select to authenticated
  using (user_low = auth.uid() or user_high = auth.uid());
-- No client insert: conversations are created only via get_or_create_conversation.

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid not null references public.profiles (id) on delete cascade,
  body             text check (body is null or char_length(body) <= 4000),
  attachment_url   text,
  attachment_type  public.attachment_type,
  created_at       timestamptz not null default now(),
  read_at          timestamptz,
  check (body is not null or attachment_url is not null)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;

-- Participants may read all messages in their conversations.
create policy "participants read conversation messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_low = auth.uid() or c.user_high = auth.uid())
    )
  );

-- A participant may send, unless a block exists in either direction.
create policy "participants send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_low = auth.uid() or c.user_high = auth.uid())
    )
    and not exists (
      select 1
      from public.conversations c
      join public.blocked_users b
        on (b.blocker_id = auth.uid()
             and b.blocked_id = case when c.user_low = auth.uid() then c.user_high else c.user_low end)
        or (b.blocked_id = auth.uid()
             and b.blocker_id = case when c.user_low = auth.uid() then c.user_high else c.user_low end)
      where c.id = conversation_id
    )
  );

-- ---------------------------------------------------------------------------
-- last_message_at bump on new message.
-- ---------------------------------------------------------------------------
create or replace function public.bump_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return null;
end;
$$;

create trigger messages_bump_conversation
  after insert on public.messages
  for each row execute function public.bump_conversation();

-- ---------------------------------------------------------------------------
-- get_or_create_conversation: verifies eligibility (match OR accepted request),
-- no active block, then returns the conversation id (creating it if needed).
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_conversation(other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  conv_id uuid;
  eligible boolean;
  blocked boolean;
begin
  if me is null or other_id is null or me = other_id then
    raise exception 'invalid participants';
  end if;

  lo := least(me, other_id);
  hi := greatest(me, other_id);

  -- Must not be blocked in either direction.
  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = me and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = me)
  ) into blocked;
  if blocked then
    raise exception 'blocked';
  end if;

  -- Must have a match or an accepted message request between the two.
  select
    exists (select 1 from public.matches m where m.user_low = lo and m.user_high = hi)
    or exists (
      select 1 from public.message_requests r
      where r.status = 'accepted'
        and ((r.sender_id = me and r.recipient_id = other_id)
          or (r.sender_id = other_id and r.recipient_id = me))
    )
  into eligible;
  if not eligible then
    raise exception 'not connected';
  end if;

  insert into public.conversations (user_low, user_high)
    values (lo, hi)
    on conflict (user_low, user_high) do nothing;

  select id into conv_id from public.conversations
   where user_low = lo and user_high = hi;

  return conv_id;
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_conversation_read: stamp read_at on the other party's unread messages.
-- ---------------------------------------------------------------------------
create or replace function public.mark_conversation_read(conv_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = conv_id and (c.user_low = me or c.user_high = me)
  ) then
    raise exception 'not a participant';
  end if;

  update public.messages
     set read_at = now()
   where conversation_id = conv_id
     and sender_id <> me
     and read_at is null;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast message inserts. RLS still gates who receives each row.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
