# FAST SOCIO — Gamified Campus Map: Implementation Plan

**Status:** Proposed · **Date:** 2026-07-18 · **Owner:** —

A gamified, interactive map of the **FAST NUCES Islamabad** campus: tap markers
to see room-wise titles/descriptions (teacher offices, office hours, cafés,
labs, facilities), and earn Aura/XP/badges by checking in — feeding the systems
that already exist (Aura ledger, XP/levels, achievements, leaderboard).

---

## 0. Decisions locked

| Decision | Choice (v1) | Notes |
|---|---|---|
| Check-in verification | **Honor-system tap** | Simplest to ship. Anti-abuse via one-check-in-per-POI-per-day. GPS/QR is a later hardening (§9). |
| First deliverable | **This plan doc** | Then build in phases below. |
| Placement | **Standalone `/campus` route** | New page under `(student)`; can be embedded/moved later. Nav entry optional in Phase 1. |
| Rendering | **Static image + overlaid markers** | No Leaflet/MapLibre — the asset is a pre-rendered stylized export, not live tiles. Lightweight pan/zoom only. |

---

## 1. Why this is cheap on our stack

Gamification hooks into infrastructure we already own:

- **Aura ledger** — `aura_transactions(user_id, delta, reason, metadata, created_at)`
  is the single source of truth. A check-in is one positive-delta insert.
- **XP / levels** — derived from *positive* ledger deltas (mig 0055). A check-in
  delta therefore also grants XP and can level a user up, no extra code.
- **Achievements/badges** — `check_achievements(p_user)` is data-driven
  (metric + threshold) and already fires on ledger changes. New badges are
  mostly catalog rows.
- **Leaderboard** — reads the ledger. Check-in Aura shows up in weekly/all-time
  automatically.
- **Admin** — `/admin` two-tier module system already exists; the map authoring
  UI is one more module.

Net new surface: **two tables, one award RPC, one map view, one admin module,
a few badge rows.**

---

## 2. Data model (migrations 0097–0098)

Next free number is **0097** (last applied: 0096).

### 0097 — `campus_locations`

```sql
create type public.campus_category as enum (
  'teacher_office', 'cafe', 'lab', 'library', 'department',
  'facility', 'sports', 'landmark', 'other'
);

create table public.campus_locations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                 -- "Room A-201", "Cafe Raju"
  category     public.campus_category not null default 'other',
  description  text,                          -- free text shown in the sheet
  office_hours text,                          -- "Mon–Thu 11:00–13:00" (v1: plain text)
  owner_name   text,                          -- teacher / dept head, optional
  building     text,
  floor        integer,
  -- Position on the map IMAGE, normalized 0..1 (x from left, y from top) so
  -- markers stay pinned at any zoom/screen width. NOT geo lat/lng in v1.
  x            numeric(6,5) not null,
  y            numeric(6,5) not null,
  icon         text,                          -- optional lucide icon override
  is_published boolean not null default true,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.campus_locations enable row level security;

-- Everyone signed in can read published POIs; only admins write.
create policy campus_locations_read on public.campus_locations
  for select to authenticated
  using (is_published or public.is_admin((select auth.uid())));

create policy campus_locations_admin_write on public.campus_locations
  for all to authenticated
  using (public.is_admin((select auth.uid())))
  with check (public.is_admin((select auth.uid())));

create trigger campus_locations_touch
  before update on public.campus_locations
  for each row execute function public.set_updated_at();
```

> **initplan note (perf audit C1):** wrap `auth.uid()` in `(select …)` inside
> policies so Postgres evaluates it once per query, not per row. Confirm the
> exact admin predicate helper name in use (`is_admin(uuid)` vs an
> `admin_role`/`profiles.is_admin` check) and match it.

### 0098 — check-ins + award path + badges

