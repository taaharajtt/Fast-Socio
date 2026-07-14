"use client";

import { useEffect, useState, useTransition } from "react";
import { BarChart3, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchPostPoll,
  votePostPoll,
  type PostPollOption,
} from "@/app/(student)/home/actions";

/**
 * A poll attached to a feed post. Tallies are always visible (this is the campus
 * feed, not a secret ballot); *who* voted for what is not — post_poll_votes only
 * lets a voter read their own row, and results arrive pre-aggregated from a
 * definer view. Loads its own results on mount so the post card stays a cheap,
 * memoized shell.
 */
export function PostPoll({ pollId }: { pollId: string }) {
  const [options, setOptions] = useState<PostPollOption[] | null>(null);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let active = true;
    fetchPostPoll(pollId).then((rows) => {
      if (active) setOptions(rows);
    });
    return () => {
      active = false;
    };
  }, [pollId]);

  if (options === null) {
    return (
      <div className="mt-2.5 flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading poll…
      </div>
    );
  }

  const chosen =
    optimistic ?? options.find((o) => o.voted_by_me)?.option_id ?? null;
  const previous = options.find((o) => o.voted_by_me)?.option_id ?? null;

  // Reflect the optimistic move in the tallies too, so the bar and the count
  // move together instead of the count lagging a beat behind.
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
    const rollback = optimistic;
    setOptimistic(optionId);
    start(async () => {
      const res = await votePostPoll(pollId, optionId);
      if (!res.ok) setOptimistic(rollback);
    });
  }

  return (
    <div className="mt-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-disabled">
        <BarChart3 className="h-3.5 w-3.5" aria-hidden />
        Poll
      </div>

      <div className="space-y-1.5">
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
              className="relative block w-full overflow-hidden rounded-[10px] bg-bg-elevated px-3 py-2.5 text-left text-sm transition-transform active:scale-[0.99] disabled:opacity-70"
            >
              {/* Fill bar sits behind the label, sized to the option's share. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 transition-[width] duration-300",
                  picked ? "bg-accent/35" : "bg-accent/15"
                )}
                style={{ width: `${share}%` }}
              />
              <span className="relative flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {o.label}
                </span>
                {picked && (
                  <Check
                    className="h-4 w-4 shrink-0 text-accent"
                    strokeWidth={3}
                    aria-hidden
                  />
                )}
                {/* Show the raw tally next to the share — a percentage alone
                    hides whether "50%" means 1 vote or 100. */}
                <span className="shrink-0 text-xs font-semibold tabular-nums text-fg-muted">
                  {o.votes} {o.votes === 1 ? "vote" : "votes"} · {share}%
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-fg-disabled">
        {total} vote{total === 1 ? "" : "s"}
        {chosen ? "" : " · tap to vote"}
      </p>
    </div>
  );
}
