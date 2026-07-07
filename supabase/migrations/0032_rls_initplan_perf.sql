-- =============================================================================
-- FAST SOCIO — RLS performance: initplan-wrap auth.uid() (audit C1)
--
-- Supabase's performance linter flagged 44 policies (auth_rls_initplan) where
-- auth.uid()/is_admin(auth.uid()) is re-evaluated PER ROW. Wrapping the call in
-- a scalar subquery — (select auth.uid()) — lets Postgres compute it ONCE as an
-- InitPlan and reuse it for every row, so feed/chat/list scans stop paying the
-- per-row cost and scale sub-linearly.
--
-- Semantics are unchanged: (select auth.uid()) === auth.uid() for a single row;
-- only the query plan changes. Uses ALTER POLICY so command/roles are untouched.
--
-- Also consolidates public.post_likes: the ALL policy overlapped the dedicated
-- SELECT policy (multiple_permissive_policies on SELECT). Split into INSERT +
-- DELETE so "users read likes" is the single SELECT policy (likes are toggled
-- via insert/delete only — no UPDATE path).
-- =============================================================================

-- aura_transactions
alter policy "users read own aura transactions" on public.aura_transactions
  using ((user_id = (select auth.uid())) or is_admin((select auth.uid())));

-- blocked_users
alter policy "users manage their own block list" on public.blocked_users
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

-- communities
alter policy "approved communities are visible" on public.communities
  using ((status = 'approved'::community_status) or (owner_id = (select auth.uid())) or is_admin((select auth.uid())));
alter policy "owners edit their community" on public.communities
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy "students submit pending communities" on public.communities
  with check ((owner_id = (select auth.uid())) and (status = 'pending'::community_status));

-- community_chat_messages
alter policy "members read community chat" on public.community_chat_messages
  using (exists ( select 1 from community_members m
    where ((m.community_id = community_chat_messages.community_id) and (m.user_id = (select auth.uid())))));
alter policy "members send community chat" on public.community_chat_messages
  with check ((sender_id = (select auth.uid())) and (exists ( select 1 from community_members m
    where ((m.community_id = community_chat_messages.community_id) and (m.user_id = (select auth.uid()))))));

-- community_members
alter policy "members leave communities" on public.community_members
  using ((user_id = (select auth.uid())) and (not (exists ( select 1 from communities c
    where ((c.id = community_members.community_id) and (c.owner_id = (select auth.uid())))))));
alter policy "students join approved communities" on public.community_members
  with check ((user_id = (select auth.uid())) and (role = 'member'::community_role) and (exists ( select 1 from communities c
    where ((c.id = community_members.community_id) and (c.status = 'approved'::community_status)))));

-- conversations
alter policy "participants read their conversations" on public.conversations
  using ((user_low = (select auth.uid())) or (user_high = (select auth.uid())));

-- event_attendees
alter policy "students rsvp to approved events" on public.event_attendees
  with check ((user_id = (select auth.uid())) and (exists ( select 1 from events e
    where ((e.id = event_attendees.event_id) and (e.status = 'approved'::event_status)))));
alter policy "students withdraw their rsvp" on public.event_attendees
  using (user_id = (select auth.uid()));

-- events
alter policy "approved events are visible" on public.events
  using ((status = 'approved'::event_status) or (host_id = (select auth.uid())) or is_admin((select auth.uid())));
alter policy "hosts edit their events" on public.events
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));
alter policy "students submit pending events" on public.events
  with check ((host_id = (select auth.uid())) and (status = 'pending'::event_status) and ((community_id is null) or (exists ( select 1 from community_members m
    where ((m.community_id = events.community_id) and (m.user_id = (select auth.uid())) and (m.role = any (array['owner'::community_role, 'moderator'::community_role])))))));

-- matches
alter policy "users read their own matches" on public.matches
  using ((user_low = (select auth.uid())) or (user_high = (select auth.uid())));

