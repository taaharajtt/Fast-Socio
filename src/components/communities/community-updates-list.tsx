"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { UpdateAvatar } from "@/components/communities/update-avatar";
import { setCommunityBadge } from "@/lib/community/badge-store";
import {
  markAllCommunityUpdatesRead,
  markCommunityUpdateRead,
  loadMoreCommunityUpdates,
} from "@/app/(student)/communities/updates/actions";
import { groupUpdatesByDate, type CommunityUpdate } from "@/lib/community/updates";
import { cn } from "@/lib/utils";

/**
 * The Community Updates feed.
 *
 * A NOTIFICATION FEED, NOT A TABLE. The previous version drew every row inside
 * a bordered list with hairline separators and a 44px avatar, which made six
 * updates look like a settings screen. What replaces it is the shape the rest
 * of the app already uses for people: a large circular photo, a small category
 * badge notched into its corner, and a sentence whose important words carry the
 * weight. Nothing separates the rows but space.
 *
 * READ IS A DELIBERATE ACT. Opening this screen marks nothing — that is the
 * behaviour the old badge got wrong, where landing on /communities silenced
 * whole categories the student had never looked at. A row becomes read when the
 * student opens THAT row, or presses Mark all as read.
 *
 * Each row is a real <Link>: it keyboard-focuses, middle-clicks and
 * long-presses like a link, and the mark-read is a side effect on the way out
 * rather than a replacement for navigation. If the write fails the student
 * still arrives at the right screen and the row is simply still unread — the
 * safe direction.
 *
 * THE BADGE IS NEVER DECREMENTED HERE. Every mutation returns the authoritative
 * count from the server and that is what reaches the store, so a row that had
 * already stopped counting cannot push the dock number below what is really
 * waiting, and no path can produce a negative or a NaN.
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
  // Grouped over the WHOLE accumulated list, so a second page of today's rows
  // extends the TODAY section instead of emitting a second TODAY heading.
  const sections = groupUpdatesByDate(items);

  function open(item: CommunityUpdate) {
    if (!item.unread) return;
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
      <div className="mt-16 flex flex-col items-center gap-2 px-8 text-center">
        <Bell className="h-8 w-8 text-fg-disabled" aria-hidden />
        <p className="font-semibold text-fg">Nothing waiting</p>
        <p className="-mt-1 text-sm text-fg-muted">
          Messages, posts and decisions from your spaces land here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {unreadCount > 0 && (
        <div className="mb-1 flex items-center justify-between gap-3">
          <p className="text-xs text-fg-muted">{unreadCount} unread</p>
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

      {sections.map((section) => (
        <section key={section.bucket}>
          {/* Uppercase, muted, letter-spaced — a label, not a divider. */}
          <h2 className="mb-1 mt-7 text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-muted first:mt-3">
            {section.bucket}
          </h2>

          <ul>
            {section.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  prefetch={false}
                  onClick={() => open(item)}
                  aria-label={item.unread ? `Unread: ${item.text}` : item.text}
                  className={cn(
                    "pressable-subtle focus-ring -mx-2 flex items-center gap-3.5 rounded-2xl px-2 py-4",
                    // Unread is carried by tint + weight + the dot, never by a
                    // border or a card.
                    item.unread && "bg-surface-active/50"
                  )}
                >
                  <UpdateAvatar src={item.avatar} alt="" type={item.type} />

                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-[15px] leading-snug",
                        item.unread ? "text-fg" : "text-fg-muted"
                      )}
                    >
                      {item.segments.map((seg, i) => (
                        <span
                          key={i}
                          className={
                            seg.strong ? "font-semibold text-fg" : undefined
                          }
                        >
                          {seg.text}
                        </span>
                      ))}
                    </span>

                    {item.actionable && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-aura">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full bg-aura"
                        />
                        Action needed
                      </span>
                    )}
                  </span>

                  {/* Right rail: the time, with the unread dot beneath it.
                      `shrink-0` so a long name wraps rather than squeezing the
                      timestamp into a truncated column. */}
                  <span className="flex shrink-0 flex-col items-end gap-1.5 self-center">
                    <span className="text-[13px] text-fg-muted">
                      {item.timeAgo}
                    </span>
                    {item.unread && (
                      <span aria-hidden className="h-2 w-2 rounded-full bg-aura" />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <GlassButton size="sm" onClick={loadMore} disabled={pending}>
            {pending ? "Loading…" : "Load more"}
          </GlassButton>
        </div>
      )}
    </div>
  );
}
