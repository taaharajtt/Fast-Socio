"use client";

import { useTransition } from "react";
import { GlassButton, GlassCard } from "@/components/ui";
import { moderateCommunity } from "@/app/admin/communities/actions";

export type PendingCommunity = {
  id: string;
  name: string;
  description: string | null;
  ownerName: string | null;
  createdAt: string;
};

export function CommunityModRow({ community }: { community: PendingCommunity }) {
  const [pending, start] = useTransition();

  return (
    <GlassCard className="p-4">
      <p className="font-semibold">{community.name}</p>
      {community.description && (
        <p className="mt-1 text-sm text-fg-muted">{community.description}</p>
      )}
      <p className="mt-1 text-xs text-fg-muted">
        by {community.ownerName ?? "unknown"} · {community.createdAt}
      </p>
      <div className="mt-3 flex gap-2">
        <GlassButton
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={() => start(async () => void (await moderateCommunity(community.id, true)))}
        >
          Approve
        </GlassButton>
        <GlassButton
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() => start(async () => void (await moderateCommunity(community.id, false)))}
        >
          Reject
        </GlassButton>
      </div>
    </GlassCard>
  );
}
