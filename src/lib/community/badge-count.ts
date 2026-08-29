import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The dock's Community badge: grouped Community / Event / Broadcast ITEMS.
 *
 * Never raw messages. Community chat does not appear here at all — talking
 * happens in Chat, and a room with forty unread lines is not forty things to
 * go and do. A space that posts twenty announcements contributes ONE item.
 *
 * The six kinds, and what each one is worth:
 *
 *   manage       one per COMMUNITY that needs you (a pending join request or a
 *                post in its review queue). One community = 1, two = 2.
 *   joined       one per community someone else approved you into.
 *   communities  one per newly created (approved, public) community.
 *   events       one per newly created, still-upcoming event.
 *   broadcasts   one per SPACE that has posted since you last opened it.
 *   approvals    one per community or event of yours an admin approved.
 *
 * ONE round trip via the `community_badge_count()` RPC (migration 0170), which
 * is where the grouping actually happens — the per-community and per-space
 * collapse is a `count(*) ... where exists (...)`, not something reconstructed
 * from rows here. This helper only sums the breakdown, so the dock cannot
 * disagree with the database about what counts as an item.
 *
 * Deliberately NOT `server-only`, matching `fetchChatBadge`: the RPC takes no
 * user parameter, identity is always `auth.uid()`, so it is safe to call from
 * the browser if a live recount is ever wanted. Nothing calls it from the
 * client today — the Community badge changes on a timescale where the next
 * navigation is soon enough, so it has no realtime island and therefore no
 * second implementation that could drift from this one.
 *
 * IT FAILS SAFE ON AN UNMIGRATED DATABASE. Without 0170 there is no seen model
 * to compute against, and a badge invented from a partial signal would point
 * students at surfaces they have already read — so the fallback is an explicit
 * zero (no badge) rather than a guess.
 */

export type CommunityBadge = {
  manage: number;
  joined: number;
  communities: number;
  events: number;
  broadcasts: number;
  approvals: number;
  /** What the dock actually renders. */
  total: number;
};

const EMPTY: CommunityBadge = {
  manage: 0,
  joined: 0,
  communities: 0,
  events: 0,
  broadcasts: 0,
  approvals: 0,
  total: 0,
};

/** The breakdown keys, in the order the migration documents them. */
const PARTS = [
  "manage",
  "joined",
  "communities",
  "events",
  "broadcasts",
  "approvals",
] as const;

/** Both the server (@supabase/ssr) and browser clients are SupabaseClient
 *  instances; the badge read is identical on either side of the boundary. */
type BadgeClient = Pick<SupabaseClient, "rpc">;

export async function fetchCommunityBadge(
  supabase: BadgeClient
): Promise<CommunityBadge> {
  try {
    const { data, error } = await supabase.rpc("community_badge_count");
    if (!error && data && typeof data === "object") {
      return sumBadge(data as Record<string, unknown>);
    }
  } catch {
    // An absent function, a revoked grant, a network blip. Fall through.
  }
  return EMPTY;
}

/**
 * Sum a breakdown into the rendered total, dropping anything that isn't a
 * finite non-negative number. Exported for tests — the grouping rules are the
 * product decision here, so they are worth asserting directly.
 */
export function sumBadge(row: Record<string, unknown>): CommunityBadge {
  const badge = { ...EMPTY };
  let total = 0;
  for (const key of PARTS) {
    const value = Number(row[key] ?? 0);
    // A NaN or a negative from a future/miscoded RPC must not corrupt the sum;
    // treating it as zero loses one item at worst, where propagating it would
    // render "NaN" in the dock.
    const safe = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    badge[key] = safe;
    total += safe;
  }
  badge.total = total;
  return badge;
}
