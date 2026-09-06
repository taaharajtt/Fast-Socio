"use server";

import { getAuthUserId } from "@/lib/auth/user";
import { loadEventDiscussion } from "@/lib/events/discussion-data";
import type { MessageReaction } from "@/lib/chat/reactions";
import type { EventMessage } from "@/components/events/event-discussion";

/**
 * "Load earlier messages" for an event's discussion thread.
 *
 * A Server Function is reachable by direct POST, not only through the UI
 * (Next.js data-security guidance), so authorization is checked here rather
 * than assumed from the caller — and the real gate is below it: `event_messages`
 * RLS admits only people who can read that event's thread, so a forged event id
 * returns zero rows rather than someone else's discussion. The cursor only ever
 * NARROWS the rows the caller can already see.
 *
 * Its own file, matching the community one, so a `"use server"` module that
 * calls a loader never sits in the same file the loader imports from.
 */
export async function loadEarlierEventMessages(
  eventId: string,
  cursor: { createdAt: string; id: string }
): Promise<{
  messages: EventMessage[];
  reactions: Record<string, MessageReaction[]>;
  hasMore: boolean;
}> {
  const userId = await getAuthUserId();
  if (!userId) return { messages: [], reactions: {}, hasMore: false };
  return loadEventDiscussion(eventId, { before: cursor });
}
