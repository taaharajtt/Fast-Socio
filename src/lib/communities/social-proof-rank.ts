/**
 * Pure ranking behind cover social proof — no React or Supabase, so it stays
 * unit-testable (see social-proof-rank.test.ts). getSocialProof() does the I/O
 * and delegates the ordering here.
 */

export type ProofCandidate = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  gender: string | null;
  department: string | null;
  degree: string | null;
};

export type Viewer = {
  matchedIds: ReadonlySet<string>;
  department: string | null;
  degree: string | null;
  /** Batch year digits from the viewer's roll number, e.g. "24". */
  batch: string | null;
};

/** Batch year from a roll number ("24i5525" / "i240733" → "24"). */
export function batchOf(username: string | null | undefined): string | null {
  if (!username) return null;
  return /^[^0-9]?(\d{2})/.exec(username)?.[1] ?? null;
}

/**
 * How much this person's face would move THIS viewer. People join what their
 * people are already in, so closeness to the viewer is the only axis:
 *
 *   match > programme mate (department + degree) > batchmate > department mate
 *
 * A face outranks a blank avatar at equal closeness, since the whole point is
 * recognition.
 */
export function proofScore(p: ProofCandidate, v: Viewer): number {
  let base = 0;
  if (v.matchedIds.has(p.id)) base = 40;
  else if (v.department && p.department === v.department && v.degree && p.degree === v.degree)
    base = 30;
  else if (v.batch && batchOf(p.username) === v.batch) base = 20;
  else if (v.department && p.department === v.department) base = 10;
  return base + (p.avatar_url ? 1 : 0);
}

/** First name only — "Ahmed, Sara and 15 others" should read like speech. */
export function firstName(p: ProofCandidate): string {
  return (p.full_name ?? p.username ?? "A student").trim().split(/\s+/)[0];
}

/** The `limit` most persuasive faces for this viewer, best first. */
export function rankProof(
  candidates: readonly ProofCandidate[],
  viewer: Viewer,
  limit: number
): ProofCandidate[] {
  return [...candidates]
    .map((p, i) => ({ p, i, s: proofScore(p, viewer) }))
    // Ties keep source order, so the list is stable between renders.
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map(({ p }) => p);
}
