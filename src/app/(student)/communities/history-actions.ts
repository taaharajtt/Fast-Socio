"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { loadCommunityChat } from "@/lib/communities/chat-data";
import type { PollOptionResult } from "@/app/(student)/communities/actions";
import type { MessageReaction } from "@/lib/chat/reactions";
import type { CommunityMessage } from "@/components/communities/community-chat";

/**
 * "Load earlier messages" for a community chat room.
 *
 * WHY THIS IS ITS OWN FILE and not another export in `actions.ts`:
 * `chat-data.ts` imports `fetchPollResults` FROM `actions.ts`, so putting a
 * function that calls `loadCommunityChat` back into `actions.ts` closes an
 * import cycle. It happens to survive today — both sides are hoisted function
 * declarations — but it is a cycle across a `"use server"` boundary that the
 * bundler is free to order either way, and it costs nothing to not have one.
 *
 * A Server Function is reachable by direct POST, not only through the UI
 * (Next.js data-security guidance), so this carries its own authorization
 * rather than relying on the caller. `isMember` is re-derived here from the
 * database — never taken from the client — and beneath that
 * `community_chat_view` is SECURITY INVOKER with a `community_members`
 * predicate on `auth.uid()`, so a forged community id reads zero rows instead
 * of someone else's room. The cursor only ever NARROWS rows the caller can
 * already see.
 *
 * Polls and reactions for the older rows come back with them. Leaving them to a
 * second round trip would paint ten historic messages with their tallies and
 * reaction chips missing, which reads as the history having lost them.
 */
export async function loadEarlierCommunityMessages(
  communityId: string,
  cursor: { createdAt: string; id: string }
): Promise<{
  messages: CommunityMessage[];
  polls: Record<string, PollOptionResult[]>;
  reactions: Record<string, MessageReaction[]>;
  hasMore: boolean;
}> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { messages: [], polls: {}, reactions: {}, hasMore: false };

  const { data: membership } = await supabase
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  return loadCommunityChat(communityId, Boolean(membership), {
    paginated: true,
    before: cursor,
  });
}
