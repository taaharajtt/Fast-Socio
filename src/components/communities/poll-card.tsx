"use client";

import { useState, useTransition } from "react";
import { BarChart3, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PollOptionResult } from "@/app/(student)/communities/actions";

/**
 * A poll inside a community chat room (UAT-005).
 *
 * Results are always visible — this is a campus chat, not a secret ballot — but
 * *who* voted for what is not: `community_poll_votes` only lets a member read
 * their own row, and the tallies arrive pre-aggregated from a definer view.
 */
export function PollCard({
  question,
  options,
  mine,
  onVote,
}: {
  question: string;
  options: PollOptionResult[];
  /** Render inside the sender's own (gradient) bubble. */
  mine: boolean;
  onVote: (optionId: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  // Optimistic: the tap should fill the bar immediately, not after a round-trip.
  const [optimistic, setOptimistic] = useState<string | null>(null);

  const chosen =
    optimistic ?? options.find((o) => o.voted_by_me)?.option_id ?? null;

  // Reflect the optimistic move in the tallies too, otherwise the bar fills but
  // the count lags a beat behind and reads as a bug.
  const previous = options.find((o) => o.voted_by_me)?.option_id ?? null;
  const adjusted = options.map((o) => {
    let votes = o.votes;
    if (optimistic && optimistic !== previous) {
      if (o.option_id === optimistic) votes += 1;
      if (o.option_id === previous) votes -= 1;
    }
    return { ...o, votes: Math.max(0, votes) };
  });

  const total = adjusted.reduce((sum, o) => sum + o.votes, 0);

  function vote(optionId: string) {
    if (pending || optionId === chosen) return;
    setOptimistic(optionId);
    start(async () => {
      await onVote(optionId);
    });
  }

  return (
    <div className="w-[240px] max-w-full">
      <div
        className={cn(
          "mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide",
          mine ? "text-white/70" : "text-fg-disabled"
        )}
      >
        <BarChart3 className="h-3.5 w-3.5" aria-hidden />
        Poll
      </div>

      <p className={cn("text-[15px] font-semibold", mine ? "text-white" : "text-fg")}>
        {question}
      </p>

      <div className="mt-3 space-y-1.5">
        {adjusted.map((o) => {
          const share = total > 0 ? Math.round((o.votes / total) * 100) : 0;
          const picked = o.option_id === chosen;
          return (
            <button
              key={o.option_id}
              type="button"
              onClick={() => vote(o.option_id)}
              disabled={pending}
              aria-pressed={picked}
              className={cn(
                "relative block w-full overflow-hidden rounded-[8px] px-2.5 py-2 text-left text-[13px] transition-transform active:scale-[0.98] disabled:opacity-70",
                mine ? "bg-white/15" : "bg-bg-elevated"
              )}
            >
              {/* Fill bar sits behind the label, sized to the option's share. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 transition-[width] duration-300",
                  mine ? "bg-white/25" : picked ? "bg-accent/35" : "bg-accent/15"
                )}
                style={{ width: `${share}%` }}
              />
              <span className="relative flex items-center gap-1.5">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium",
                    mine ? "text-white" : "text-fg"
                  )}
                >
                  {o.label}
                </span>
                {picked && (
                  <Check
                    className={cn("h-3.5 w-3.5 shrink-0", mine ? "text-white" : "text-accent")}
                    strokeWidth={3}
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "shrink-0 text-[11px] font-semibold tabular-nums",
                    mine ? "text-white/80" : "text-fg-muted"
                  )}
                >
                  {share}%
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p
        className={cn(
          "mt-2 text-[11px]",
          mine ? "text-white/60" : "text-fg-disabled"
        )}
      >
        {total} vote{total === 1 ? "" : "s"}
        {chosen ? "" : " · tap to vote"}
      </p>
    </div>
  );
}
