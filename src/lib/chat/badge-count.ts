/**
 * The dock's chat badge: unread DMs + pending message requests.
 *
 * ONE round trip via the `chat_badge_count()` RPC (migration 0155), replacing
 * two separate count queries — one of which had no predicate scoping it to the
 * caller at all and leaned entirely on RLS to filter a whole-table scan (perf
 * audit F6). See the migration for the full reasoning and the security note on
 * why the definer function's inline scoping matches the policy exactly.
 *
 * Shared by the server (student layout) and the browser (<DockRealtime/>),
 * which is the point: they must never disagree about what the badge means, and
 * before this they were two hand-written copies of the same pair of queries.
 *
 * Deliberately NOT `server-only` — the realtime recount runs in the browser
 * with the anon key, and RLS plus the function's own auth.uid() scoping make
 * that safe: the RPC takes no user parameter, so a client cannot ask for
 * anyone else's counts.
 */

export type ChatBadge = {
  unread: number;
  requests: number;
  /** What the dock actually renders. */
  total: number;
};

const EMPTY: ChatBadge = { unread: 0, requests: 0, total: 0 };

/** Minimal shape of the Supabase clients this works with (server or browser). */
type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function fetchChatBadge(supabase: RpcClient): Promise<ChatBadge> {
  const { data, error } = await supabase.rpc("chat_badge_count");
  // Fail to zero rather than throwing: a badge is decoration, and an error here
  // must not take down the app shell it renders inside. A missing badge reads
  // as "nothing new", which is the safe wrong answer — the alternative is a
  // phantom count that sends someone to an empty inbox.
  if (error || !data || typeof data !== "object") return EMPTY;

  const row = data as Record<string, unknown>;
  const unread = Number(row.unread ?? 0);
  const requests = Number(row.requests ?? 0);
  if (!Number.isFinite(unread) || !Number.isFinite(requests)) return EMPTY;

  return { unread, requests, total: unread + requests };
}
