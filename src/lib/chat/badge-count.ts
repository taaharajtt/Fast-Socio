import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxData } from "@/lib/chat/inbox-types";

/**
 * The parts of an inbox payload the badge is derived from. Structural rather
 * than `InboxData` itself so the tests can build a minimal fixture, and so a
 * future field on InboxData cannot silently change what the badge counts.
 */
export type InboxBadgeSource = {
  threads: InboxData["threads"];
  incoming: InboxData["incoming"];
};

/**
 * The dock's chat badge: unread CONVERSATIONS + pending message requests.
 *
 * Conversations, not messages (migration 0169). Three messages from one person
 * in one thread are one thing to go and read, so they count 1; one message in
 * each of three threads counts 3. A pending message request is its own distinct
 * thing to act on, so requests still contribute one apiece.
 *
 * ONE round trip via the `chat_badge_count()` RPC, used by the server (student
 * layout, through `home_bootstrap`). The browser no longer calls it at all:
 * <ChatRealtime/> derives the same number from the inbox payload it already
 * fetched (see `deriveChatBadge` below), which is what removed the second
 * server round trip per realtime event.
 *
 * All three paths route through `toBadge`, which is the point: they must never
 * disagree about what the badge means.
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

/** Exported so the batched `home_bootstrap` reader can build a badge from the
 *  embedded payload without re-deriving the total rule. One definition. */
export function toBadge(conversations: number, requests: number): ChatBadge {
  return { conversations, requests, total: conversations + requests };
}

/**
 * The same badge, derived from an inbox payload the client already holds.
 *
 * WHY THIS EXISTS. `<ChatRealtime/>` re-reads the inbox on every realtime event.
 * Before it was merged, the dock ALSO issued `chat_badge_count()` on the same
 * event — two server round trips per inbound message, per open tab, to render
 * one list and one number that are both functions of the same underlying rows.
 * The inbox read already contains everything the badge needs, so the second
 * round trip was redundant rather than merely cheap.
 *
 * IT IS EXACT, NOT AN APPROXIMATION, and that rests on three properties of
 * `loadInbox()` that must hold for this to stay correct:
 *
 *  1. the `conversations` query is unfiltered and unlimited, so every
 *     conversation reaches `threads`;
 *  2. `unread` per thread comes from `conversation_unread_counts()`, which is
 *     aggregated in SQL rather than counted from the capped preview page, so it
 *     is exact even in a very busy thread;
 *  3. `incoming` is every pending request, also unlimited.
 *
 * If any of those ever gains a LIMIT, this silently starts under-counting and
 * `deriveChatBadge` must go back to being an RPC. The unit tests pin the shape;
 * they cannot pin the query, so the note has to live here.
 *
 * The two SQL definitions of "unread" were reconciled in migration 0176 —
 * `chat_badge_count()` had no `hidden = false` filter and
 * `conversation_unread_counts()` did, so a moderated message counted towards
 * the dock but not the inbox. Deriving one from the other is only sound because
 * they now agree; do not deploy this ahead of that migration.
 *
 * Routed through `toBadge` like every other path, so what the number MEANS has
 * exactly one definition no matter who computed it.
 */
export function deriveChatBadge(data: InboxBadgeSource): ChatBadge {
  let conversations = 0;
  for (const t of data.threads) {
    // Spaces (Discover team rooms) carry no unread count and never have — they
    // are excluded from the badge on the server too, so counting them here
    // would make the dock disagree with the layout on first paint.
    if (t.kind === "dm" && t.unread > 0) conversations += 1;
  }
  return toBadge(conversations, data.incoming.length);
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
        // Matches chat_badge_count() and conversation_unread_counts() as of
        // migration 0176. A hidden message has been moderated away and cannot
        // be read, so it is not something left to read.
        .eq("hidden", false)
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
