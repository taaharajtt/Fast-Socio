-- =============================================================================
-- FAST SOCIO — Refactor Phase 10: pinned messages.
--
-- Additive. Message edit/unsend + read receipts already exist (UAT-009 /
-- Phase 8). This adds pinning: either participant may pin a message in their
-- conversation so it stays surfaced at the top of the thread.
--
-- Follows the chat security model: `messages` has NO client UPDATE policy, so
-- the toggle goes through a SECURITY DEFINER RPC that verifies the caller is a
-- participant of the message's conversation (edit/delete_message pattern).
-- =============================================================================

set check_function_bodies = off;

alter table public.messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.profiles (id) on delete set null;

-- Fast lookup of a conversation's pinned messages.
create index if not exists messages_pinned_idx
  on public.messages (conversation_id, pinned_at desc)
  where pinned_at is not null;

-- Toggle a pin. Either participant may pin/unpin any non-deleted message in a
-- conversation they belong to. Returns the new pinned state.
create or replace function public.toggle_pin_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  v_conv   uuid;
  v_pinned timestamptz;
  v_is_member boolean;
begin
  select conversation_id, pinned_at into v_conv, v_pinned
    from public.messages
    where id = p_message_id and deleted_at is null;
  if v_conv is null then
    raise exception 'message not found';
  end if;

  select exists (
    select 1 from public.conversations c
    where c.id = v_conv and (c.user_low = me or c.user_high = me)
  ) into v_is_member;
  if not v_is_member then
    raise exception 'not a participant';
  end if;

  if v_pinned is null then
    update public.messages set pinned_at = now(), pinned_by = me
      where id = p_message_id;
    return true;
  else
    update public.messages set pinned_at = null, pinned_by = null
      where id = p_message_id;
    return false;
  end if;
end;
$$;

revoke all on function public.toggle_pin_message(uuid) from public, anon;
grant execute on function public.toggle_pin_message(uuid) to authenticated;
