"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Lock, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  pinSocietyAnnouncement,
  deleteSocietyAnnouncement,
} from "@/app/(student)/societies/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  showAuthorHeader = true,
}: {
  a: AnnouncementRow;
  /** Owner/officer/admin — may pin and delete any announcement. */
  canManage: boolean;
  /**
   * False when this message follows one from the same author in a thread —
   * the author/time row collapses to just the time, mirroring how consecutive
   * messages from one sender are grouped in the chat thread.
   */
  showAuthorHeader?: boolean;
}) {
  const [gone, setGone] = useState(false);
  const [pinned, setPinned] = useState(a.pinned);
  const [pending, start] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const canDelete = canManage || a.is_mine;

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (gone) return null;

  function remove() {
    setError(null);
    setGone(true);
    start(async () => {
      const res = await deleteSocietyAnnouncement(a.society_id, a.id);
      if (!res.ok) {
        setGone(false);
        setError(res.error);
        return;
      }
      setConfirming(false);
    });
  }

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
            {showAuthorHeader && (
              <>
                <span className="truncate">{a.author_name ?? "Officer"}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{timeAgo(a.created_at)}</span>
            {a.visibility === "members" && (
              <span className="flex items-center gap-0.5 text-warning">
                <Lock className="h-3 w-3" aria-hidden /> members
              </span>
            )}
          </p>
        </div>
        {(canManage || canDelete) && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={pending}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:text-fg"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="glass absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-[14px] p-1"
              >
                {canManage && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => {
                      setMenuOpen(false);
                      const next = !pinned;
                      setPinned(next);
                      start(async () => {
                        await pinSocietyAnnouncement(a.society_id, a.id, next);
                      });
                    }}
                    className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm font-medium text-fg hover:bg-white/10"
                  >
                    {pinned ? (
                      <PinOff className="h-4 w-4" aria-hidden />
                    ) : (
                      <Pin className="h-4 w-4" aria-hidden />
                    )}
                    {pinned ? "Unpin announcement" : "Pin announcement"}
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirming(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm font-medium text-error hover:bg-error/10"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Delete announcement
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-fg/90">{a.body}</p>

      <ConfirmDialog
        open={confirming}
        title="Delete this announcement?"
        description="This can't be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
        pending={pending}
        error={error}
      />
    </article>
  );
}