```sql
-- 1) New ledger reason (added in its own statement; only USED post-commit).
alter type public.aura_reason add value if not exists 'campus_checkin';

-- 2) Check-in log — one row per (user, location, calendar day).
create table public.campus_checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.campus_locations(id) on delete cascade,
  day         date not null default (now() at time zone 'Asia/Karachi')::date,
  created_at  timestamptz not null default now(),
  unique (user_id, location_id, day)          -- dedupe: 1 Aura grant/POI/day
);

alter table public.campus_checkins enable row level security;

create policy campus_checkins_read_own on public.campus_checkins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 3) SECURITY DEFINER RPC: the ONLY way clients check in. Enforces existence,
--    the daily-unique rule, inserts the ledger delta (→ Aura + XP + badges),
--    and returns whether Aura was granted (idempotent per day).
create or replace function public.campus_check_in(p_location uuid)
returns table (granted boolean, delta integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_delta integer := 5;   -- tuning knob; move to a config table later
  v_new   boolean;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from campus_locations
                 where id = p_location and is_published) then
    raise exception 'unknown location';
  end if;

  insert into campus_checkins (user_id, location_id)
  values (v_user, p_location)
  on conflict (user_id, location_id, day) do nothing;
  get diagnostics v_new = row_count;      -- 1 if inserted, 0 if already today

  if v_new = 1 then
    insert into aura_transactions (user_id, delta, reason, metadata)
    values (v_user, v_delta, 'campus_checkin',
            jsonb_build_object('location_id', p_location));
    -- check_achievements already runs via the ledger trigger (mig 0055).
    return query select true, v_delta;
  else
    return query select false, 0;
  end if;
end;
$$;

revoke all on function public.campus_check_in(uuid) from public;
grant execute on function public.campus_check_in(uuid) to authenticated;
```

**Badges** (data-driven catalog rows). Add a `campus_checkins` count metric to
the achievements checker and seed rows, e.g.:
- **Explorer** — 10 distinct POIs checked in.
- **Caffeine Runner** — all `cafe` POIs.
- **Night Owl / Early Bird** — check in during posted office hours.

> Verify the achievement catalog's metric mechanism in mig 0055's
> `check_achievements`; if it only supports simple ledger-count metrics, add a
> `campus_distinct_checkins` metric or a small view it can read.

---

## 3. Map image asset

- Store the PNG in `public/campus/map.png` (served statically; rendered with
  `next/image`, `priority` off, explicit width/height, `sizes` set for mobile).
- The image is rotated/skewed with a transparent background — fine, because
  marker coordinates are **normalized to the image's bounding box**, not to
  geographic space. As long as the asset file is stable, pins stay put.
- Keep the source/export note in the repo. (Licensing of the underlying
  satellite imagery is a content decision on your side — flag if it's a Google
  export destined for production.)

---

## 4. Frontend components (`src/components/campus/`)

| Component | Responsibility |
|---|---|
| `campus-map.tsx` (client) | Pan/zoom container (CSS transform + pointer/touch handlers; a tiny custom hook, no heavy dep). Renders the image + absolutely-positioned markers from normalized `x,y`. |
| `map-marker.tsx` | Category-colored pin (lucide icon per category). Tap → open sheet. Checked-in-today state shown with a filled/ring style. |
| `location-sheet.tsx` | Bottom sheet: name, category chip, description, office hours, owner, and a **Check in (+5 Aura)** button (disabled/"Checked in today" once granted). Reuse the app's existing sheet pattern. |
| `campus-progress.tsx` | "X / N places discovered" meter + current campus badges (optional, Phase 3). |

Server page `src/app/(student)/campus/page.tsx`:
- Fetch published `campus_locations` + the viewer's **today** check-ins (to mark
  visited pins) in one `Promise.all`.
- Pass to `<CampusMap>`; check-in calls a server action → `campus_check_in` RPC,
  then optimistic UI update.

`loading.tsx` with a map skeleton to match the app's shimmer convention.

---

## 5. Admin authoring module (`/admin`)

