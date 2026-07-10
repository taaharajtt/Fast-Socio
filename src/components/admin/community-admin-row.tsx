"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { StatusDot, ctrl, ctrlDanger } from "@/components/admin/kit";
import { moderateCommunity, deleteCommunity } from "@/app/admin/communities/actions";

export type AdminCommunity = {
  id: string;
  name: string;
  description: string | null;
  ownerName: string | null;
  memberCount: number;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

const tone: Record<AdminCommunity["status"], string> = {
  pending: "warning",
  approved: "success",
  rejected: "neutral",
};

export function CommunityAdminRow({
  community,
  isSuper,
}: {
  community: AdminCommunity;
  isSuper: boolean;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const act = (fn: () => Promise<{ error: string } | void>) => {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res?.error) setErr(res.error);
    });
  };

  return (
    <div className="rounded-[4px] border border-glass-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-fg">{community.name}</p>
          {community.description && (
            <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{community.description}</p>
          )}
          <p className="mt-1 font-mono text-[11px] text-fg-muted">
            by {community.ownerName ?? "unknown"} · {community.memberCount} members · {community.createdAt}
          </p>
          {err && <p className="mt-1 font-mono text-[11px] text-error">{err}</p>}
        </div>
        <StatusDot tone={tone[community.status]} label={community.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {community.status === "pending" && (
          <>
            <button className={ctrl} disabled={pending} onClick={() => act(() => moderateCommunity(community.id, true))}>
              Approve
            </button>
            <button className={ctrlDanger} disabled={pending} onClick={() => act(() => moderateCommunity(community.id, false))}>
              Reject
            </button>
          </>
        )}
        <Link href={`/communities/${community.id}`} className={ctrl}>
          View →
        </Link>
        {isSuper && (
          <button
            className={`${ctrlDanger} ml-auto`}
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Delete community "${community.name}"? This is logged and cannot be undone.`))
                act(() => deleteCommunity(community.id));
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
