import Link from "next/link";
import { MessageCircle, Users } from "lucide-react";
import { RequestJoinButton } from "@/components/communities/request-join-button";
import type { JoinState } from "@/app/(student)/communities/actions";

/**
 * A chat room's front page. It describes the room and hands you the one action
 * your current standing allows — open the conversation over in Chat, or ask to
 * be let in. The conversation itself is never embedded here; rooms are threads
 * in the Chat area now, next to direct messages.
 *
 * State is communicated by the button, not by a paragraph explaining the rules.
 */
export function RoomOverviewTab({
  communityId,
  description,
  memberCount,
  isMember,
  joinStatus,
}: {
  communityId: string;
  description: string | null;
  memberCount: number;
  isMember: boolean;
  joinStatus: JoinState;
}) {
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-1 text-sm font-semibold text-fg">Description</h2>
        <p className="whitespace-pre-wrap text-[14px] text-fg-muted">
          {description || "No description yet."}
        </p>
      </section>

      <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
        <Users className="h-4 w-4 shrink-0" aria-hidden />
        {memberCount.toLocaleString()} member{memberCount === 1 ? "" : "s"} can chat here
      </p>

      {isMember ? (
        <Link
          href={`/chat/c/${communityId}`}
          className="flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-white active:scale-95"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          Open chat
        </Link>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-[14px] bg-card px-5 py-8 text-center">
          <MessageCircle className="h-7 w-7 text-fg-muted" aria-hidden />
          <p className="text-sm text-fg-muted">
            {joinStatus === "pending"
              ? "Waiting on the owner to approve you."
              : "Joining unlocks the conversation in Chat."}
          </p>
          <RequestJoinButton communityId={communityId} joinStatus={joinStatus} />
        </div>
      )}
    </div>
  );
}
