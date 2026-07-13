-- First-run guided tour: track per ACCOUNT (not per device) whether the user
-- has seen the Home-screen tour. Stamped by a server action when the tour is
-- completed or skipped; null = never seen, so the tour shows on next Home
-- visit. Self-writable via the existing "users can update their own profile"
-- policy; not privileged, so no protect_profile_columns entry needed.

alter table public.profiles
  add column if not exists tour_seen_at timestamptz;
