/**
 * The Activity unread count.
 *
 * Shared by the server (the /home header badge) and the browser (the realtime
 * island), for the same reason `lib/chat/badge-count.ts` is shared: two
 * hand-written copies of the same filter WILL drift, and a badge that points at
 * rows the panel won't show is worse than no badge.
 *
 * The filter mirrors /activity exactly: `notifications_live` (mig 0132 hides
 * rows whose subject was deleted), and message / message_request / announcement
 * excluded — those surface in Chat and as a cold-open modal respectively.
 *
 * Deliberately NOT `server-only`: the browser runs this with the anon key, and
 * RLS scopes `notifications_live` to `user_id = auth.uid()`. The `user_id`
 * predicate here is a query narrowing, not the security boundary.
 */

/**
 * Structurally typed so the browser client and the SSR server client both
 * satisfy it. Spelling out the full PostgREST builder chain here makes the
 * compiler recurse through its generics (`Type instantiation is excessively
 * deep`), so the chain is left opaque and the shape is pinned by the single
 * call below instead.
 */
export type CountClient = { from: (table: string) => unknown };

type CountSelect = {
  select: (
    columns: string,
    options: { count: "exact"; head: true }
  ) => PostgrestCountFilter;
};

type PostgrestCountFilter = {
  eq: (column: string, value: string) => PostgrestCountFilter;
  is: (column: string, value: null) => PostgrestCountFilter;
  not: (
    column: string,
    operator: string,
    value: string
  ) => PromiseLike<{ count: number | null }>;
};

/** Types excluded from Activity, as a PostgREST `in` list. */
export const ACTIVITY_EXCLUDED_TYPES = "(message,message_request,announcement)";

export async function fetchActivityUnread(
  supabase: CountClient,
  userId: string
): Promise<number> {
  // One cast, at the boundary. Matching the real PostgREST builder generics
  // structurally makes the compiler recurse forever (TS2589), and both clients
  // this is called with expose the identical chain at runtime.
  const table = supabase.from("notifications_live") as CountSelect;
  const { count } = await table
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null)
    .not("type", "in", ACTIVITY_EXCLUDED_TYPES);
  return count ?? 0;
}
