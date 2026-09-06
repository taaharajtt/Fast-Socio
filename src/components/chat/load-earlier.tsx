"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HistoryStatus } from "@/lib/chat/history";

/**
 * The "Load earlier messages" capsule, above the oldest loaded message.
 *
 * ONE component for the community room, the event discussion and the broadcast
 * channel, so the three cannot drift into three slightly different pills.
 *
 * IT IS A BUTTON, not a tappable div: it has to be reachable by keyboard, carry
 * an accessible name that says what it does, and take a visible focus ring.
 * `aria-busy` is what tells a screen reader the press was heard while the
 * fetch is in flight — the spinner alone says nothing to one.
 *
 * DELIBERATELY SMALL. It sits inside a conversation, not above one: no card, no
 * separator rule, no header. Muted text on the existing glass surface, the same
 * pill geometry as the rest of the chrome.
 *
 * Nothing renders at all when the history is exhausted — the reader should
 * never be looking at a control that cannot do anything.
 */
export function LoadEarlier({
  status,
  onLoad,
  className,
}: {
  status: HistoryStatus;
  onLoad: () => void;
  className?: string;
}) {
  if (status === "exhausted") return null;

  const loading = status === "loading";
  const failed = status === "error";

  return (
    <div className={cn("flex justify-center py-1", className)}>
      <button
        type="button"
        onClick={onLoad}
        disabled={loading}
        aria-busy={loading}
        // The name changes with the state so a screen reader hears the retry
        // rather than being told again to load what just failed.
        aria-label={
          failed
            ? "Couldn't load earlier messages. Try again"
            : "Load earlier messages"
        }
        className={cn(
          "glass inline-flex items-center gap-1.5 rounded-full px-3 py-1",
          "text-[12px] font-medium text-fg-muted transition-colors",
          "hover:text-fg focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-accent/60 disabled:opacity-60",
          failed && "text-warning"
        )}
      >
        {loading && (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        )}
        {loading
          ? "Loading…"
          : failed
            ? "Couldn't load. Tap to retry"
            : "Load earlier messages"}
      </button>
    </div>
  );
}
