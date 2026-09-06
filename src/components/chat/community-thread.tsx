import { MessageCircle } from "lucide-react";
import {
  CommunityChat,
  type CommunityMessage,
} from "@/components/communities/community-chat";
import { RequestJoinButton } from "@/components/communities/request-join-button";
import type { JoinState, PollOptionResult } from "@/app/(student)/communities/actions";
import type { MessageReaction } from "@/lib/chat/reactions";

/**
 * The body of a community conversation in the Chat area — the gate, then the
 * thread. FOLLOWING a space shows you its broadcasts over in Community; SENDING
 * here needs an approved JOIN, so a follower gets this panel instead of a
 * composer. send_community_message() rejects a non-member outright, so the gate
 * is a courtesy on top of the real rule, not the rule itself.
 */
export function CommunityThread({
  communityId,
  meId,
  isMember,
  joinStatus,
  initialMessages,
  initialPolls,
  initialReactions,
  allowAnonymous = true,
  canModerate = false,
  paginated = false,
  hasMoreHistory = false,
}: {
  communityId: string;
  meId: string;
  isMember: boolean;
  joinStatus: JoinState;
  initialMessages: CommunityMessage[];
  initialPolls: Record<string, PollOptionResult[]>;
  /** messageId -> reactions, for the first paint (mig 0179). */
  initialReactions?: Record<string, MessageReaction[]>;
  /** False for Discover team rooms — no anonymous posting there (fix-018). */
  allowAnonymous?: boolean;
  /** Viewer may delete anyone's message here (fix-051). */
  canModerate?: boolean;
  /**
   * Ten-at-a-time history with the "Load earlier messages" capsule. TRUE for
   * community chat rooms, FALSE for Discover team rooms — the same split as
   * `allowAnonymous`, decided by the route rather than here.
   */
  paginated?: boolean;
  hasMoreHistory?: boolean;
}) {
  if (!isMember) {
    return (
      <div className="mt-4 flex flex-col items-center gap-3 rounded-[14px] bg-card px-5 py-10 text-center">
        <MessageCircle className="h-8 w-8 text-fg-muted" aria-hidden />
        <p className="font-semibold text-fg">
          {joinStatus === "pending"
            ? "Your request is with the moderators"
            : "Join this room to access chat"}
        </p>
        <p className="-mt-1 text-sm text-fg-muted">
          {joinStatus === "pending"
            ? "You'll be able to send messages as soon as it's approved."
            : "Only members can read and send messages here."}
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
      initialReactions={initialReactions}
      allowAnonymous={allowAnonymous}
      canModerate={canModerate}
      paginated={paginated}
      hasMoreHistory={hasMoreHistory}
    />
  );
}