-- message_requests
alter policy "recipients update request status" on public.message_requests
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
alter policy "users see requests they sent or received" on public.message_requests
  using ((sender_id = (select auth.uid())) or (recipient_id = (select auth.uid())));
alter policy "users send their own requests" on public.message_requests
  with check ((sender_id = (select auth.uid())) and (not is_blocked(sender_id, recipient_id)));

-- messages
alter policy "participants read conversation messages" on public.messages
  using (exists ( select 1 from conversations c
    where ((c.id = messages.conversation_id) and ((c.user_low = (select auth.uid())) or (c.user_high = (select auth.uid()))))));
alter policy "participants send messages" on public.messages
  with check ((sender_id = (select auth.uid())) and (exists ( select 1 from conversations c
    where ((c.id = messages.conversation_id) and ((c.user_low = (select auth.uid())) or (c.user_high = (select auth.uid())))))) and (not (exists ( select 1
    from (conversations c join blocked_users b on ((((b.blocker_id = (select auth.uid())) and (b.blocked_id =
        case when (c.user_low = (select auth.uid())) then c.user_high else c.user_low end)) or ((b.blocked_id = (select auth.uid())) and (b.blocker_id =
        case when (c.user_low = (select auth.uid())) then c.user_high else c.user_low end)))))
    where (c.id = messages.conversation_id)))));

-- moderation_audit_log
alter policy "admins read moderation audit log" on public.moderation_audit_log
  using (is_admin((select auth.uid())));

-- notification_preferences
alter policy "users manage their own notification preferences" on public.notification_preferences
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- notifications
alter policy "users read their notifications" on public.notifications
  using (user_id = (select auth.uid()));
alter policy "users update their notifications" on public.notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- post_comments
alter policy "authors delete their own comments" on public.post_comments
  using (author_id = (select auth.uid()));
alter policy "users create their own comments" on public.post_comments
  with check ((author_id = (select auth.uid())) and (not is_blocked((select auth.uid()), ( select posts.author_id from posts where (posts.id = post_comments.post_id)))));

-- posts
alter policy "authors delete their own posts" on public.posts
  using (author_id = (select auth.uid()));
alter policy "authors update their own posts" on public.posts
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
alter policy "users create their own posts" on public.posts
  with check ((author_id = (select auth.uid())) and ((community_id is null) or (exists ( select 1
    from (community_members m join communities c on ((c.id = m.community_id)))
    where ((m.community_id = posts.community_id) and (m.user_id = (select auth.uid())) and (c.status = 'approved'::community_status))))));

-- profiles
alter policy "users can insert their own profile" on public.profiles
  with check (id = (select auth.uid()));
alter policy "users can update their own profile" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- push_subscriptions
alter policy "users manage their own push subscriptions" on public.push_subscriptions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- reports
alter policy "admins update report status" on public.reports
  using (is_admin((select auth.uid())))
  with check (is_admin((select auth.uid())));
alter policy "reporters read own reports, admins read all" on public.reports
  using ((reporter_id = (select auth.uid())) or is_admin((select auth.uid())));
alter policy "users can file reports" on public.reports
  with check (reporter_id = (select auth.uid()));

-- swipes
alter policy "users read their own swipes" on public.swipes
  using (swiper_id = (select auth.uid()));
alter policy "users record their own swipes" on public.swipes
  with check ((swiper_id = (select auth.uid())) and (not is_blocked(swiper_id, target_id)));

-- post_likes: split the ALL policy so SELECT is handled solely by "users read
-- likes" (removes the multiple_permissive_policies SELECT overlap), and apply
-- the initplan-wrapped expressions to the write paths.
drop policy if exists "users manage their own likes" on public.post_likes;
create policy "users insert their own likes" on public.post_likes
  for insert to authenticated
  with check ((user_id = (select auth.uid())) and (not is_blocked((select auth.uid()), ( select posts.author_id from posts where (posts.id = post_likes.post_id)))));
create policy "users delete their own likes" on public.post_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));
