import { MessageCircle } from "lucide-react";
import {
  CommunityChat,
  type CommunityMessage,
} from "@/components/communities/community-chat";
import { RequestJoinButton } from "@/components/communities/request-join-button";
import type { JoinState, PollOptionResult } from "@/app/(student)/communities/actions";

/**
 * The general chat room of a society or a casual chat room — one component,
 * because the two are the same surface with the same rule: only JOINED members
 * may read and send. Followers get this gate instead, which explains the
 * difference rather than just refusing.
 */
export function SpaceChatTab({
  communityId,
  meId,
  isMember,
  joinStatus,
  initialMessages,
  initialPolls,
}: {
  communityId: string;
  meId: string;
  isMember: boolean;
  joinStatus: JoinState;
  initialMessages: CommunityMessage[];
  initialPolls: Record<string, PollOptionResult[]>;
}) {
  if (!isMember) {
    return (
      <div className="mt-4 flex flex-col items-center gap-3 rounded-[14px] bg-card px-5 py-10 text-center">
        <MessageCircle className="h-8 w-8 text-fg-muted" aria-hidden />
        <p className="font-semibold text-fg">
          {joinStatus === "pending"
            ? "Your request is with the moderators"
            : "Join to chat here"}
        </p>
        <p className="-mt-1 text-sm text-fg-muted">
          {joinStatus === "pending"
            ? "You'll be able to send messages as soon as it's approved."
            : "Following shows you broadcasts. Chatting needs approval."}
        </p>
        <RequestJoinButton communityId={communityId} joinStatus={joinStatus} />
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
