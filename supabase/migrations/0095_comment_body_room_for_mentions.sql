-- =============================================================================
-- FAST SOCIO — Give post_comments.body room for @-mention markup
--
-- Comment @-mentions are stored as self-contained tokens, e.g.
--   @[i240733](3f6b…-uuid)
-- so a comment renders its mention links with no lookups. The token is ~46
-- chars while the visible handle ("@i240733") is ~8, so the STORED body is
-- longer than what the user typed. The app still caps the *visible* text at
-- 1000 chars (mentionsToPlainText length check in addComment); this only widens
-- the DB backstop so token expansion can't trip the CHECK on an otherwise-valid
-- comment. 4000 matches the messages.body ceiling and leaves generous room.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.post_comments
  drop constraint if exists post_comments_body_check;

alter table public.post_comments
  add constraint post_comments_body_check
  check (char_length(body) between 1 and 4000);
