-- =============================================================================
-- FAST SOCIO — message reactions (UAT-005)
--
-- One reaction per user per message (Instagram-style: picking a new emoji
-- replaces your old one; tapping the same emoji again clears it). Reads are
-- open to conversation participants; all writes go through a SECURITY DEFINER
-- RPC that checks participation, so there is no client INSERT/UPDATE/DELETE
-- path to forge a reaction on someone else's conversation.
--
-- Forward and Unsend need no schema: forward inserts an ordinary message,
-- unsend reuses delete_message() from 0045.
-- =============================================================================

set check_function_bodies = off;

create table if not exists public.message_reactions (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  emoji       text not null check (char_length(emoji) between 1 and 8),
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- A participant of the message's conversation may read its reactions.
create policy "participants read message reactions"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_reactions.message_id
        and (c.user_low = (select auth.uid()) or c.user_high = (select auth.uid()))
    )
  );
-- No client write policies: reactions are written only via toggle_message_reaction.

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
  me       uuid := auth.uid();
  v_emoji  text := btrim(p_emoji);
  existing text;
begin
  if char_length(v_emoji) < 1 or char_length(v_emoji) > 8 then
    raise exception 'invalid emoji';
  end if;

  -- Caller must be a participant of the message's conversation.
  if not exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = p_message_id
      and (c.user_low = me or c.user_high = me)
  ) then
    raise exception 'not a participant';
  end if;

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
  end if;
end;
$$;

revoke all on function public.toggle_message_reaction(uuid, text) from public;
revoke execute on function public.toggle_message_reaction(uuid, text) from anon;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;

-- Realtime so both sides see reactions live. RLS still gates delivery.
alter publication supabase_realtime add table public.message_reactions;
