import { AnnouncementThread } from "@/components/societies/announcement-thread";
import type { AnnouncementRow } from "@/lib/societies/types";

/**
 * Official notices from the society — one-way, and the only feed on this page.
 * Members also get the single hand-off into the society's conversation, which
 * lives in Chat rather than in a tab here. Rendered as a chat-style thread by
 * the client `AnnouncementThread`; this wrapper stays a plain (non-async)
 * server component so the Cache Components shell above it doesn't collapse.
 */
export function BroadcastTab({
  societyId,
  announcements,
  canPost,
  canManage,
  isMember,
}: {
  societyId: string;
  announcements: AnnouncementRow[];
  canPost: boolean;
  canManage: boolean;
  /** Joined members can open the society's thread in the Chat area. */
  isMember: boolean;
}) {
  return (
    <AnnouncementThread
      societyId={societyId}
      announcements={announcements}
      canPost={canPost}
      canManage={canManage}
      isMember={isMember}
    />
  );
}
