import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAnonClient } from "@/lib/supabase/anon";
import {
  conservativeFlags,
  mapFlagsResponse,
  type FeatureKey,
} from "@/lib/flags-map";

// Re-exported so every existing `import { FeatureKey } from "@/lib/flags"` keeps
// working; the type itself now lives in flags-map.ts, which carries no
// "server-only" import and is therefore unit-testable.
export type { FeatureKey };

/**
 * Refactor Phase 1 — server-side feature-flag + maintenance helpers.
 *
 * Flags gate primary destinations in the app shell so a feature can be dark-
 * launched or rolled back without a deploy. Reads go through the
 * `flags_enabled` / `is_maintenance_mode` SQL functions (migrations 0171 and
 * 0050) which apply the deterministic per-user rollout bucket.
 *
 * The per-key `isFeatureEnabled` wrapper was removed in perf audit 2.6: its only
 * caller was `resolveFlags`, and calling it once per key is exactly the fan-out
 * that change exists to remove. The `flag_enabled(text)` SQL function it wrapped
 * is deliberately left in the database — it is still the right primitive for a
 * one-off check from SQL, and `flags_enabled` is defined in terms of the same
 * bucket expression.
 */

/**
 * Resolve several flags in ONE round trip (perf audit 2.6), with a three-step
 * fallback that never fails open.
 *
 *   1. `flags_enabled(text[])` (migration 0171, applied to Frankfurt) — one
 *      round trip, returns a jsonb object keyed by flag. It reuses the exact
 *      rollout-bucket expression from `flag_enabled`, so the two can never
 *      disagree about which bucket a user is in (verified against production:
 *      both agree on all four flags plus a non-existent key).
 *
 *   2. If that call fails, fall back to the PREVIOUS behaviour — one
 *      `flag_enabled(text)` call per key. Slower, but still authoritative: it
 *      reads the same rows through the same bucket. This covers the realistic
 *      failure (the batch function missing on a database that has not had 0171
 *      applied — e.g. the Tokyo project, or a restored snapshot) without
 *      guessing at answers.
 *
 *   3. Only if BOTH fail — the database is unreachable, not merely stale — use
 *      `conservativeFlags`. See CONSERVATIVE_FLAG_DEFAULTS in flags-map.ts for
 *      why that is not the same thing as "all true".
 *
 * WHAT CHANGED AND WHY. This used to fail open: any read error turned every
 * requested flag ON. Two reasons that was wrong. It defeats the purpose of a
 * dark-launch switch — a single transient error could expose an unfinished
 * feature to the whole campus, silently. And its stated justification (being
 * safe to deploy before 0171 existed) expired the moment 0171 was applied to
 * production; step 2 now covers that case properly by actually reading the flag
 * rather than assuming a value for it.
 */
export async function resolveFlags(
  keys: FeatureKey[]
): Promise<Record<FeatureKey, boolean>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("flags_enabled", { p_keys: keys });
  if (!error) {
    const mapped = mapFlagsResponse(keys, data);
    if (mapped) return mapped;
  }

  // Step 2 — the pre-0171 read path, one call per key, still authoritative.
  // `allSettled` so one failing key cannot discard the others; any rejection or
  // error result disqualifies the whole batch and we escalate, rather than
  // returning a half-read set that silently mixes real and assumed answers.
  const perKey = await Promise.allSettled(
    keys.map(async (k) => {
      const res = await supabase.rpc("flag_enabled", { p_key: k });
      if (res.error) throw res.error;
      return [k, Boolean(res.data)] as const;
    })
  );
  if (perKey.every((r) => r.status === "fulfilled")) {
    return Object.fromEntries(
      perKey.map((r) => (r as PromiseFulfilledResult<readonly [FeatureKey, boolean]>).value)
    ) as Record<FeatureKey, boolean>;
  }

  // Step 3 — database unreachable.
  return conservativeFlags(keys);
}

export type MaintenanceState = {
  enabled: boolean;
  message: string;
};

/**
 * Current maintenance-mode state. Admins are exempted by the caller.
 *
 * CACHED (perf audit 5.1) — and this is the ONLY read in the student layout
 * that is safe to cache, for two reasons that have to hold together:
 *
 *   1. It is genuinely global. `get_maintenance_state()` takes no arguments and
 *      returns the same public-safe { enabled, message } to every caller, so one
 *      cached value cannot show user A something scoped to user B.
 *   2. It is readable by `anon` (migration 0081 grants execute to authenticated
 *      AND anon), so it can be read with the cookie-free client — which is what
 *      makes it legal inside a `use cache` scope at all.
 *
 * Feature flags are deliberately NOT cached alongside it, despite being the same
 * shape of config. `flag_enabled`/`flags_enabled` bucket each user by
 * `auth.uid()` for percentage rollouts, so their result is per-viewer, not
 * global; and migration 0081 (VULN-13) revoked them from `anon`, so a cached
 * scope could not read them without re-opening exactly what that migration
 * closed. Neither is worth a round trip.
 *
 * ON THE TTL — deliberately short and hand-tuned rather than `cacheLife("minutes")`
 * (stale 5m / revalidate 1m). Maintenance mode is an EMERGENCY lever: the cutover
 * runbook flips it to freeze writes during an incident, and it is toggled by raw
 * SQL against Supabase, not through a Server Action — so there is no code path
 * where we could call `updateTag` to invalidate on write. A minutes-long stale
 * window would mean students keep writing to a database someone is trying to
 * freeze, and the operator would have no way to tell when it had taken hold.
 * 15s bounds that to something an operator can simply wait out, while still
 * removing this read from the overwhelming majority of navigations.
 *
 * The tag is set anyway so that IF a first-class admin toggle is ever added, it
 * can call `updateTag("maintenance")` and make the switch instant.
 */
export async function getMaintenanceState(): Promise<MaintenanceState> {
  "use cache";
  cacheLife({ stale: 15, revalidate: 15, expire: 60 });
  cacheTag("maintenance");

  // The cookie-free client, NOT ./server's createClient: a cached scope cannot
  // read cookies, and the session-less client is what guarantees this value is
  // the same for everyone and therefore safe to share. See lib/supabase/anon.ts.
  const supabase = createAnonClient();
  // Read via the get_maintenance_state() SECURITY DEFINER RPC. The base
  // app_settings table is no longer directly readable by authenticated users
  // (migration 0081) so its rollout/version config isn't enumerable; the RPC
  // returns only the public-safe { enabled, message } shape.
  const { data, error } = await supabase.rpc("get_maintenance_state");
  // Fails CLOSED-to-normal: a failed read reports "not in maintenance" rather
  // than locking the whole student body out of the app on a transient blip.
  if (error || !data) return { enabled: false, message: "" };
  const value = (data ?? {}) as Record<string, unknown>;
  return {
    enabled: Boolean(value.enabled),
    message: typeof value.message === "string" ? value.message : "",
  };
}
