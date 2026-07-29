-- 0138 — fix-025: pin a location on the campus map from any form with a location field.
--
-- Round 1 did not implement this at all. Today location is free text in two places:
--   events.location            (text, e.g. "C-Block Auditorium")
--   smart_match_posts.place    (text, Discover's sports intent)
-- and NO table anywhere in the schema has coordinate columns. A viewer's only route
-- back to the map was `resolvePlace()` doing best-effort string matching client-side,
-- on the Discover sports card only.
--
-- This adds a real, persisted pin next to the existing label, rather than replacing it:
-- the label columns keep working exactly as before (so every existing read path, RPC
-- payload mapping and admin view is untouched), and the pin travels alongside.
--
-- Coordinates are PERCENTAGES of public/map.png (x,y in 0..100), matching
-- src/lib/map/places.ts — NOT lat/lng. They are stored explicitly rather than derived
-- from place_id at read time so a post keeps the pin it was created with even if the
-- places dataset is later re-numbered.

alter table public.events
  add column if not exists place_id text,
  add column if not exists place_x  numeric(5,2),
  add column if not exists place_y  numeric(5,2);

alter table public.smart_match_posts
  add column if not exists place_id text,
  add column if not exists place_x  numeric(5,2),
  add column if not exists place_y  numeric(5,2);

-- Percentages only; a bad client can't write a pin off the map.
alter table public.events
  drop constraint if exists events_place_coords_range,
  add  constraint events_place_coords_range check (
    (place_x is null or (place_x >= 0 and place_x <= 100)) and
    (place_y is null or (place_y >= 0 and place_y <= 100))
  );

alter table public.smart_match_posts
  drop constraint if exists smart_match_posts_place_coords_range,
  add  constraint smart_match_posts_place_coords_range check (
    (place_x is null or (place_x >= 0 and place_x <= 100)) and
    (place_y is null or (place_y >= 0 and place_y <= 100))
  );

-- Discover posts are written through create_smart_match_post / update_smart_match_post,
-- which map a jsonb payload key-by-key to columns. Rather than reproduce both of those
-- long SECURITY DEFINER functions verbatim just to add three keys — a large blast radius
-- for a small change — the client sets the pin through this narrow, author-checked call
-- immediately after create/update.
create or replace function public.set_smart_match_post_place(
  p_id       uuid,
  p_place_id text,
  p_x        numeric,
  p_y        numeric
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid      uuid := auth.uid();
  v_author uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select author_id into v_author
    from public.smart_match_posts where id = p_id;
  if v_author is null then
    raise exception 'post not found';
  end if;
  if v_author <> uid then
    raise exception 'not authorized';
  end if;

  -- Clearing the pin is legitimate (the author removed it), so nulls pass through.
  if p_place_id is not null and (p_x is null or p_y is null) then
    raise exception 'a pinned place requires coordinates';
  end if;
  if p_x is not null and (p_x < 0 or p_x > 100 or p_y < 0 or p_y > 100) then
    raise exception 'coordinates must be percentages of the map (0-100)';
  end if;

  update public.smart_match_posts
     set place_id = nullif(btrim(p_place_id), ''),
         place_x  = p_x,
         place_y  = p_y
   where id = p_id;
end;
$function$;

revoke all on function public.set_smart_match_post_place(uuid, text, numeric, numeric) from public;
grant execute on function public.set_smart_match_post_place(uuid, text, numeric, numeric) to authenticated;
