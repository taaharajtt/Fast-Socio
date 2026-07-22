"use client";

import { useState, useTransition } from "react";
import { Lock, Pin, PinOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  pinSocietyAnnouncement,
  deleteSocietyAnnouncement,
} from "@/app/(student)/societies/actions";
import type { AnnouncementRow } from "@/lib/societies/types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AnnouncementCard({
  a,
  canManage,
}: {
  a: AnnouncementRow;
  /** Owner/officer/admin — may pin and delete any announcement. */
  canManage: boolean;
}) {
  const [gone, setGone] = useState(false);
  const [pinned, setPinned] = useState(a.pinned);
  const [pending, start] = useTransition();
  const canDelete = canManage || a.is_mine;

  if (gone) return null;

  return (
    <article
      className={cn(
        "rounded-[14px] bg-card p-4",
        pinned && "ring-1 ring-accent/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {pinned && <Pin className="h-3.5 w-3.5 text-accent" aria-hidden />}
            <h3 className="truncate text-[15px] font-bold text-fg">{a.title}</h3>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="truncate">{a.author_name ?? "Officer"}</span>
            <span aria-hidden>·</span>
            <span>{timeAgo(a.created_at)}</span>
            {a.visibility === "members" && (
              <span className="flex items-center gap-0.5 text-warning">
                <Lock className="h-3 w-3" aria-hidden /> members
              </span>
            )}
          </p>
        </div>
        {(canManage || canDelete) && (
          <div className="flex shrink-0 items-center gap-1">
            {canManage && (
              <button
                type="button"
                aria-label={pinned ? "Unpin" : "Pin"}
                disabled={pending}
                onClick={() => {
                  const next = !pinned;
                  setPinned(next);
                  start(async () => {
                    await pinSocietyAnnouncement(a.society_id, a.id, next);
                  });
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:text-fg"
              >
                {pinned ? (
                  <PinOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Pin className="h-4 w-4" aria-hidden />
                )}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                aria-label="Delete"
                disabled={pending}
                onClick={() => {
                  if (!confirm("Delete this announcement?")) return;
                  setGone(true);
                  start(async () => {
                    const res = await deleteSocietyAnnouncement(a.society_id, a.id);
                    if (!res.ok) setGone(false);
                  });
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:text-error"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-fg/90">{a.body}</p>
    </article>
  );
}
