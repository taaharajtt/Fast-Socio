/**
 * The match percentage (fix-037).
 *
 * ## Authority
 * **The SQL in migration 0158 is authoritative** (it supersedes 0140/0157).
 * `get_discover_candidates` computes
 * `compatibility` server-side because it also orders the deck by it, and the swipe card
 * renders whatever the RPC returns. This module is the executable specification of that
 * SQL: same weights, same clamp, same tie-breaks. `match-score.test.ts` pins the shape
 * so the two cannot drift silently. If you change one, change both.
 *
 * ## Weights (total 100 before clamping)
 * | signal                     | weight | notes                                       |
 * |----------------------------|--------|---------------------------------------------|
 * | shared interests           | 65     | dominant term, asymptotic — never reaches 65 |
 * | same semester              | 13     | exact match, derived from the roll number   |
 * | **different** school       | 12     | cross-school pairings are favoured          |
 * | same batch                 | 10     | intake year from the roll number            |
 *
 * ## Gender is NOT a scoring signal
 * The percentage used to add 15 points for an "opposite gender" pairing. It no longer
 * does: gender contributes exactly nothing to the number, and those 15 points were
 * redistributed to shared interests (50 → 65). Two profiles that differ only in gender
 * score identically. Gender-aware behaviour lives in ONE place now — the candidate
 * PACING policy in `gender-pacing.ts` / migration 0158, which changes the ORDER cards
 * are shown in for female viewers and never the displayed percentage.
 *
 * ## Three definitions, one formula
 * The same weights are inlined in the Discover deck RPC and in
 * public.match_percentage (the matches page). Migration 0158 moves all of them
 * together; if you change one, change all three.
 *
 * ## The interests term
 * `9 × min(s, 6)` for the first six shared interests, then a bonus of
 * `11 × e / (e + 6)` where `e = max(s - 6, 0)`.
 *
 * The bonus is a hyperbola, so it approaches 11 but never arrives: six shared interests
 * scores 54, twelve scores 59.5, twenty-four scores 62.7, and forty scores 63.5. Someone
 * who ticks every interest in the list therefore cannot max the term out, which is the
 * point — a saturating cap would make "picked everything" indistinguishable from
 * "genuinely aligned".
 *
 * ## Unknowns are worth zero, never partial credit
 * Every categorical signal requires the value to be present on BOTH sides. A missing
 * department, semester or batch contributes 0 rather than a guess, so an incomplete
 * profile can never inflate a score.
 *
 * ## Properties
 * - **Deterministic.** Pure function of the two profiles; the same pair always scores the same.
 * - **Symmetric.** Every signal is symmetric, so score(a, b) === score(b, a).
 * - **Gender-blind.** No term reads `gender` at all.
 * - **Clamped to 5..99**, so the number never reads as broken (no 0%, no 100%).
 */

/** Only the fields the score actually reads. */
export type MatchScoreInput = {
  /** Chosen interest tags. Compared as a set; order and duplicates are irrelevant. */
  interests?: string[] | null;
  /** School/faculty. This codebase has no `school` column — `department` is it. */
  department?: string | null;
  /** Derived from the roll number, NOT the stale `profiles.semester` column. */
  semester?: number | null;
  /** Intake year from the roll number, e.g. 22 for i22xxxx. */
  batchYear?: number | null;
};

export const MATCH_WEIGHTS = {
  interestsBase: 9,
  interestsPlateau: 6,
  interestsBonus: 11,
  sameSemester: 13,
  differentSchool: 12,
  sameBatch: 10,
} as const;

export const MATCH_SCORE_MIN = 5;
export const MATCH_SCORE_MAX = 99;

/** Intake year from a roll number, mirroring SQL `public.roll_batch_year`. */
export function rollBatchYear(username?: string | null): number | null {
  const m = /^[^0-9]?(\d\d)/.exec(username ?? "");
  return m ? Number(m[1]) : null;
}

/** Size of the intersection of two interest sets. */
export function sharedInterestCount(
  a?: string[] | null,
  b?: string[] | null
): number {
  if (!a?.length || !b?.length) return 0;
  const seen = new Set(b);
  // Dedupe `a` so a repeated tag can't be counted twice.
  return new Set(a.filter((t) => seen.has(t))).size;
}

/** The interests term: 0 → just under 65. */
export function interestsTerm(shared: number): number {
  const w = MATCH_WEIGHTS;
  const s = Math.max(0, shared);
  const extra = Math.max(s - w.interestsPlateau, 0);
  return (
    w.interestsBase * Math.min(s, w.interestsPlateau) +
    (w.interestsBonus * extra) / (extra + w.interestsPlateau)
  );
}

/** Unrounded, unclamped total — exposed for testing and for explaining a score. */
export function rawMatchScore(a: MatchScoreInput, b: MatchScoreInput): number {
  const w = MATCH_WEIGHTS;
  let total = interestsTerm(sharedInterestCount(a.interests, b.interests));

  // NOTE: gender is deliberately absent. See the module header.

  if (a.semester != null && b.semester != null && a.semester === b.semester) {
    total += w.sameSemester;
  }

  // Deliberately inverted relative to intuition: a DIFFERENT school scores higher.
  if (a.department && b.department && a.department !== b.department) {
    total += w.differentSchool;
  }

  if (a.batchYear != null && b.batchYear != null && a.batchYear === b.batchYear) {
    total += w.sameBatch;
  }

  return total;
}

/** The published percentage: an integer in 5..99. */
export function matchScore(a: MatchScoreInput, b: MatchScoreInput): number {
  const raw = Math.round(rawMatchScore(a, b));
  return Math.min(MATCH_SCORE_MAX, Math.max(MATCH_SCORE_MIN, raw));
}
