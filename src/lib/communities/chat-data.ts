import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchPollResults, type PollOptionResult } from "@/app/(student)/communities/actions";
import { groupReactionsByMessage, type MessageReaction } from "@/lib/chat/reactions";
import {
  HISTORY_FETCH_SIZE,
  HISTORY_PAGE_SIZE,
  takeHistoryPage,
} from "@/lib/chat/history";
import { olderThanFilter } from "@/lib/chat/keyset";
import type { MessageCursor } from "@/lib/chat/message-merge";
import type { CommunityMessage } from "@/components/communities/community-chat";

/**
 * The server read behind a community chat room's thread — the first page of
 * messages, the tallies for any polls on it, and the reactions on all of them.
 *
 * This used to be inlined in `/chat/c/[id]`. The room's conversation now lives
 * on the room itself (Community -> Room -> Chat), so BOTH surfaces need exactly
 * the same read: same view, same columns, same page size, same poll fetch.
 * Extracting it is what keeps them the same thread rather than two lookalikes.
 *
 * `isMember` is a UI shortcut only — it skips a query that would return nothing
 * anyway. The real gate is the database: `community_chat_view` is
 * SECURITY INVOKER (migs 0046/0126/0142/0179) and its WHERE clause requires a
 * `community_members` row for `auth.uid()`, so a non-member (or someone who
 * just left, was removed or was banned) reads zero rows even if this is called
 * with `isMember: true`. That holds for the paged read below too: the cursor is
 * a filter on rows the caller can already see, never a way to reach rows they
 * cannot.
 *
 * ---------------------------------------------------------------------------
 * PAGED HISTORY, and a bug it fixes on the way.
 *
 * `paginated` opts a surface into the ten-at-a-time history: the newest ten on
 * entry, then ten more per "Load earlier messages". Community ROOMS use it;
 * Discover team rooms deliberately do not and keep the single unpaged load,
 * which is why this is a parameter rather than a change of behaviour.
 *
 * The unpaged path used to order ASCENDING and take the first 100 — the OLDEST
 * hundred. A room with more than a hundred messages opened on its first
 * hundred and could not reach the newest one at all. Both paths now read
 * newest-first and hand back a chronological page, so the thread opens where a
 * conversation should.
 */

export const COMMUNITY_CHAT_PAGE_SIZE = 100;

// deleted_at/attachment_*/edited_at/pinned_at/reply_to_id are required on the
// FIRST paint too — the cast below is `as CommunityMessage[]`, so omitting one
// is silently undefined rather than a type error (migs 0142, 0179).
const VIEW_COLUMNS =
  "id, sender_id, sender_name, sender_avatar, sender_gender, body, poll_id, is_anonymous, created_at, deleted_at, attachment_url, attachment_type, edited_at, pinned_at, reply_to_id";

export type CommunityChatData = {
  messages: CommunityMessage[];
  polls: Record<string, PollOptionResult[]>;
  reactions: Record<string, MessageReaction[]>;
  /** True when older rows exist before the oldest one returned. */
  hasMore: boolean;
};

export async function loadCommunityChat(
  communityId: string,
  isMember: boolean,
  options: { paginated?: boolean; before?: MessageCursor | null } = {}
): Promise<CommunityChatData> {
  if (!isMember) return { messages: [], polls: {}, reactions: {}, hasMore: false };

  const { paginated = false, before = null } = options;
  const supabase = await createClient();

  // Newest-first in BOTH modes, with `id` as the second sort key so rows
  // sharing a `created_at` to the microsecond page deterministically instead of
  // swapping places between requests and being served twice or skipped.
  let query = supabase
    .from("community_chat_view")
    .select(VIEW_COLUMNS)
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(paginated ? HISTORY_FETCH_SIZE : COMMUNITY_CHAT_PAGE_SIZE);

  if (before) query = query.or(olderThanFilter(before));

  const { data: chatRows } = await query;
  const fetched = (chatRows as CommunityMessage[] | null) ?? [];
  const { items: messages, hasMore } = paginated
    ? takeHistoryPage(fetched, HISTORY_PAGE_SIZE)
    : takeHistoryPage(fetched, COMMUNITY_CHAT_PAGE_SIZE);
  const ids = messages.map((m) => m.id);

  // Reactions are read on the SERVER for the first paint. Leaving it to the
  // client means every room opens with no chips and grows them a round trip
  // later, which reads as the reactions having been lost.
  const [polls, reactionRows] = await Promise.all([
    fetchPollResults([
      ...new Set(messages.map((m) => m.poll_id).filter(Boolean) as string[]),
    ]),
    ids.length > 0
      ? supabase
          .from("community_chat_reactions")
          .select("message_id, emoji, user_id")
          .in("message_id", ids)
      : Promise.resolve({ data: [] as null | [] }),
  ]);

  return {
    messages,
    hasMore,
    polls,
    reactions: groupReactionsByMessage(
      (reactionRows.data ?? []) as {
        message_id: string;
        emoji: string;
        user_id: string;
      }[],
      ids
    ),
  };
}
