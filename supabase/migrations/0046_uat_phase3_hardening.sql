-- =============================================================================
-- FAST SOCIO — hardening pass over the 0045 objects.
--
-- Two findings from `supabase advisors` after 0045 landed:
--
--  1. `revoke all ... from public` does NOT remove `anon`'s EXECUTE bit: this
--     project has a default privilege granting EXECUTE on new functions to
--     anon/authenticated. Every 0045 RPC gates on auth.uid() and therefore
--     no-ops for an anonymous caller, but leaving them callable from an
--     unauthenticated /rest/v1/rpc/... endpoint is needless surface.
--
--  2. `community_chat_view` was created SECURITY DEFINER (the default), which
--     bypasses RLS on its base tables. It doesn't need to: members may already
--     read community_chat_messages directly, and profiles is world-readable.
--     Switching it to security_invoker means the view's masking is defence in
--     depth on top of RLS rather than a replacement for it.
--
-- `community_poll_results` intentionally STAYS security-definer: its whole job
-- is to count ballots that RLS forbids the caller from reading (a member may
-- only select their own row of community_poll_votes). It carries its own
-- membership predicate, exactly like the pre-existing feed_posts view.
-- =============================================================================

revoke execute on function public.touch_last_seen() from anon;
revoke execute on function public.touch_events_seen() from anon;
revoke execute on function public.edit_message(uuid, text) from anon;
revoke execute on function public.delete_message(uuid) from anon;
revoke execute on function public.create_community_poll(uuid, text, text[], boolean) from anon;
revoke execute on function public.vote_community_poll(uuid, uuid) from anon;
revoke execute on function public.send_community_message(uuid, text, boolean) from anon;

alter view public.community_chat_view set (security_invoker = on);
