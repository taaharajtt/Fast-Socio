-- =============================================================================
-- FAST SOCIO — fix trg_check_achievements_actor (regression from mig 0073)
--
-- 0073 resolved the actor with a CASE over tg_table_name:
--
--   perform public.check_achievements(
--     case tg_table_name
--       when 'messages'      then new.sender_id
--       when 'post_comments' then new.author_id
--       ...
--
-- A CASE is a SINGLE SQL expression, so PL/pgSQL must plan EVERY branch against
-- the actual NEW rowtype — including `new.sender_id` when NEW is a post_comments
-- or community_members row, neither of which has that column. Result:
--
--   ERROR: record "new" has no field "sender_id"
--
-- on every comment INSERT and every community join. (messages was fine — it does
-- have sender_id, which is why DMs kept working and this went unnoticed.)
--
-- Fix: one statement per branch. PL/pgSQL plans a statement lazily, on first
-- execution of that branch, so a branch that never runs is never planned.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.trg_check_achievements_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  if tg_table_name = 'messages' then
    v_actor := new.sender_id;
  elsif tg_table_name = 'post_comments' then
    v_actor := new.author_id;
  elsif tg_table_name = 'community_members' then
    v_actor := new.user_id;
  end if;

  if v_actor is not null then
    perform public.check_achievements(v_actor);
  end if;

  return null;
end;
$$;
