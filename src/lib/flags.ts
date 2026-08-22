import "server-only";
import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Refactor Phase 1 — server-side feature-flag + maintenance helpers.
 *
 * Flags gate primary destinations in the app shell so a feature can be dark-
 * launched or rolled back without a deploy. Reads go through the `flag_enabled`
 * / `flags_enabled` / `get_maintenance_state` SQL functions which apply the
 * deterministic per-user rollout bucket. Results are request-memoized with
 * React `cache` so a layout that checks several flags hits the DB once.
 */

export type FeatureKey =
  | "discover"
  | "events"
  | "leaderboard"
  | "communities";

/** True when the given feature is enabled for the current user. */
export const isFeatureEnabled = cache(
  async (key: FeatureKey): Promise<boolean> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("flag_enabled", { p_key: key });
    // Fail open to the previously-shipped behaviour: if the check errors we keep
    // the feature visible rather than hiding shipped functionality on a blip.
    if (error) return true;
    return Boolean(data);
  }
);

/**
 * Batch variant — resolves several flags in ONE round trip (audit F10).
 *
 * This used to map over the keys and await `isFeatureEnabled` for each, which
 * ran concurrently but still cost one PostgREST request per key on every shell
 * render. `flags_enabled(text[])` (migration 0153) answers the whole set at
 * once with identical per-key semantics.
 *
 * FAIL-OPEN, and it matters more than usual here. Until 0153 is applied to a
 * given environment this RPC does not exist and the call errors — so the error
 * path must return every requested key as `true`, exactly as the per-key helper
 * does. That way deploying this code BEFORE running the migration shows all
 * dock tabs (the normal all-on state) rather than silently hiding Discover,
 * Events and Leaderboard from every student. Same reasoning for a transient
 * blip: a flag check that cannot complete must not remove shipped features.
 */
export async function resolveFlags(
  keys: FeatureKey[]
): Promise<Record<FeatureKey, boolean>> {
  const allOn = () =>
    Object.fromEntries(keys.map((k) => [k, true])) as Record<FeatureKey, boolean>;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("flags_enabled", { p_keys: keys });
  if (error || !data || typeof data !== "object") return allOn();

  const row = data as Record<string, unknown>;
  return Object.fromEntries(
    // Read through the requested keys rather than the response's own keys, so a
    // key the function did not answer for defaults to visible instead of
    // becoming `undefined` and reading as false at the call site.
    keys.map((k) => [k, k in row ? Boolean(row[k]) : true])
  ) as Record<FeatureKey, boolean>;
}

export type MaintenanceState = {
  enabled: boolean;
  message: string;
};

/**
 * A Supabase client with NO session — module-level, created once.
 *
 * `use cache` scopes may not read cookies or headers (see the Next 16 `use
 * cache` docs: "read them outside cached scopes and pass values as arguments"),
 * and the app's normal `createClient()` reads the cookie store on every call.
 * Maintenance state is global rather than per-user, so it does not need a
 * session at all: `get_maintenance_state()` is granted to `anon` as well as
 * `authenticated` (migration 0081) precisely because it returns only the
 * public-safe `{ enabled, message }` shape.
 */
let anonClient: ReturnType<typeof createAnonClient> | undefined;
function getAnonClient() {
  return (anonClient ??= createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  ));
}

/**
 * Current maintenance-mode state. Admins are exempted by the caller.
 *
 * CACHED ACROSS REQUESTS (audit F10). This is one of the few genuinely global
 * reads in the app — the same answer for every student — and it was being
 * fetched on every single shell render.
 *
 * ON THE TIMINGS. `revalidate: 30` is chosen for a specific reason: there is
 * currently NO admin UI for maintenance mode. It is flipped by editing
 * `app_settings` directly (via /admin/database or SQL), which means there is no
 * Server Action to call `updateTag` from, and therefore no way to invalidate
 * this on demand. A time-based bound is the only honest option, and it must be
 * short — this flag decides whether the entire student body can use the app, so
 * a stale window is measured against "how long is it acceptable to keep serving
 * a site you just took down". Thirty seconds still removes ~29 of every 30
 * calls. Do not raise it without first adding an invalidation path.
 *
 * `cacheTag` is set anyway so that the moment a real admin toggle exists, it
 * only has to call `updateTag(MAINTENANCE_TAG)` for this to become immediate.
 */
export const MAINTENANCE_TAG = "maintenance-state";

export async function getMaintenanceState(): Promise<MaintenanceState> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  cacheTag(MAINTENANCE_TAG);

  // Read via the get_maintenance_state() SECURITY DEFINER RPC. The base
  // app_settings table is no longer directly readable by authenticated users
  // (migration 0081) so its rollout/version config isn't enumerable; the RPC
  // returns only the public-safe { enabled, message } shape.
  const { data, error } = await getAnonClient().rpc("get_maintenance_state");
  // Fail open to "not in maintenance": a failed check must not lock everyone
  // out of a healthy app.
  if (error || !data) return { enabled: false, message: "" };
  const value = (data ?? {}) as Record<string, unknown>;
  return {
    enabled: Boolean(value.enabled),
    message: typeof value.message === "string" ? value.message : "",
  };
}
