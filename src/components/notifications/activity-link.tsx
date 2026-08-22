"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useActivityBadge } from "@/lib/notifications/badge-store";

/**
 * The Activity button in the /home header.
 *
 * Moved out of home/page.tsx and made a client component for one reason: the
 * unread dot has to react to <NotificationsRealtime/>. As a server component it
 * could only change when its Suspense boundary re-rendered, which on this app
 * meant a navigation or a reload — so a like arriving while the student was
 * sitting on the feed never lit the bell.
 *
 * The server-rendered count is still the first paint and still the fallback;
 * the store only overrides it once realtime (or a push message) knows better.
 */
export function ActivityLink({ unread = 0 }: { unread?: number }) {
  const live = useActivityBadge(unread);

  return (
    <Link
      href="/activity"
      data-tour="activity"
      aria-label={live ? `Activity, ${live} unread` : "Activity"}
      className="pressable focus-ring relative flex h-10 w-10 items-center justify-center rounded-full text-fg hover:text-accent"
    >
      <Bell className="h-[22px] w-[22px]" strokeWidth={1.9} aria-hidden />
      {/*
        A dot, not a number. The exact count of unread activity does not change
        what you do next — you either have some or you don't — and a two-digit
        badge on a 22px glyph crowds the glyph it is meant to annotate. The
        count still reaches screen readers through the link's accessible name
        above (apple.md 16: feedback should be as loud as it is useful).
      */}
      {live > 0 && (
        <span
          className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-bg"
          aria-hidden
        />
      )}
    </Link>
  );
}
