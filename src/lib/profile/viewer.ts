import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";

/**
 * The signed-in student's own profile row, fetched ONCE per request.
 *
 * Perf audit 2.5. A single `/home` render was reading the viewer's own
 * `profiles` row from three separate server components, each selecting a
 * different column set and each paying its own round trip to Frankfurt:
 *
 *   - (student)/layout.tsx  -> avatar_url, gender, admin_role
 *   - home/page.tsx         -> full_name        (composer placeholder)
 *   - home/page.tsx         -> tour_seen_at     (which tour is due)
 *
 * `getAuthUserId` was already memoised with React `cache`, but the profile row
 * itself was not, so the fan-out was invisible at each individual call site.
 * Selecting the union of those columns costs nothing extra — it is one indexed
 * primary-key lookup either way — and collapses three round trips into one.
 *
 * SCOPE: this is the VIEWER's own row only, and it is what makes the shared
 * select safe. Do not add a userId parameter and do not reuse this for someone
 * else's profile: `cache` is keyed on the arguments, so a parameterised version
 * would silently become a per-id cache and the "one row, one request" reasoning
 * above would stop holding. Other people's profiles have their own loaders and
 * their own column sets, deliberately narrower because RLS and the masking
 * views decide what is visible.
 *
 * Returns null for a signed-out request rather than throwing: callers already
 * run behind the middleware auth gate, and the ones that stream inside a
 * Suspense boundary should degrade to their fallback rather than blow up a
 * boundary if a session expires mid-render.
 */
export type ViewerProfile = {
  avatar_url: string | null;
  gender: string | null;
  admin_role: string | null;
  full_name: string | null;
  tour_seen_at: string | null;
};

export const getViewerProfile = cache(async (): Promise<ViewerProfile | null> => {
  const userId = await getAuthUserId();
  if (!userId) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("avatar_url, gender, admin_role, full_name, tour_seen_at")
    .eq("id", userId)
    .single();

  return (data as ViewerProfile | null) ?? null;
});
