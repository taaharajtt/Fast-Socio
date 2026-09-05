"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarClock,
  CheckCheck,
  Megaphone,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { GlassButton } from "@/components/ui";
import { setCommunityBadge } from "@/lib/community/badge-store";
import {
  markAllCommunityUpdatesRead,
  markCommunityUpdateRead,
  loadMoreCommunityUpdates,
} from "@/app/(student)/communities/updates/actions";
import type { CommunityUpdate } from "@/lib/community/updates";
import { cn } from "@/lib/utils";

/** One glyph per kind of update. Unknown types fall back to the bell rather
 *  than rendering nothing — `notifications.type` is untyped text. */
const TYPE_ICON: Record<string, LucideIcon> = {
  community_join_request: UserPlus,
  community_post_review: ShieldCheck,
  event_post_request: ShieldCheck,
  community_join_approved: UserPlus,
  community_join_rejected: UserPlus,
  community_approved: ShieldCheck,
  community_rejected: ShieldCheck,
  community_post_approved: ShieldCheck,
  community_post_rejected: ShieldCheck,
  society_role: ShieldCheck,
  society_role_removed: ShieldCheck,
  society_announcement: Megaphone,
  event_approved: CalendarClock,
  event_rejected: CalendarClock,
  event_updated: CalendarClock,
  event_reminder: CalendarClock,
  waitlist_promoted: CalendarClock,
};

/**
 * The Community Updates list.
 *
 * READ IS A DELIBERATE ACT. Opening this screen marks nothing — that is the
 * behaviour the old badge got wrong, where merely landing on /communities
 * silenced whole categories the student had never looked at. A row becomes read
 * when the student opens THAT row, or when they press Mark all read. Opening
 * one community does not touch another's.
 *
 * Each row is a real <Link>, so it keyboard-focuses, middle-clicks and
 * long-presses like a link; the mark-read is a side effect on the way out, not
 * a replacement for navigation. If the write fails the student still arrives at
 * the right screen and the row is simply still unread — the safe direction.
 *
 * THE BADGE IS NEVER DECREMENTED HERE. Every mutation returns the authoritative
 * count from the server and that is what reaches the store, so a row that had
 * already stopped counting (resolved by another manager, subject deleted)
 * cannot push the dock number below what is really waiting, and no path can
 * produce a negative or a NaN.
 */
export function CommunityUpdatesList({
  initialItems,
  initialCursor,
  initialHasMore,
}: {
  initialItems: CommunityUpdate[];
  initialCursor: string | null;
  initialHasMore: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [marking, startMarking] = useTransition();

  const unreadCount = items.filter((i) => i.unread).length;

  function open(item: CommunityUpdate) {
    if (!item.unread) return;
    // Optimistic locally so the row loses its highlight as it is left; the dock
    // takes the server's number, not this one.
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, unread: false } : i))
    );
    void markCommunityUpdateRead(item.id).then(
      (res) => setCommunityBadge(res.unread),
      () => {}
    );
  }

  function markAll() {
    setError(null);
    startMarking(async () => {
      const res = await markAllCommunityUpdatesRead();
      if (!res.ok) {
        setError("Couldn’t mark these as read — try again.");
        return;
      }
      setItems((prev) => prev.map((i) => ({ ...i, unread: false })));
      setCommunityBadge(res.unread);
    });
  }

  function loadMore() {
    if (!cursor) return;
    setError(null);
    start(async () => {
      try {
        const next = await loadMoreCommunityUpdates(cursor);
        setItems((prev) => {
          // Defensive de-dupe: a row read between pages can shift between the
          // two halves, and a duplicate key would be a React error.
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...next.items.filter((i) => !seen.has(i.id))];
        });
        setCursor(next.cursor);
        setHasMore(next.hasMore);
        setCommunityBadge(next.unread);
      } catch {
        setError("Couldn’t load more updates — try again.");
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center gap-2 px-8 text-center">
        <Bell className="h-8 w-8 text-fg-muted" aria-hidden />
        <p className="font-semibold text-fg">Nothing waiting</p>
        <p className="-mt-1 text-sm text-fg-muted">
          Join requests, announcements from your spaces and decisions about your
          submissions land here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {unreadCount > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-fg-muted">
            {unreadCount} unread
          </p>
          <GlassButton
            size="sm"
            onClick={markAll}
            disabled={marking}
            aria-label="Mark all updates as read"
          >
            <CheckCheck className="h-4 w-4" aria-hidden />
            {marking ? "Marking…" : "Mark all as read"}
          </GlassButton>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 text-xs font-medium text-error">
          {error}
        </p>
      )}

      <ul className="divide-y divide-glass-border border-y border-glass-border">
        {items.map((item) => {
          const Icon = TYPE_ICON[item.type] ?? Bell;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                prefetch={false}
                onClick={() => open(item)}
                aria-label={
                  item.unread ? `Unread: ${item.text}` : item.text
                }
                // 44px minimum tap target, and the whole row is the target.
                className={cn(
                  "pressable-subtle focus-ring flex min-h-[56px] items-center gap-3 px-1 py-3",
                  item.unread && "bg-surface-active/40"
                )}
              >
                <span className="relative shrink-0">
                  <span className="glass flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-fg-muted">
                    {item.avatar ? (
                      <AppImage src={item.avatar} alt="" sizes="40px" />
                    ) : (
                      <Icon className="h-5 w-5" aria-hidden />
                    )}
                  </span>
                  {/* Unread is carried by TWO channels, not colour alone: the
                      dot, and the row's own tint + weight below. */}
                  {item.unread && (
                    <span
                      aria-hidden
                      className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-bg bg-aura"
                    />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm text-fg",
                      item.unread ? "font-semibold" : "font-normal"
                    )}
                  >
                    {item.text}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span className="text-xs text-fg-muted">{item.timeAgo}</span>
                    {item.actionable && (
                      <span className="rounded-full bg-aura/15 px-1.5 py-0.5 text-[10px] font-bold text-aura">
                        Action needed
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <GlassButton size="sm" onClick={loadMore} disabled={pending}>
            {pending ? "Loading…" : "Load more"}
          </GlassButton>
        </div>
      )}
    </div>
  );
}
