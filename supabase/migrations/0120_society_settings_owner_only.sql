-- 0120 — Society settings become an owner-tier action.
--
-- The Community/Chat split (this release) draws a hard line inside the society
-- Manage tab: a MODERATOR may work the queues (approve joins, moderate posts,
-- kick ordinary members) but may not touch the society's own identity —
-- category, description, logo, banner, links, recruiting.
--
-- upsert_society_profile() previously admitted ANY officer via
-- is_society_officer(), including a rank-30 moderator, so hiding the editor in
-- the UI alone would have left the action callable. It now requires the same
-- rank as officer appointments: president (90) and up, which the owner (100)
-- and platform admins clear.
--
-- Nothing else about the function changes — same whitelisted columns, same
-- is_society flip for first-time registration.

create or replace function public.upsert_society_profile(
  p_society          uuid,
  p_society_category text,
  p_description      text default null,
  p_recruitment_open boolean default null,
  p_contact_email    text default null,
  p_instagram_url    text default null,
  p_website_url      text default null,
  p_avatar_url       text default null,
  p_cover_url        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if not exists (select 1 from public.communities where id = p_society) then
    raise exception 'society not found';
  end if;
  -- ROLE_ADMIN_MIN_RANK in src/lib/societies/logic.ts — keep the two in step.
  if public.society_role_rank(p_society, uid) < 90 and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  if p_society_category is not null
     and p_society_category not in
       ('academic','sports','arts','tech','volunteer','departmental','cultural','religious','other') then
    raise exception 'invalid category';
  end if;

  update public.communities
     set is_society       = true,
         society_category = coalesce(p_society_category, society_category),
         description      = coalesce(p_description, description),
         recruitment_open = coalesce(p_recruitment_open, recruitment_open),
         contact_email    = coalesce(p_contact_email, contact_email),
         instagram_url    = coalesce(p_instagram_url, instagram_url),
         website_url      = coalesce(p_website_url, website_url),
         avatar_url       = coalesce(p_avatar_url, avatar_url),
         cover_url        = coalesce(p_cover_url, cover_url)
   where id = p_society;
end;
$$;

revoke all on function public.upsert_society_profile(uuid, text, text, boolean, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_society_profile(uuid, text, text, boolean, text, text, text, text, text)
  to authenticated;
