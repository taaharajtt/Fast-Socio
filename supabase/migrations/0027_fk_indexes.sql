-- =============================================================================
-- FAST SOCIO — Cover foreign keys with indexes (audit fix P4-02)
--
-- Seven FKs added after the foundation migration had no index on the
-- referencing column, so cascade deletes (notably account deletion, which
-- cascades through likes/comments/messages/notifications) and reverse lookups
-- seq-scan those tables. Tables are small today so a plain CREATE INDEX is
-- instant; at large scale these would be built CONCURRENTLY (outside a txn).
-- =============================================================================

create index if not exists messages_sender_id_idx
  on public.messages (sender_id);
create index if not exists messages_shared_post_id_idx
  on public.messages (shared_post_id);
create index if not exists post_likes_user_id_idx
  on public.post_likes (user_id);
create index if not exists post_comments_author_id_idx
  on public.post_comments (author_id);
create index if not exists notifications_actor_id_idx
  on public.notifications (actor_id);
create index if not exists community_chat_messages_sender_id_idx
  on public.community_chat_messages (sender_id);
create index if not exists leaderboard_snapshots_user_id_idx
  on public.leaderboard_snapshots (user_id);