New "Campus Map" module (respects the existing two-tier admin roles):
- Renders the same map; **click anywhere to drop a pin** → captures normalized
  `x,y` from the click position.
- Form: name, category, description, office hours, owner, building, floor, icon,
  published toggle.
- List/edit/delete existing POIs; drag a pin to reposition (updates `x,y`).
- This is how room-wise titles/descriptions get entered without hardcoding.

---

## 6. Gamification mechanics

**v1 (Phases 1–3):**
- **Check-in → +5 Aura** (per POI per day), which is also +5 XP and feeds the
  leaderboard automatically.
- **Discovery meter** — "% of campus discovered" on `/campus` and optionally the
  profile Stats tab.
- **Badges** — Explorer, Caffeine Runner, office-hours badges (§2).

**Later (Phase 4+):**
- **Weekly quests** — rotating tasks ("Visit 3 labs this week") in a
  `campus_quests` / `campus_quest_progress` pair; completion grants bonus Aura.
- **Streaks** — consecutive-day check-in multiplier.
- **Seasonal events** — themed POIs during fests.

---

## 7. Anti-abuse (honor-system v1)

- **Server-authoritative**: clients never insert into the ledger or checkins
  directly; only `campus_check_in` (SECURITY DEFINER) does, after its checks.
- **Daily unique** `(user_id, location_id, day)` caps Aura farming at
  1 grant/POI/day. `day` computed in `Asia/Karachi` so "day" matches campus
  local time.
- **Rate limiting** at the server action (e.g. N check-ins/min) to blunt
  scripted spam even within the daily cap.
- Accepted v1 gap: a user can check in without physically being there. §9 closes
  this when needed — schema is forward-compatible (add `lat/lng` + `method`).

---

## 8. Phasing

| Phase | Scope | Ships |
|---|---|---|
| **1 — Foundations** | mig 0097 + 0098; `/campus` page; map view with pan/zoom; markers from DB; location sheet (read-only); seed ~10 POIs. | Browse the map, read room info. |
| **2 — Check-ins** | `campus_check_in` RPC + server action; check-in button; visited-today state; +5 Aura wired to ledger. | Earn Aura by checking in. |
| **3 — Badges + progress** | Campus badge catalog rows + metric; discovery meter; profile surfacing. | Badges + "% discovered". |
| **4 — Admin authoring** | `/admin` Campus Map module: click-to-place, edit, delete, reposition. | Non-devs enter rooms. |
| **5 — Quests/streaks** | `campus_quests`, weekly tasks, streak multiplier. | Recurring engagement. |
| **6 — Verification (opt.)** | GPS geofence and/or QR check-in (§9). | Cheat-resistant. |

(Phase 4 can move earlier if you'd rather seed content via UI than SQL.)

---

## 9. Future: real check-in verification

Schema is designed so this is additive, not a rewrite:
- Add `lat numeric, lng numeric` to `campus_locations` (real coordinates), and
  `method text` + `lat/lng` to `campus_checkins`.
- **GPS geofence**: `campus_check_in` gains `p_lat,p_lng`; reject if haversine
  distance to the POI > ~30–50 m. Needs location permission (PWA `geolocation`).
- **QR posters**: each POI gets a signed token in its QR; scanning posts the
  token; RPC validates it. Most cheat-proof; needs physical rollout.

---

## 10. Open items to confirm before Phase 1

1. **Admin predicate** — exact helper/column used in RLS (`is_admin(uuid)` vs
   `profiles.admin_role`/`is_admin`). Match existing policies.
2. **Achievement metric** — does `check_achievements` support a distinct-POI
   count metric, or do we add one?
3. **Nav entry** — add `/campus` to the bottom nav in Phase 1, or link it from
   Home/Events until it's proven?
4. **Aura value** — is +5/check-in the right economy vs existing rewards
   (match, event_attend, post_created)? Pull current weights before finalizing.
5. **Map asset licensing** — confirm the PNG is OK to ship in production.
