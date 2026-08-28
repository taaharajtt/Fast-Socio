"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { UserMinus } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { removeCommunityMember } from "@/app/(student)/communities/actions";
import type { CommunityMemberVM } from "@/components/communities/member-row";

/**
 * Manage-tab roster with a remove control. The RPC is the real authority: it
 * refuses to remove the owner or another manager, so a failed attempt surfaces
 * the server's reason rather than silently doing nothing.
 */
export function MemberAccessList({
  communityId,
  members,
}: {
  communityId: string;
  members: CommunityMemberVM[];
}) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const removable = members.filter((m) => m.role !== "owner");
  if (removable.length === 0) {
    return <p className="text-sm text-fg-muted">No other members yet.</p>;
  }

  function remove(userId: string) {
    setRemoved((prev) => new Set(prev).add(userId));
    start(async () => {
      const res = await removeCommunityMember(communityId, userId);
      if (!res.ok) {
        setError(res.error);
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
    });
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-error">{error}</p>}
      {removable.map((m) => {
        const name = m.full_name ?? m.username ?? "Member";
        const gone = removed.has(m.user_id);
        return (
          // Plain row, no card — matches the events attendee list rather
          // than stacking a bg-card panel behind every member.
          <div key={m.user_id} className="flex items-center gap-3 rounded-[12px] px-2 py-2.5 transition-colors hover:bg-card">
            <Link
              href={`/profile/${m.user_id}`}
              prefetch={false}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold text-fg-muted"
            >
              {resolveAvatarUrl(m.avatar_url, m.gender) ? (
                <AppImage src={resolveAvatarUrl(m.avatar_url, m.gender)!} alt="" sizes="36px" />
              ) : (
                name.charAt(0).toUpperCase()
              )}
            </Link>
            <Link href={`/profile/${m.user_id}`} prefetch={false} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-fg">{name}</span>
              {m.username && (
                <span className="block truncate text-xs text-fg-muted">@{m.username}</span>
              )}
            </Link>
            {gone ? (
              <span className="shrink-0 text-xs font-semibold text-fg-muted">Removed</span>
            ) : (
              <button
                type="button"
                onClick={() => remove(m.user_id)}
                disabled={pending}
                aria-label={`Remove ${name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-fg-muted disabled:opacity-60"
              >
                <UserMinus className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
