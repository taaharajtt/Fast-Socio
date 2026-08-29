import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The dock's chat badge: unread DMs + pending message requests.
 *
 * ONE round trip via the `chat_badge_count()` RPC (migration 0166), replacing
 * two separate count queries — one of which had no predicate scoping it to the
 * caller at all and leaned entirely on RLS to filter a whole-table scan. See the
 * migration for the reasoning and for the security note on why the definer
 * function's inline scoping matches the messages SELECT policy exactly.
 *
 * Shared by the server (student layout) and the browser (<DockRealtime/>),
 * which is the point: they must never disagree about what the badge means, and
 * before this they were two hand-written copies of the same pair of queries.
 *
 * Deliberately NOT `server-only`: the realtime recount runs in the browser with
 * the anon key, and that is safe because the RPC takes no user parameter — the
 * identity is always `auth.uid()`, so a client cannot ask for anyone else's
 * counts.
 *
 * IT FAILS SAFE ON AN UNMIGRATED DATABASE. If the function does not exist yet,
 * this falls back to the two queries it replaces, so the code is correct on an
 * environment where 0166 has not been applied.
 */

export type ChatBadge = {
  unread: number;
  requests: number;
  /** What the dock actually renders. */
  total: number;
};

const EMPTY: ChatBadge = { unread: 0, requests: 0, total: 0 };

/** Both the server (@supabase/ssr) and browser clients are SupabaseClient
 *  instances; the badge read is identical on either side of the boundary. */
type BadgeClient = Pick<SupabaseClient, "rpc" | "from">;

export async function fetchChatBadge(
  supabase: BadgeClient,
  userId: string
): Promise<ChatBadge> {
  try {
    const { data, error } = await supabase.rpc("chat_badge_count");
    if (!error && data && typeof data === "object") {
      const row = data as Record<string, unknown>;
      const unread = Number(row.unread ?? 0);
      const requests = Number(row.requests ?? 0);
      if (Number.isFinite(unread) && Number.isFinite(requests)) {
        return { unread, requests, total: unread + requests };
      }
    }
  } catch {
    // Fall through to the pre-0166 path below.
  }
  return fallbackChatBadge(supabase, userId);
}

/**
 * The pre-0166 pair of counts. Kept as the fallback path rather than deleted, so
 * deploying this code ahead of the migration degrades to the old cost rather
 * than to a wrong badge.
 */
async function fallbackChatBadge(
  supabase: BadgeClient,
  userId: string
): Promise<ChatBadge> {
  try {
    const [{ count: unread }, { count: requests }] = await Promise.all([
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .neq("sender_id", userId)
        .is("read_at", null),
      supabase
        .from("message_requests")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .eq("status", "pending"),
    ]);
    return {
      unread: unread ?? 0,
      requests: requests ?? 0,
      total: (unread ?? 0) + (requests ?? 0),
    };
  } catch {
    // Fail to zero rather than throwing: a badge is decoration, and an error
    // here must not take down the app shell it renders inside. "Nothing new" is
    // the safe wrong answer — the alternative is a phantom count that sends
    // someone to an empty inbox.
    return EMPTY;
  }
}
