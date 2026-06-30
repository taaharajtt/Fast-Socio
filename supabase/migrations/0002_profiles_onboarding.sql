-- =============================================================================
-- FAST SOCIO — Profile onboarding (Phase 1, Sprint 3)
-- Adds the columns the profile-setup wizard writes, plus an avatars storage
-- bucket with owner-scoped RLS and public read.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles: interests + onboarding completion flag
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists interests text[] not null default '{}',
  add column if not exists gender text check (gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  add column if not exists onboarding_completed boolean not null default false;

-- ---------------------------------------------------------------------------
-- Storage: avatars bucket (public read; writes scoped to the owner's folder)
-- Path convention: avatars/<user_id>/<filename>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone may read avatars (profiles are visible to all authenticated users and
-- avatar_url must resolve from an <img> tag).
drop policy if exists "avatar images are publicly readable" on storage.objects;
create policy "avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- A user may write only inside their own folder (first path segment = their uid).
drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update their own avatar" on storage.objects;
create policy "users update their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete their own avatar" on storage.objects;
create policy "users delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
