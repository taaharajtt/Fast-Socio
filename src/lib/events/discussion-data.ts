import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resolveAvatarUrl } from "@/lib/avatar";
import { groupReactionsByMessage, type MessageReaction } from "@/lib/chat/reactions";
import {
  HISTORY_FETCH_SIZE,
  HISTORY_PAGE_SIZE,
  takeHistoryPage,
} from "@/lib/chat/history";
import { olderThanFilter } from "@/lib/chat/keyset";
import type { MessageCursor } from "@/lib/chat/message-merge";
import type { EventMessage } from "@/components/events/event-discussion";

/**
 * The server read behind an event's discussion thread.
 *
 * EXTRACTED FROM THE PAGE, and that is the point rather than tidiness: the
 * first paint and every "Load earlier messages" page must produce identically
 * shaped rows — same columns, same profile join, same avatar resolution — or a
 * historic message renders subtly differently from a fresh one (no avatar, or
 * a raw storage path where a resolved URL should be). The page used to build
 * this inline, so a paged fetch would have been a second copy of the mapping.
 *
 * The old inline read ordered ASCENDING and took the first 100 — the OLDEST
 * hundred, so a busy event's thread opened on its first hundred messages and
 * could not reach the newest. Reading newest-first fixes that as well as
 * enabling the paging.
 *
 * ACCESS is the database's, unchanged: `event_messages` RLS admits only people
 * who can read the event's thread, so a cursor narrows rows the caller can
 * already see and can never widen them.
 */

const COLUMNS =
  "id, sender_id, body, created_at, edited_at, deleted_at, reply_to_id, attachment_url, attachment_type, sender:profiles(full_name, avatar_url, gender)";

type DiscussionRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_to_id: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  sender: {
    full_name: string | null;
    avatar_url: string | null;
    gender: string | null;
  } | null;
};

export type EventDiscussionData = {
  messages: EventMessage[];
  reactions: Record<string, MessageReaction[]>;
  /** True when older rows exist before the oldest one returned. */
  hasMore: boolean;
};

function toMessage(r: DiscussionRow): EventMessage {
  return {
    id: r.id,
    sender_id: r.sender_id,
    body: r.body,
    created_at: r.created_at,
    edited_at: r.edited_at,
    deleted_at: r.deleted_at,
    reply_to_id: r.reply_to_id,
    attachment_url: r.attachment_url,
    attachment_type: r.attachment_type,
    sender_name: r.sender?.full_name ?? null,
    sender_avatar: resolveAvatarUrl(r.sender?.avatar_url, r.sender?.gender),
  };
}

export async function loadEventDiscussion(
  eventId: string,
  options: { before?: MessageCursor | null } = {}
): Promise<EventDiscussionData> {
  const { before = null } = options;
  const supabase = await createClient();

  // Newest-first with `id` as the second key, so rows sharing a `created_at`
  // to the microsecond page deterministically rather than swapping places
  // between requests and being served twice or skipped.
  let query = supabase
    .from("event_messages")
    .select(COLUMNS)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_FETCH_SIZE);

  if (before) query = query.or(olderThanFilter(before));

  const { data } = await query;
  const fetched = ((data as unknown as DiscussionRow[]) ?? []).map(toMessage);
  const { items: messages, hasMore } = takeHistoryPage(
    fetched,
    HISTORY_PAGE_SIZE
  );

  const ids = messages.map((m) => m.id);
  // Reactions for this page, read on the SERVER. Leaving them to the client
  // opens the thread with no chips and grows them a round trip later, which
  // reads as the reactions having been lost.
  const { data: reactionRows } =
    ids.length > 0
      ? await supabase
          .from("event_message_reactions")
          .select("message_id, emoji, user_id")
          .in("message_id", ids)
      : { data: [] as { message_id: string; emoji: string; user_id: string }[] };

  return {
    messages,
    hasMore,
    reactions: groupReactionsByMessage(
      (reactionRows ?? []) as {
        message_id: string;
        emoji: string;
        user_id: string;
      }[],
      ids
    ),
  };
}
