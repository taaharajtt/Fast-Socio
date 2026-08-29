-- ---------------------------------------------------------------------------
-- 0167 — reply-to-message for direct messages
--
-- Adds `messages.reply_to_id`: the message this one is a reply to, WhatsApp /
-- Instagram style. Nullable, and `on delete set null` so unsending the quoted
-- message never takes the reply with it — the reply just stops showing a quote.
--
-- RLS is unchanged and does not need to change for reads: the existing SELECT
-- policy already scopes rows to conversation participants, and a quote is
-- rendered from a row the reader is separately allowed to read.
--
-- WRITES do need a guard. The INSERT policy checks the sender and the
-- conversation but says nothing about the columns' contents, so a crafted
-- insert could point `reply_to_id` at a message in ANOTHER conversation. That
-- would not leak the quoted body (the reader still cannot select that row), but
-- it would let a message dangle a reference across conversations. A BEFORE
-- INSERT/UPDATE trigger rejects it: a reply must target a message in the same
-- conversation. Written as a trigger rather than a CHECK because a CHECK
-- constraint may not query another table.
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists reply_to_id uuid
    references public.messages (id) on delete set null;

-- Supports "load the quoted rows for this page of messages" and the FK's own
-- cascade scan on delete.
create index if not exists messages_reply_to_idx
  on public.messages (reply_to_id)
  where reply_to_id is not null;

create or replace function public.enforce_reply_same_conversation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  target_conversation uuid;
begin
  if new.reply_to_id is null then
    return new;
  end if;

  if new.reply_to_id = new.id then
    raise exception 'A message cannot reply to itself';
  end if;

  select m.conversation_id into target_conversation
  from public.messages m
  where m.id = new.reply_to_id;

  if target_conversation is null then
    raise exception 'Replied-to message does not exist';
  end if;

  if target_conversation <> new.conversation_id then
    raise exception 'A reply must target a message in the same conversation';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_reply_same_conversation on public.messages;
create trigger messages_reply_same_conversation
  before insert or update of reply_to_id on public.messages
  for each row execute function public.enforce_reply_same_conversation();
