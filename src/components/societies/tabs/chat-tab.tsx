import { MessageCircle } from "lucide-react";
import {
  CommunityChat,
  type CommunityMessage,
} from "@/components/communities/community-chat";
import { JoinSocietyButton } from "@/components/societies/join-society-button";
import type { PollOptionResult } from "@/app/(student)/communities/actions";

/** Zone 2 open chat room, gated to joined members. */
export function ChatTab({
  societyId,
  meId,
  isMember,
  initialMessages,
  initialPolls,
}: {
  societyId: string;
  meId: string;
  isMember: boolean;
  initialMessages: CommunityMessage[];
  initialPolls: Record<string, PollOptionResult[]>;
}) {
  if (!isMember) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[14px] bg-card px-5 py-10 text-center">
        <MessageCircle className="h-8 w-8 text-fg-muted" aria-hidden />
        <p className="font-semibold text-fg">
          Join this society to participate in chat
        </p>
        <JoinSocietyButton societyId={societyId} />
      </div>
    );
  }

  return (
    <CommunityChat
      communityId={societyId}
      meId={meId}
      initialMessages={initialMessages}
      initialPolls={initialPolls}
    />
  );
}
