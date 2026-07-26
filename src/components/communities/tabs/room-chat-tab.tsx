import { MessageSquare } from "lucide-react";
import {
  CommunityChat,
  type CommunityMessage,
} from "@/components/communities/community-chat";
import type { PollOptionResult } from "@/app/(student)/communities/actions";

export function RoomChatTab({
  communityId,
  meId,
  isMember,
  initialMessages,
  initialPolls,
}: {
  communityId: string;
  meId: string;
  isMember: boolean;
  initialMessages: CommunityMessage[];
  initialPolls: Record<string, PollOptionResult[]>;
}) {
  if (!isMember) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-[14px] bg-card px-5 py-10 text-center">
        <MessageSquare className="h-8 w-8 text-fg-muted" aria-hidden />
        <p className="font-semibold text-fg">Join to chat with this room</p>
      </div>
    );
  }

  return (
    <CommunityChat
      communityId={communityId}
      meId={meId}
      initialMessages={initialMessages}
      initialPolls={initialPolls}
    />
  );
}
