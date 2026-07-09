"use client";

import { useTransition } from "react";
import { ctrl, ctrlDanger } from "@/components/admin/kit";
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
    <div className="rounded-[4px] border border-glass-border p-3">
      <p className="font-medium text-fg">{community.name}</p>
      {community.description && (
        <p className="mt-1 text-sm text-fg-muted">{community.description}</p>
      )}
      <p className="mt-1 font-mono text-[11px] text-fg-muted">
        by {community.ownerName ?? "unknown"} · {community.createdAt}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={ctrl}
          disabled={pending}
          onClick={() => start(async () => void (await moderateCommunity(community.id, true)))}
        >
          Approve
        </button>
        <button
          type="button"
          className={ctrlDanger}
          disabled={pending}
          onClick={() => start(async () => void (await moderateCommunity(community.id, false)))}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
