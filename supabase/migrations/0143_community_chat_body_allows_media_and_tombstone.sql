-- 0143 — follow-up to 0142. Caught by executing the delete, not by reading the DDL.
--
-- `community_chat_messages_body_check` is `char_length(body) between 1 and 2000`, which
-- predates both features 0142 adds and blocks each of them:
--
--   * fix-051's tombstone sets `body = ''` after clearing the content  -> violates it
--   * fix-052's image-only message (a photo with no caption) has `body = ''` -> violates it
--
-- 0142 applied cleanly and the RLS policy was correct — the UPDATE was rejected by this
-- constraint at write time with SQLSTATE 23514. Exactly the class of failure
-- `check_function_bodies` and a green migration hide, and the reason the runbook insists
-- these are verified by execution.
--
-- The length ceiling is unchanged. An empty body is now legal in precisely two cases:
-- the message carries an image, or it is a tombstone.

alter table public.community_chat_messages
  drop constraint if exists community_chat_messages_body_check;

alter table public.community_chat_messages
  add constraint community_chat_messages_body_check
  check (
    char_length(body) <= 2000
    and (
      char_length(body) >= 1        -- an ordinary text message
      or attachment_url is not null -- an image, caption optional
      or deleted_at is not null     -- a tombstone
    )
  );
