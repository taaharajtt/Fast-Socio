-- =============================================================================
-- FAST SOCIO — Tighten EXECUTE on the 0065 comment functions.
--
-- This project's default privileges grant anon/authenticated EXECUTE on new
-- functions, which the linter flags (0028/0029 anon/authenticated
-- security_definer_function_executable). The three trigger functions are only
-- ever invoked by the trigger machinery (as the table owner), so no role needs
-- direct EXECUTE — revoke from PUBLIC entirely. comment_author is evaluated
-- inside the comment_likes RLS policy as the querying role, so authenticated
-- must keep EXECUTE; only anon is revoked.
-- =============================================================================

revoke execute on function public.enforce_comment_depth() from public;
revoke execute on function public.sync_reply_count() from public;
revoke execute on function public.sync_comment_like_count() from public;

revoke execute on function public.comment_author(uuid) from anon;
