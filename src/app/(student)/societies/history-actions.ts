"use server";

import { getAuthUserId } from "@/lib/auth/user";
import {
  getSocietyAnnouncementPage,
  getAnnouncementReactions,
} from "@/lib/societies/queries";
import type { MessageReaction } from "@/lib/chat/reactions";
import type { AnnouncementRow } from "@/lib/societies/types";

/**
 * "Load earlier messages" for a society/community broadcast channel.
 *
 * A Server Function is reachable by direct POST, not only through the UI
 * (Next.js data-security guidance), so it checks a session here — and the real
 * gate is below it: `society_announcement_feed` is the definer feed view that
 * already enforces broadcast visibility, so a forged society id returns what
 * that view permits and nothing more. The cursor only ever NARROWS rows the
 * caller can already see.
 *
 * READ ONLY. Who may post a broadcast, who may pin, edit, delete or reveal an
 * anonymous author — none of that is touched here or anywhere in this change.
 *
 * Rows come back NEWEST-FIRST, matching `getSocietyAnnouncements`; the thread
 * reverses into display order, which is the one place that conversion lives.
 */
export async function loadEarlierAnnouncements(
  societyId: string,
  cursor: { createdAt: string; id: string }
): Promise<{
  items: AnnouncementRow[];
  reactions: Record<string, MessageReaction[]>;
  hasMore: boolean;
}> {
  const userId = await getAuthUserId();
  if (!userId) return { items: [], reactions: {}, hasMore: false };

  const page = await getSocietyAnnouncementPage(societyId, { before: cursor });
  // The older broadcasts bring their own reaction chips, so history does not
  // paint without them and grow them a round trip later.
  const reactions = await getAnnouncementReactions(page.items.map((a) => a.id));
  return { items: page.items, reactions, hasMore: page.hasMore };
}
