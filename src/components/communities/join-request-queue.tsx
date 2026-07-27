"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { decideJoinRequest } from "@/app/(student)/communities/actions";
import type { JoinRequestVM } from "@/lib/communities/relationship";

/**
 * The access queue: students who asked to participate and are waiting on an
 * owner / moderator / officer. Approving grants a community_members row (and
 * with it the right to send messages); declining leaves them a follower.
 */
export function JoinRequestQueue({
  communityId,
  requests,
}: {
  communityId: string;
  requests: JoinRequestVM[];
}) {
  const [decided, setDecided] = useState<Record<string, "approved" | "declined">>({});
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) {
    return <p className="text-sm text-fg-muted">No one is waiting to join.</p>;
  }

  function decide(userId: string, approve: boolean) {
    setDecided((prev) => ({ ...prev, [userId]: approve ? "approved" : "declined" }));
    start(async () => {
      const res = await decideJoinRequest(communityId, userId, approve);
      if (!res.ok) {
        setError(res.error);
        setDecided((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }
    });
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-error">{error}</p>}
      {requests.map((r) => {
        const name = r.full_name ?? r.username ?? "Student";
        const outcome = decided[r.user_id];
        return (
          <div key={r.user_id} className="flex items-center gap-3 rounded-[14px] bg-card p-3">
            <Link
              href={`/profile/${r.user_id}`}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold text-fg-muted"
            >
              {r.avatar_url ? (
                <AppImage src={r.avatar_url} alt="" sizes="36px" />
              ) : (
                name.charAt(0).toUpperCase()
              )}
            </Link>
            <Link href={`/profile/${r.user_id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-fg">{name}</span>
              {r.username && (
                <span className="block truncate text-xs text-fg-muted">@{r.username}</span>
              )}
            </Link>

            {outcome ? (
              <span className="shrink-0 text-xs font-semibold text-fg-muted">
                {outcome === "approved" ? "Approved" : "Declined"}
              </span>
            ) : (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => decide(r.user_id, false)}
                  disabled={pending}
                  aria-label={`Decline ${name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-fg-muted disabled:opacity-60"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => decide(r.user_id, true)}
                  disabled={pending}
                  aria-label={`Approve ${name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white disabled:opacity-60"
                >
                  <Check className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
