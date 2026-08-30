-- =============================================================================
-- FAST SOCIO — one round trip for the student shell's per-viewer reads
--
-- WHY
-- An authenticated /home render made ~9 PostgREST round trips to Frankfurt.
-- Four of them were independent reads that always happen together on the same
-- screen and all key off auth.uid():
--
--   chat_badge_count()            -- dock chat badge
--   community_badge_count()       -- dock community badge
--   notifications (announcements) -- the cold-open broadcast modal
--   notifications_live (count)    -- the Activity bell's unread dot
--
-- They were issued in parallel, so this is not about serialisation — it is four
-- separate network legs, four PostgREST parses and four planner invocations for
-- data that one query can return.
--
-- WHAT THIS IS NOT
-- It deliberately does NOT reimplement any badge rule. It CALLS the existing
-- functions. Migrations 0166/0169 (chat badge counts conversations, not
-- messages) and 0170 (community badge groups Community/Event/Broadcast and
-- never chat) exist because those semantics were subtly wrong before and were
-- fixed carefully. Copying their logic here would create a second definition to
-- keep in step — exactly the drift hazard 0169's header warns about. Composing
-- them means a future fix to either lands here for free.
--
-- SECURITY
-- SECURITY INVOKER (the default), deliberately:
--   * `notifications` and `notifications_live` are RLS-scoped to the viewer.
--     Under invoker that scoping applies automatically and cannot drift from
--     the policies. A DEFINER wrapper would have to re-implement "only my own
--     notifications", and getting that wrong leaks one student's activity feed
--     to another.
--   * The two badge functions it calls are themselves SECURITY DEFINER and
--     take no arguments — they scope by auth.uid() internally, which resolves
--     from the request JWT (a GUC), not from the executing role. Calling them
--     from an invoker wrapper is therefore identical to calling them directly.
--   * No parameters identify a user, so nobody can ask for another student's
--     badges. `p_activity_types` only narrows which notification types count.
--
-- VERIFY
--   select public.home_bootstrap(array['post_like','comment']);
--   -- each key must match the value returned by calling the source directly:
--   select public.chat_badge_count(), public.community_badge_count();
--
-- ROLLBACK
--   drop function if exists public.home_bootstrap(text[]);
--   The application falls back to the four original reads whenever this call
--   errors, so a rollback needs no coordinated deploy.
-- =============================================================================

create or replace function public.home_bootstrap(p_activity_types text[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'chat',      public.chat_badge_count(),
    'community', public.community_badge_count(),
    -- Unread broadcast announcements, newest first. Same shape and limit the
    -- student layout already selected.
    'announcements', coalesce(
      (select jsonb_agg(a order by a.created_at desc)
         from (
           select n.id, n.data, n.created_at
             from public.notifications n
            where n.user_id = (select auth.uid())
              and n.type = 'announcement'
              and n.read_at is null
            order by n.created_at desc
            limit 5
         ) a),
      '[]'::jsonb),
    -- The Activity bell's unread count. Read through notifications_live so a
    -- notification whose subject has been deleted is not counted (mig 0132) —
    -- the same view the /activity page filters on, so the dot can never point
    -- at rows that page will not show.
    'activity_unread', (
      select count(*)
        from public.notifications_live n
       where n.user_id = (select auth.uid())
         and n.read_at is null
         and n.type = any(p_activity_types))
  );
$$;

revoke all on function public.home_bootstrap(text[]) from public, anon;
grant execute on function public.home_bootstrap(text[]) to authenticated;
