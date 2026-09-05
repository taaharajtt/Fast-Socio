-- =============================================================================
-- 0184 — fix: community_updates could not be read by a student at all.
--
-- WHAT WAS BROKEN
-- 0183's view is `security_invoker = true`, which is right: it is what makes RLS
-- on `notifications` the thing that scopes rows to the reader. But invoker
-- applies to EVERY table the view touches, not just the one being scoped — and
-- one of its liveness probes reads `public.posts`:
--
--     exists (select 1 from public.posts p
--              where p.id = n.subject_post_id and p.moderation_status = 'pending')
--
-- `posts` has RLS enabled with no SELECT policy and no grant to `authenticated`
-- — deliberately, and long-standing (it is the same lock-down that made
-- fix-036's direct post count return 0 for everyone and forced
-- `get_profile_post_count` to be a definer RPC). So the predicate raised
--
--     42501: permission denied for table posts
--
-- for the student role, on EVERY row, whatever its type. The whole view failed,
-- which took `community_badge_count()` (also invoker since 0183) with it. The
-- app degrades quietly rather than crashing — `fetchCommunityBadge` swallows the
-- error and renders no badge, and `home_bootstrap` falls back — so the symptom
-- would have been "the Community badge and the Updates list are permanently
-- empty in production", with nothing in the UI to say why.
--
-- Caught by supabase/tests/community_updates.sql before the app was deployed;
-- the migration itself applied cleanly because `postgres` can read everything.
-- That is the lesson worth keeping: a definer-privileged migration proves
-- nothing about what the student role can execute, which is why that script
-- switches to `authenticated` for every read.
--
-- THE FIX
-- Move the liveness predicates — and ONLY those — into one SECURITY DEFINER
-- helper. The split of responsibilities is the point:
--
--     which rows are mine      RLS on notifications, via the invoker view.
--                              Unchanged, and still not re-implemented anywhere.
--     is this row still live   the helper, which needs to see a moderation
--                              queue the reader cannot select directly.
--
-- WHY THIS LEAKS NOTHING. The helper takes no user parameter: it reads
-- auth.uid() itself, so it cannot be asked "can SOMEONE ELSE manage this
-- community" or "does SOMEONE ELSE follow it". With that fixed, the remaining
-- parameters are attacker-controllable but answer nothing new:
--
--   * the two manager branches are gated on can_manage_community(..., auth.uid()),
--     so a non-manager gets `false` for any community they name;
--   * the follower branch answers "do I follow this space", which the caller
--     can already read directly (community_followers is selectable);
--   * it returns a boolean, never a row, an id or a name.
--
-- It is STABLE, `search_path` is pinned to public, EXECUTE is revoked from
-- public/anon and granted to `authenticated` only.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.community_update_is_live(
  p_type      text,
  p_actor     uuid,
  p_community uuid,
  p_post      uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    -- Manager work: still unresolved, AND still the caller's to act on. Losing
    -- the officer role removes it without anything having to write a row.
    when 'community_join_request' then
      exists (
        select 1 from public.community_join_requests r
         where r.community_id = p_community
           and r.user_id = p_actor
           and r.status = 'pending'
      )
      and public.can_manage_community(p_community, (select auth.uid()))
    when 'community_post_review' then
      exists (
        select 1 from public.posts p
         where p.id = p_post
           and p.moderation_status = 'pending'
      )
      and public.can_manage_community(p_community, (select auth.uid()))
    -- A broadcast is only yours while you still follow or belong to the space.
    when 'society_announcement' then
      exists (
        select 1 from public.community_followers f
         where f.community_id = p_community and f.user_id = (select auth.uid())
      ) or exists (
        select 1 from public.community_members m
         where m.community_id = p_community and m.user_id = (select auth.uid())
      )
    -- Everything else is a decision or a fact about the reader: it is live for
    -- as long as its subject exists, which notifications_live already enforces.
    else true
  end;
$$;

comment on function public.community_update_is_live(text, uuid, uuid, uuid) is
  'Is this Community update still real and still actionable for auth.uid()? Definer because it must see a moderation queue the reader cannot select; takes no user parameter and returns only a boolean. See migration 0184.';

revoke all on function public.community_update_is_live(text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.community_update_is_live(text, uuid, uuid, uuid)
  to authenticated;

-- Re-declared with the predicates delegated. The type allow-list, the
-- notifications_live base and security_invoker are all unchanged from 0183.
create or replace view public.community_updates
with (security_invoker = true)
as
select n.*
  from public.notifications_live n
 where n.type = any (public.community_update_types())
   and public.community_update_is_live(
         n.type, n.actor_id, n.subject_community_id, n.subject_post_id
       );

comment on view public.community_updates is
  'The canonical Community update set for auth.uid(): community-domain notifications that are still live and still actionable. The /communities/updates list and the dock badge both read THIS. security_invoker, so RLS on notifications scopes the rows; liveness is delegated to community_update_is_live(). See migrations 0183 and 0184.';

revoke all on public.community_updates from anon;
grant select on public.community_updates to authenticated;

-- =============================================================================
-- VERIFY (as the student role, which is the whole point):
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<a real uuid>"}', true);
--   select count(*) from public.community_updates;      -- must not raise
--   select public.community_badge_count();
--
-- ROLLBACK
--   Re-run 0183's view definition (it inlines the predicates) — but note that
--   restores the 42501, so only do that alongside reverting 0183 entirely.
-- =============================================================================
