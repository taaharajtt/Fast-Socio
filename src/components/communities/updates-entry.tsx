import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Community hub's door to /communities/updates.
 *
 * It sits directly under the header — the first thing on the tab the badge
 * belongs to — because the whole point of the redesign is that the number in
 * the dock has somewhere to go. With nothing waiting it stays, quietly: a
 * student should be able to find their history of requests and decisions
 * without first having to be badged into it.
 *
 * The count is the same integer the dock renders (both come from
 * `community_badge_count()` via the request-memoised bootstrap), so the two can
 * never disagree on this screen.
 */
export function UpdatesEntry({ unread }: { unread: number }) {
  const has = unread > 0;
  return (
    <Link
      href="/communities/updates"
      aria-label={
        has ? `Updates, ${unread} unread` : "Updates, nothing new"
      }
      className={cn(
        "pressable-subtle focus-ring mb-5 flex min-h-[56px] items-center gap-3 rounded-[var(--radius-card)] bg-card px-4 py-3",
        has && "ring-1 ring-aura/30"
      )}
    >
      <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted">
        <Bell className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fg">Updates</span>
        <span className="block truncate text-xs text-fg-muted">
          {has
            ? `${unread} waiting for you`
            : "Requests, decisions and announcements"}
        </span>
      </span>
      {has && (
        <span className="shrink-0 rounded-full bg-aura px-2 py-0.5 text-[11px] font-bold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
    </Link>
  );
}
