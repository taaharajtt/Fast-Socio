"use client";

import { useState, useTransition } from "react";
import { Check, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cancelJoinRequest,
  followCommunity,
  leaveCommunity,
  requestJoinCommunity,
  unfollowCommunity,
  type JoinState,
} from "@/app/(student)/communities/actions";

/**
 * The two distinct community actions, side by side (wireframe: a pair of pills
 * on the cover photo).
 *
 *   FOLLOW  spectate — broadcasts and their notifications, instantly.
 *   JOIN    participate — send messages; the owner/moderators must approve, so
 *           this button spends time in a "Requested" state.
 *
 * They are deliberately styled apart: Follow is a quiet glass pill, Join is the
 * filled accent pill, so the higher-commitment action never looks like the
 * casual one. Optimistic state keeps the tap instant; the server actions
 * revalidate behind it.
 */
export function FollowJoinButtons({
  communityId,
  isFollowing,
  joinStatus,
  isOwner,
  tone = "onCover",
  size = "md",
}: {
  communityId: string;
  isFollowing: boolean;
  joinStatus: JoinState;
  isOwner: boolean;
  /** "onCover" sits over the hero image; "onCard" over the app background. */
  tone?: "onCover" | "onCard";
  size?: "sm" | "md";
}) {
  const [following, setFollowing] = useState(isFollowing);
  const [join, setJoin] = useState<JoinState>(joinStatus);
  const [pending, start] = useTransition();

  const pill = cn(
    "flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold transition-all active:scale-95 disabled:opacity-60",
    size === "sm" ? "px-3.5 py-1.5 text-[13px]" : "px-4 py-2 text-sm"
  );
  const quiet =
    tone === "onCover" ? "bg-white/15 text-white" : "bg-white/10 text-fg";

  if (isOwner) {
    return <span className={cn(pill, quiet)}>Owner</span>;
  }

  function toggleFollow() {
    const next = !following;
    setFollowing(next);
    start(async () => {
      if (next) await followCommunity(communityId);
      else await unfollowCommunity(communityId);
    });
  }

  function onJoin() {
    if (join === "joined") {
      setJoin("none");
      start(async () => {
        await leaveCommunity(communityId);
      });
      return;
    }
    if (join === "pending") {
      setJoin("none");
      start(async () => {
        await cancelJoinRequest(communityId);
      });
      return;
    }
    // "none" or a previous rejection — clearing the tombstone lets them re-ask.
    setJoin("pending");
    start(async () => {
      if (join === "rejected") await cancelJoinRequest(communityId);
      const res = await requestJoinCommunity(communityId);
      setJoin(res.ok ? res.status : "none");
      // Following is implied by asking, so mirror what the RPC just did.
      if (res.ok) setFollowing(true);
    });
  }

  const joinLabel =
    join === "joined"
      ? "Joined"
      : join === "pending"
        ? "Requested"
        : "Join";

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={toggleFollow}
        disabled={pending}
        aria-pressed={following}
        aria-label={following ? "Unfollow" : "Follow to see broadcasts"}
        className={cn(pill, following ? quiet : "bg-white/25 text-white")}
      >
        {following ? <Check className="h-4 w-4" aria-hidden /> : null}
        {following ? "Following" : "Follow"}
      </button>
      <button
        type="button"
        onClick={onJoin}
        disabled={pending}
        aria-label={
          join === "joined"
            ? "Leave this space"
            : join === "pending"
              ? "Cancel your join request"
              : "Request to join and chat"
        }
        className={cn(
          pill,
          join === "joined"
            ? quiet
            : join === "pending"
              ? "bg-warning/25 text-white"
              : "bg-accent text-white"
        )}
      >
        {join === "none" || join === "rejected" ? (
          <UserPlus className="h-4 w-4" aria-hidden />
        ) : null}
        {joinLabel}
      </button>
    </div>
  );
}
