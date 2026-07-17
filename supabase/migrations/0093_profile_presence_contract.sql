-- =============================================================================
-- FAST SOCIO — F16 part 2: make `show_online` real (contract)
--
-- Drops profiles.last_seen_at. Until this runs, 0092 has changed nothing an
-- attacker cares about: the column is still there and
-- `GET /rest/v1/profiles?select=id,last_seen_at` still returns live presence
-- for every user regardless of their show_online setting.
--
-- ORDER MATTERS. Only run once the deploy that reads profile_presence is live.
-- Old instances would 42703 on the profile page, both chat screens, and the
-- chat list.
--
-- NOT REVERSIBLE. 0092 backfilled every row and touch_last_seen() has been
-- writing the new table since; presence also self-heals within 45s of any
-- active tab (BEAT_MS in components/presence/heartbeat.tsx), so worst case here
-- is a stale dot for under a minute, not lost user data. Still: no PITR, no
-- backups (F20).
-- =============================================================================

-- Catch anything the old definer wrote to profiles between 0092 and the deploy.
-- Only fills where the new table is behind, so it can never rewind presence
-- that touch_last_seen has already recorded in profile_presence.
update public.profile_presence pp
set last_seen_at = p.last_seen_at
from public.profiles p
where p.id = pp.id
  and p.last_seen_at is not null
  and (pp.last_seen_at is null or p.last_seen_at > pp.last_seen_at);

alter table public.profiles drop column if exists last_seen_at;

-- What this does and does not settle, so the next reader is not misled:
--
--   show_online  — now enforced by the database for every caller. Done.
--   show_aura / show_department / show_semester — still bypassable via the API.
--     They cannot be fixed the same way: department and semester are written by
--     the client through PostgREST, and PostgREST's `do update set col =
--     excluded.col` means a column must be readable to be writable (see 0089).
--     Hiding them requires moving onboarding's writes behind SECURITY DEFINER
--     RPCs first. Worth noting they are cosmetic anyway —
--     get_discover_candidates returns department to the swipe deck regardless
--     of show_department, so the toggle never hid it in the first place.
--   searchable / profile_visibility — enforced NOWHERE, in the app or the
--     database (verified 2026-07-17: no function and no query references
--     either, beyond the settings screen that renders them). They are dead
--     switches that tell users a lie. Either implement or remove from the UI.
--     Not this migration's job, but somebody's.
