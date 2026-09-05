import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The dock's Community badge: UNREAD COMMUNITY UPDATES. One number, one unit.
 *
 * It is `count(*)` over `public.community_updates` where `read_at is null` —
 * the very rows /communities/updates renders. If the badge says 6, six rows are
 * waiting there, and reading them takes it to zero. Nothing else can move it.
 *
 * This replaces migration 0170's six-part grouped count, which summed
 * communities, memberships, per-space collapses and platform-wide creation
 * events into a single integer that answered no single question and had no list
 * behind it. See migration 0183 for the full account.
 *
 * ONE round trip via `community_badge_count()`, which is also what
 * `home_bootstrap()` composes — so the shell's server render and any client
 * recount go through the same definition and cannot drift.
 *
 * Deliberately NOT `server-only`, matching `fetchChatBadge`: the RPC takes no
 * user parameter (identity is always `auth.uid()`), so the realtime island can
 * call it from the browser to reconcile.
 *
 * IT FAILS SAFE. An unmigrated database, a revoked grant or a network blip
 * yields zero — no badge — rather than a guess. A badge that lies is worse than
 * a badge that is briefly absent.
 */

export type CommunityBadge = {
  /** Unread Community updates. */
  updates: number;
  /** What the dock renders. Same number; the key the shell reads. */
  total: number;
};

const EMPTY: CommunityBadge = { updates: 0, total: 0 };

/** Both the server (@supabase/ssr) and browser clients are SupabaseClient
 *  instances; the badge read is identical on either side of the boundary. */
type BadgeClient = Pick<SupabaseClient, "rpc">;

export async function fetchCommunityBadge(
  supabase: BadgeClient
): Promise<CommunityBadge> {
  try {
    const { data, error } = await supabase.rpc("community_badge_count");
    if (!error && data && typeof data === "object") {
      return toCommunityBadge(data as Record<string, unknown>);
    }
  } catch {
    // An absent function, a revoked grant, a network blip. Fall through.
  }
  return EMPTY;
}

/**
 * Narrow the RPC payload into the badge.
 *
 * Exported and tested directly because this is where a bad number is stopped:
 * a NaN, a negative or a fractional count from a future or miscoded RPC must
 * render as no badge, never as "NaN" or "-1" in the dock.
 *
 * A pre-0183 payload (0170's `{manage, joined, communities, …}`) carries no
 * `updates` key and resolves to zero — the correct direction for a client that
 * meets an older database: the badge is absent rather than wrong.
 */
export function toCommunityBadge(row: Record<string, unknown>): CommunityBadge {
  const raw = Number(row.updates ?? 0);
  const safe = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  return { updates: safe, total: safe };
}
