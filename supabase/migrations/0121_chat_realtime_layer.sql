-- =============================================================================
-- FAST SOCIO — Chat realtime layer
--
-- Chat was not truly realtime: /chat (the inbox), the dock's chat badge, and
-- community-chat read state all depended on a full page reload to reflect a
-- new message, a read receipt, or a message request. `messages`,
-- `community_chat_messages` and `message_reactions` were already added to the
-- supabase_realtime publication (migs 0006, 0017, 0049), but `conversations`
-- and `message_requests` — which the inbox and dock badge also depend on —
-- were not, so client subscriptions on them silently received nothing.
--
-- 1. Idempotently ensures every table the chat UI subscribes to is in the
--    publication. `alter publication ... add table` errors if the table is
--    already a member, so this loops through pg_publication_tables instead of
--    a flat list of ADD statements (which would break on a second run).
-- 2. Adds community_chat_reads + mark_community_chat_read, the read-tracking
--    counterpart to mark_conversation_read (mig 0006) that community rooms
--    never had.
-- =============================================================================

set check_function_bodies = off;

do $$
declare
  t text;
begin
  foreach t in array array[
    'messages',
    'conversations',
    'message_requests',
    'community_chat_messages',
    'message_reactions',
    'notifications'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- community_chat_reads: one row per (community, user), stamped whenever the
-- member opens the room or a new message arrives while they're in it. Mirrors
-- messages.read_at's role for DMs, just tracked per-room instead of per-row
-- since a chat room has no single "recipient" to stamp.
-- ---------------------------------------------------------------------------
create table if not exists public.community_chat_reads (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

alter table public.community_chat_reads enable row level security;
revoke all on public.community_chat_reads from anon;

drop policy if exists "read own community chat read state" on public.community_chat_reads;
create policy "read own community chat read state"
  on public.community_chat_reads for select to authenticated
  using (user_id = auth.uid());

-- No client insert/update policy: writes go exclusively through the
-- SECURITY DEFINER RPC below, which also verifies membership.

create or replace function public.mark_community_chat_read(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id
      and m.user_id = auth.uid()
  ) then
    return;
  end if;

  insert into public.community_chat_reads (community_id, user_id, last_read_at)
  values (p_community_id, auth.uid(), now())
  on conflict (community_id, user_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.mark_community_chat_read(uuid) from public;
grant execute on function public.mark_community_chat_read(uuid) to authenticated;
