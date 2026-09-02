"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";

/**
 * Poll ballot inspection (UAT-17), for feed, community/chat-room and society
 * broadcast polls alike — one action, because a poll is a poll.
 *
 * AUTHORIZATION IS NOT HERE. It is in `poll_ballots` (mig 0178), a SECURITY
 * DEFINER function that resolves the poll's creator and refuses anyone else
 * before selecting a single vote row. That matters because the vote tables are
 * readable: gating this in the action, or by hiding the tap target, would leave
 * the underlying rows enumerable by a determined voter. The action is a thin
 * pass-through so there is exactly one place the rule lives.
 */
export type PollBallot = {
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  gender: string | null;
  optionId: string;
  optionLabel: string;
  votedAt: string;
};

export async function fetchPollBallots(
  pollId: string
): Promise<
  { ok: true; ballots: PollBallot[] } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase.rpc("poll_ballots", {
    p_poll_id: pollId,
  });
  if (error) {
    // The RPC distinguishes "not yours" from "not found"; both are reported to
    // the caller as the same refusal, so a non-owner cannot use the error text
    // to learn whether a poll id exists.
    return { ok: false, error: "Only the poll's creator can see who voted." };
  }

  const ballots: PollBallot[] = (
    (data ?? []) as {
      user_id: string | null;
      full_name: string | null;
      avatar_url: string | null;
      gender: string | null;
      option_id: string;
      label: string;
      voted_at: string;
    }[]
  ).map((r) => ({
    userId: r.user_id,
    // A deleted profile leaves its vote row (the FK cascades from profiles, so
    // in practice the row goes too) — but a NULL join result must still render
    // as a person-shaped row rather than as "null".
    name: r.full_name ?? "Former student",
    avatarUrl: r.avatar_url,
    gender: r.gender,
    optionId: r.option_id,
    optionLabel: r.label,
    votedAt: r.voted_at,
  }));

  return { ok: true, ballots };
}

/**
 * Whether the viewer created this poll — the ONLY thing that decides whether
 * the vote total is rendered as a tap target.
 *
 * Deliberately a separate, cheap call: asking for the ballots to find out
 * whether you may have them would mean every viewer of every poll attempted a
 * privileged read, and the refusals would be indistinguishable from real
 * failures in the logs.
 */
export async function isPollMine(pollId: string): Promise<boolean> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return false;
  const { data } = await supabase.rpc("poll_is_mine", { p_poll_id: pollId });
  return data === true;
}
