-- =============================================================================
-- FAST SOCIO — Share a post to a matched friend (CR-010 / UAT-010)
-- A shared post is delivered as a normal chat message that additionally carries
-- shared_post_id. The message body holds a short caption so the existing
-- "body is not null or attachment_url is not null" check still passes — no
-- constraint change needed. The chat UI renders such messages as a preview card
-- linking to the original post.
-- =============================================================================

alter table public.messages
  add column if not exists shared_post_id uuid references public.posts (id) on delete set null;
