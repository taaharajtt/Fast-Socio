import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchPollResults, type PollOptionResult } from "@/app/(student)/communities/actions";
import { groupReactionsByMessage, type MessageReaction } from "@/lib/chat/reactions";
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
 * with `isMember: true`.
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
};

export async function loadCommunityChat(
  communityId: string,
  isMember: boolean
): Promise<CommunityChatData> {
  if (!isMember) return { messages: [], polls: {}, reactions: {} };

  const supabase = await createClient();
  const { data: chatRows } = await supabase
    .from("community_chat_view")
    .select(VIEW_COLUMNS)
    .eq("community_id", communityId)
    .order("created_at", { ascending: true })
    .limit(COMMUNITY_CHAT_PAGE_SIZE);

  const messages = (chatRows as CommunityMessage[] | null) ?? [];
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
