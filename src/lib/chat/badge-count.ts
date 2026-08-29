import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The dock's chat badge: unread CONVERSATIONS + pending message requests.
 *
 * Conversations, not messages (migration 0169). Three messages from one person
 * in one thread are one thing to go and read, so they count 1; one message in
 * each of three threads counts 3. A pending message request is its own distinct
 * thing to act on, so requests still contribute one apiece.
 *
 * ONE round trip via the `chat_badge_count()` RPC. Shared by the server
 * (student layout) and the browser (<DockRealtime/>), which is the point: they
 * must never disagree about what the badge means.
 *
 * Deliberately NOT `server-only`: the realtime recount runs in the browser with
 * the anon key, and that is safe because the RPC takes no user parameter — the
 * identity is always `auth.uid()`, so a client cannot ask for anyone else's
 * counts.
 *
 * IT FAILS SAFE ON AN UNMIGRATED DATABASE, and specifically on the 0166-era one
 * that returned a MESSAGE count. The RPC result is only trusted when it carries
 * the `conversations` key that 0169 introduced; anything older falls through to
 * the query path below, which computes the same conversation-shaped number
 * client-side. That is why a stale RPC degrades cost rather than silently
 * rendering a wrong badge.
 */

export type ChatBadge = {
  /** Distinct conversations holding at least one unread message. */
  conversations: number;
  requests: number;
  /** What the dock actually renders. */
  total: number;
};

const EMPTY: ChatBadge = { conversations: 0, requests: 0, total: 0 };

/** Both the server (@supabase/ssr) and browser clients are SupabaseClient
 *  instances; the badge read is identical on either side of the boundary. */
type BadgeClient = Pick<SupabaseClient, "rpc" | "from">;

/** Cap on the unread rows the fallback pulls back to count threads from. Far
 *  above any real inbox; it exists so a pathological account cannot drag a
 *  layout render down. Overflow can only under-count a badge that already
 *  renders as "9+". */
const FALLBACK_ROW_CAP = 500;

function toBadge(conversations: number, requests: number): ChatBadge {
  return { conversations, requests, total: conversations + requests };
}

export async function fetchChatBadge(
  supabase: BadgeClient,
  userId: string
): Promise<ChatBadge> {
  try {
    const { data, error } = await supabase.rpc("chat_badge_count");
    if (!error && data && typeof data === "object") {
      const row = data as Record<string, unknown>;
      // `conversations` is the 0169 marker. A 0166 database answers this call
      // happily with a message count under `unread` — trusting that would
      // reintroduce the exact bug 0169 fixes, so it is not accepted here.
      if (row.conversations !== undefined) {
        const conversations = Number(row.conversations ?? 0);
        const requests = Number(row.requests ?? 0);
        if (Number.isFinite(conversations) && Number.isFinite(requests)) {
          return toBadge(conversations, requests);
        }
      }
    }
  } catch {
    // Fall through to the query path below.
  }
  return fallbackChatBadge(supabase, userId);
}

/**
 * The pre-0169 path, kept as the fallback rather than deleted so deploying this
 * code ahead of the migration degrades to the old COST rather than to a wrong
 * badge. It reads the unread rows' conversation ids and collapses them here, so
 * it produces the same number the RPC does — a badge that changed meaning
 * depending on which path answered would be worse than either meaning.
 */
async function fallbackChatBadge(
  supabase: BadgeClient,
  userId: string
): Promise<ChatBadge> {
  try {
    const [{ data: unreadRows }, { count: requests }] = await Promise.all([
      supabase
        .from("messages")
        .select("conversation_id")
        .neq("sender_id", userId)
        .is("read_at", null)
        .limit(FALLBACK_ROW_CAP),
      supabase
        .from("message_requests")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .eq("status", "pending"),
    ]);
    const conversations = new Set(
      ((unreadRows ?? []) as { conversation_id: string | null }[])
        .map((r) => r.conversation_id)
        .filter((id): id is string => Boolean(id))
    ).size;
    return toBadge(conversations, requests ?? 0);
  } catch {
    // Fail to zero rather than throwing: a badge is decoration, and an error
    // here must not take down the app shell it renders inside. "Nothing new" is
    // the safe wrong answer — the alternative is a phantom count that sends
    // someone to an empty inbox.
    return EMPTY;
  }
}
