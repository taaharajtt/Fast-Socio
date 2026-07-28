-- community_chat_view: expose sender_gender (masked identically to
-- sender_avatar) so the client can render the gendered default avatar for a
-- non-anonymous sender. Recreated verbatim from mig 0045 with the addition.
--
-- CREATE OR REPLACE VIEW does NOT preserve reloptions (verified against prod:
-- reloptions read back null after the replace) — mig 0046's security_invoker
-- = on (closing a privilege-escalation bug) must be re-applied explicitly or
-- the view silently reverts to SECURITY DEFINER.
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
       then null else pr.avatar_url end as sender_avatar,
  case when m.is_anonymous and m.sender_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else pr.gender end as sender_gender
from public.community_chat_messages m
join public.profiles pr on pr.id = m.sender_id
where exists (
  select 1 from public.community_members cm
  where cm.community_id = m.community_id
    and cm.user_id = auth.uid()
);

alter view public.community_chat_view set (security_invoker = on);

grant select on public.community_chat_view to authenticated;
