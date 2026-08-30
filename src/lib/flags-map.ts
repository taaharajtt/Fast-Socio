/**
 * Pure flag-resolution rules, separated from the I/O in lib/flags.ts.
 *
 * It lives in its own module because flags.ts imports "server-only", which
 * throws on import outside a Server Component and so cannot be pulled into a
 * vitest run. Splitting the pure part out keeps these rules testable WITHOUT
 * aliasing `server-only` to a no-op in vitest.config.ts, which would quietly
 * disable that guard for every other test in the suite.
 *
 * `FeatureKey` is defined HERE rather than in flags.ts so that this module has
 * no dependency on a server-only file; flags.ts re-exports it, so every existing
 * import site is unchanged.
 */

export type FeatureKey = "discover" | "events" | "leaderboard" | "communities";

/**
 * Last-resort values, used ONLY when both the batch RPC and the per-key
 * fallback have failed — i.e. the database is unreachable, not merely slow.
 *
 * WHY THIS EXISTS AT ALL. The previous implementation failed OPEN: any read
 * error turned EVERY requested flag on. That is the wrong default for a
 * mechanism whose entire purpose is to keep unreleased functionality hidden —
 * one transient Postgres blip could dark-launch a half-finished feature to the
 * whole campus, and nothing in the app would report that it had happened.
 *
 * `true` here does NOT mean "fail open". It means "this destination is already
 * shipped and enabled in production, so showing it when we cannot read is the
 * accurate answer, not a leak". All four were verified enabled on the Frankfurt
 * production project. Hiding them on a blip would delete the primary navigation
 * tabs for every student, which is a visible outage for no safety gain.
 *
 * ANY NEW FLAG MUST BE ADDED HERE AS `false`. Because this is typed
 * `Record<FeatureKey, boolean>`, adding a key to `FeatureKey` without adding it
 * here is a COMPILE ERROR — so a dark-launch flag cannot silently inherit a
 * permissive default, and the choice shows up in review.
 */
export const CONSERVATIVE_FLAG_DEFAULTS: Record<FeatureKey, boolean> = {
  discover: true,
  events: true,
  leaderboard: true,
  communities: true,
};

/**
 * Read the jsonb object returned by `flags_enabled(text[])`.
 *
 * Returns `null` when the payload is unusable, which the caller treats as
 * "escalate to the next fallback" rather than as a set of answers. Returning
 * all-true here is exactly the fail-open behaviour that was removed.
 *
 * A key MISSING from an otherwise valid payload is `false`, matching what
 * `flag_enabled` returns for a flag row that does not exist. Folding that into
 * a permissive default would enable a feature the moment someone deleted its
 * row — the opposite of what a rollout switch is for.
 */
export function mapFlagsResponse(
  keys: FeatureKey[],
  data: unknown
): Record<FeatureKey, boolean> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  return Object.fromEntries(
    keys.map((k) => [k, k in row ? Boolean(row[k]) : false])
  ) as Record<FeatureKey, boolean>;
}

/** The last-resort answer. See CONSERVATIVE_FLAG_DEFAULTS for why not all-true. */
export function conservativeFlags(
  keys: FeatureKey[]
): Record<FeatureKey, boolean> {
  return Object.fromEntries(
    keys.map((k) => [k, CONSERVATIVE_FLAG_DEFAULTS[k] ?? false])
  ) as Record<FeatureKey, boolean>;
}
