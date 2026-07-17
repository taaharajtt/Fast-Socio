-- =============================================================================
-- FAST SOCIO — F6: close the unguarded maintenance RPC surface
--
-- Every admin_*/moderate_* RPC is guarded internally (_admin_guard /
-- _admin_guard_super). These five maintenance functions are not. All are
-- SECURITY DEFINER (so they run as the table owner and ignore RLS) and PUBLIC
-- holds EXECUTE, which means `anon` and `authenticated` can call them straight
-- through PostgREST's /rpc/ endpoint with no authorization check at all:
--
--   reconcile_counters()          full-table recount -> CPU/IO DoS on demand,
--                                 and denial-of-wallet on usage-based billing
--                                 (F22) since anyone can invoke it in a loop.
--   sweep_event_reminders()       fans out event reminder notifications ->
--                                 notification/push spam to real users.
--   snapshot_leaderboard()        writes a leaderboard snapshot row ->
--   snapshot_department_rivalry() writes a rivalry snapshot row ->
--                                 both pollute history with off-schedule rows
--                                 an attacker controls the timing of.
--   prune_rate_limit_events()     deletes rate-limit history -> wipes the
--                                 evidence that throttles and abuse detection
--                                 depend on.
--
-- These are meant to run on a schedule, not on request. Three already have
-- pg_cron jobs (event-reminder-sweep every 15m, and the two weekly snapshots);
-- cron executes as the job owner, not as anon/authenticated, so revoking client
-- EXECUTE does not disturb them. Verified 2026-07-17: no application code calls
-- any of these five.
--
-- `revoke ... from public` is the load-bearing line: EXECUTE was granted via
-- PUBLIC, so revoking only anon/authenticated would leave it reachable through
-- the PUBLIC grant. postgres/service_role retain access as owner.
--
-- NOT included here, contrary to the hardening plan's F6 list:
-- dispatch_push_notification() and set_community_post_status(). Both RETURN
-- TRIGGER and are bound to live triggers (notifications_dispatch_push,
-- posts_set_community_status). Postgres refuses to invoke a trigger function
-- directly -- verified against live on 2026-07-17, it raises
-- `0A000 trigger functions can only be called as triggers` -- and PostgREST
-- does not expose trigger-returning functions as RPCs. They are not a callable
-- surface, so revoking EXECUTE on them would be a no-op dressed up as a fix.
--
-- Idempotent: safe to re-run.
-- =============================================================================

revoke execute on function public.reconcile_counters()          from public, anon, authenticated;
revoke execute on function public.sweep_event_reminders()       from public, anon, authenticated;
revoke execute on function public.snapshot_leaderboard()        from public, anon, authenticated;
revoke execute on function public.snapshot_department_rivalry() from public, anon, authenticated;
revoke execute on function public.prune_rate_limit_events()     from public, anon, authenticated;
