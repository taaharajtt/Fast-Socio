import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";

/**
 * The signed-in user's own profile row, read ONCE per request (audit F11).
 *
 * WHY THIS EXISTS
 * Rendering /home used to read this one row four separate times:
 *
 *   proxy.ts (lib/supabase/middleware.ts)  is_admin, is_banned, onboarding_completed
 *   (student)/layout.tsx  StudentShell     avatar_url, gender, events_seen_at, admin_role
 *   home/page.tsx  loadComposerPlaceholder full_name
 *   home/page.tsx  TourGate                tour_seen_at
 *
 * Each was added by a different feature and each is individually correct.
 * React's `cache()` could not help, because they are four distinct query
 * builders — and the first one runs in the proxy, a different runtime entirely.
 *
 * This collapses the three that share a request into one query. The proxy's
 * read is a separate problem with a separate fix (moving those flags into the
 * JWT); it is deliberately NOT merged here, because the proxy runs before this
 * module is ever loaded and cannot share a memoization cache with it.
 *
 * WHY IT RETURNS EVERYTHING AT ONCE
 * Selecting the union of the columns costs the same as selecting any one of
 * them: the row is fetched by primary key either way, and these are all small
 * scalar columns on a row we were already paying to read. Naming them (rather
 * than `select("*")`) keeps the wire payload and the RSC payload to what
 * renderers actually touch — the same discipline FEED_COLUMNS applies to the
 * feed — and makes it obvious what breaks if the table changes shape.
 *
 * HOW TO USE IT WITHOUT COLLAPSING A SUSPENSE BOUNDARY
 * This is an async function, so `await`ing it makes the caller async. That is
 * fine inside a component that is ALREADY behind its own <Suspense>, which is
 * how every current caller uses it. Do NOT await it in a layout or page
 * component that is meant to stay synchronous: under Cache Components that
 * collapses the prerendered static shell for the whole route, which is exactly
 * what the comments in (student)/layout.tsx and home/page.tsx are protecting.
 * Pass the promise down instead, as home/page.tsx already does.
 */
export type ViewerProfile = {
  avatar_url: string | null;
  gender: string | null;
  full_name: string | null;
  events_seen_at: string | null;
  tour_seen_at: string | null;
  admin_role: string | null;
};

/** The exact columns the shared viewer read fetches, as a PostgREST select list. */
// prettier-ignore
const VIEWER_COLUMNS = "avatar_url, gender, full_name, events_seen_at, tour_seen_at, admin_role" as const;

/**
 * The viewer's profile row, or null when there is no session (or the row is
 * somehow missing — a brand-new account mid-signup, say). Request-memoized, so
 * a layout and two page components sharing one request cost one query.
 */
export const getViewerProfile = cache(async (): Promise<ViewerProfile | null> => {
  const userId = await getAuthUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(VIEWER_COLUMNS)
    .eq("id", userId)
    .single();
  return (data as ViewerProfile | null) ?? null;
});
