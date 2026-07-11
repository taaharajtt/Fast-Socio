import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Refactor Phase 1 — server-side feature-flag + maintenance helpers.
 *
 * Flags gate primary destinations in the app shell so a feature can be dark-
 * launched or rolled back without a deploy. Reads go through the `flag_enabled`
 * / `is_maintenance_mode` SQL functions (migration 0050) which apply the
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

/** Batch variant — resolves several flags in parallel for a layout. */
export async function resolveFlags(
  keys: FeatureKey[]
): Promise<Record<FeatureKey, boolean>> {
  const entries = await Promise.all(
    keys.map(async (k) => [k, await isFeatureEnabled(k)] as const)
  );
  return Object.fromEntries(entries) as Record<FeatureKey, boolean>;
}

export type MaintenanceState = {
  enabled: boolean;
  message: string;
};

/** Current maintenance-mode state. Admins are exempted by the caller. */
export const getMaintenanceState = cache(
  async (): Promise<MaintenanceState> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "maintenance")
      .maybeSingle();
    if (error || !data) return { enabled: false, message: "" };
    const value = (data.value ?? {}) as Record<string, unknown>;
    return {
      enabled: Boolean(value.enabled),
      message: typeof value.message === "string" ? value.message : "",
    };
  }
);
