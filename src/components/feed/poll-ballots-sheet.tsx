"use client";

import { useEffect, useState } from "react";
import { GlassSheet } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import {
  fetchPollBallots,
  isPollMine,
  type PollBallot,
} from "@/app/(student)/poll-actions";

/**
 * Who voted for what — for the poll's creator only (UAT-17).
 *
 * Two separate calls, on purpose. `isPollMine` decides whether the total is
 * even rendered as a button; `fetchPollBallots` is made only after a tap.
 * Asking for the ballots in order to discover whether you are allowed them
 * would mean every viewer of every poll attempted a privileged read on mount.
 *
 * Neither call is the security boundary — `poll_ballots` re-checks ownership in
 * the database — so a viewer who forges the request gets nothing.
 *
 * ANONYMITY: a poll can be attached to an anonymous broadcast or an anonymous
 * community message. The people listed here are the VOTERS, who chose openly by
 * voting; the anonymous author is not among the data this returns, so opening
 * the list can never unmask them.
 */
export function usePollOwnership(pollId: string): boolean {
  const [mine, setMine] = useState(false);
  useEffect(() => {
    let active = true;
    isPollMine(pollId).then((v) => {
      if (active) setMine(v);
    });
    return () => {
      active = false;
    };
  }, [pollId]);
  return mine;
}

function avatarOf(b: PollBallot): string | null {
  return resolveAvatarUrl(b.avatarUrl, b.gender);
}

export function PollBallotsSheet({
  pollId,
  open,
  onClose,
}: {
  pollId: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <GlassSheet open={open} onClose={onClose}>
      {/* Mounted only while open, so opening the sheet IS the reload: votes
          change, and a cached list of who voted is worse than a moment of
          loading. Clearing state in an effect would instead paint the previous
          poll's voters for one frame. */}
      {open && <BallotList pollId={pollId} />}
    </GlassSheet>
  );
}

function BallotList({ pollId }: { pollId: string }) {
  const [ballots, setBallots] = useState<PollBallot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchPollBallots(pollId).then((res) => {
      if (!active) return;
      if (res.ok) setBallots(res.ballots);
      else setError(res.error);
    });
    return () => {
      active = false;
    };
  }, [pollId]);

  // Grouped by option, in the option order the RPC returns (by position), so
  // the sheet reads in the same order as the poll itself.
  const groups = new Map<string, { label: string; voters: PollBallot[] }>();
  for (const b of ballots ?? []) {
    const g = groups.get(b.optionId) ?? { label: b.optionLabel, voters: [] };
    g.voters.push(b);
    groups.set(b.optionId, g);
  }

  return (
    <div className="space-y-3">
      <h3 className="type-title">Who voted</h3>

        {error && (
          <p role="alert" className="type-callout text-error">
            {error}
          </p>
        )}

        {!error && ballots === null && (
          <p className="type-callout text-fg-muted">Loading…</p>
        )}

        {!error && ballots !== null && ballots.length === 0 && (
          <p className="type-callout text-fg-muted">
            No votes yet. As soon as someone votes, they&apos;ll show up here.
          </p>
        )}

        {!error && ballots !== null && ballots.length > 0 && (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto overscroll-contain">
            {[...groups.entries()].map(([optionId, group]) => (
              <section key={optionId}>
                <h4 className="type-caption sticky top-0 bg-bg py-1 font-semibold uppercase tracking-wide text-fg-muted">
                  {group.label} · {group.voters.length}
                </h4>
                <ul className="mt-1 space-y-1">
                  {group.voters.map((v) => (
                    <li
                      key={`${optionId}:${v.userId ?? v.votedAt}`}
                      className="flex items-center gap-2.5"
                    >
                      {/* An avatar can genuinely be absent (no upload, no
                          gender default), so the well renders empty rather than
                          passing a null src into the image component. */}
                      <span className="glass relative h-8 w-8 shrink-0 overflow-hidden rounded-full">
                        {avatarOf(v) && (
                          <AppImage src={avatarOf(v)!} alt="" sizes="32px" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate type-callout">
                        {v.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
    </div>
  );
}
