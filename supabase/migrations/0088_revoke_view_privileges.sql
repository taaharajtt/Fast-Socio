-- =============================================================================
-- FAST SOCIO — F14 follow-up: same revoke, but for views
--
-- 0085 looped over pg_tables, which lists only ordinary tables. The five
-- reporting views in `public` -- feed_posts, community_chat_view,
-- community_poll_results, community_review_posts, post_poll_results -- were
-- therefore skipped and kept TRUNCATE/REFERENCES/TRIGGER for anon and
-- authenticated (10 grantee/object pairs, verified live 2026-07-17).
--
-- HONEST SEVERITY: this is hygiene, not a vulnerability. TRUNCATE against a
-- view is rejected by Postgres regardless of the grant, and REFERENCES/TRIGGER
-- are equally meaningless on a view. Nothing was exploitable here.
--
-- It is still worth clearing, for one reason: it makes the invariant
-- assertable. With these gone, "zero TRUNCATE/REFERENCES/TRIGGER grants to
-- client roles anywhere in public" becomes a flat, checkable statement that a
-- CI security gate (hardening plan Phase 5, item 24) can enforce -- instead of
-- one carrying five permanent exceptions that a reviewer has to remember are
-- benign. Exceptions are where real findings hide.
--
-- SELECT is deliberately untouched: these views are the read paths the app
-- depends on.
--
-- Idempotent: safe to re-run.
-- =============================================================================

do $$
declare
  v record;
begin
  for v in
    select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as fqn
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')   -- views and materialized views
  loop
    execute format(
      'revoke truncate, references, trigger on %s from anon, authenticated',
      v.fqn
    );
  end loop;
end $$;
