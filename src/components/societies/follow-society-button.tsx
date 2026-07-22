"use client";

import { useState, useTransition } from "react";
import { Check, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { followSociety, unfollowSociety } from "@/app/(student)/societies/actions";

/** Follow / unfollow toggle for the society profile hero. */
export function FollowSocietyButton({
  societyId,
  isFollowing,
  isOwner,
}: {
  societyId: string;
  isFollowing: boolean;
  isOwner: boolean;
}) {
  const [following, setFollowing] = useState(isFollowing);
  const [pending, start] = useTransition();

  if (isOwner) {
    return (
      <span className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white">
        Owner
      </span>
    );
  }

  function toggle() {
    const next = !following;
    setFollowing(next);
    start(async () => {
      if (next) await followSociety(societyId);
      else await unfollowSociety(societyId);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={following}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-95 disabled:opacity-60",
        following ? "bg-white/15 text-white" : "bg-accent text-white"
      )}
    >
      {following ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <UserPlus className="h-4 w-4" aria-hidden />
      )}
      {following ? "Following" : "Follow"}
    </button>
  );
}
