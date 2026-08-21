import { AnnouncementThread } from "@/components/societies/announcement-thread";
import type { AnnouncementRow } from "@/lib/societies/types";

/**
 * Official notices from the society — one-way, and the only feed on this page.
 * A verified community has no conversation at all, so there is no hand-off into
 * chat from here any more. Rendered as a chat-style thread by
 * the client `AnnouncementThread`; this wrapper stays a plain (non-async)
 * server component so the Cache Components shell above it doesn't collapse.
 */
export function BroadcastTab({
  societyId,
  announcements,
  canPost,
  canManage,
}: {
  societyId: string;
  announcements: AnnouncementRow[];
  canPost: boolean;
  canManage: boolean;
}) {
  return (
    <AnnouncementThread
      societyId={societyId}
      announcements={announcements}
      canPost={canPost}
      canManage={canManage}
    />
  );
}
