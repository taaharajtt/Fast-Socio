-- Profile cover photo (Me → Edit). Mirrors communities.cover_url (mig 0035).
-- Client-supplied URLs are validated server-side (isAppStorageUrl) before write;
-- the column is a plain public storage URL, readable wherever the profile is.
alter table public.profiles
  add column if not exists cover_url text;
