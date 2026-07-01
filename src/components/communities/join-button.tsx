"use client";

import { useTransition } from "react";
import { GlassButton } from "@/components/ui";
import {
  joinCommunity,
  leaveCommunity,
} from "@/app/(student)/communities/actions";

export function JoinButton({
  communityId,
  isMember,
  isOwner,
}: {
  communityId: string;
  isMember: boolean;
  isOwner: boolean;
}) {
  const [pending, start] = useTransition();

  if (isOwner) {
    return (
      <GlassButton variant="glass" size="sm" disabled>
        Owner
      </GlassButton>
    );
  }

  return (
    <GlassButton
      variant={isMember ? "glass" : "primary"}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (isMember) await leaveCommunity(communityId);
          else await joinCommunity(communityId);
        })
      }
    >
      {pending ? "…" : isMember ? "Leave" : "Join"}
    </GlassButton>
  );
}
