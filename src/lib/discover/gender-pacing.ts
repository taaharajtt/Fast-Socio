// ===========================================================================
// Gender pacing for the SOCIO half of the Discover deck.
//
// POLICY. A viewer whose own normalized gender is `female` sees student
// profile cards paced towards a repeating 2:1 rhythm —
//
//     female, female, other, female, female, other, ...
//
// "other" is EVERY eligible candidate who is not female: male,
// `prefer_not_to_say`, null, and any unrecognised value. There are exactly two
// buckets, never three.
//
// WHAT THIS IS NOT. It is not a filter and it is not a score. Eligibility,
// safety exclusions and the compatibility percentage are all untouched —
// gender contributes ZERO points to the number (see `match-score.ts`). This
// only reorders candidates that were already going to be shown.
//
// AUTHORITY. `public.get_discover_candidates` (migration 0158) is
// authoritative: it applies this pacing over the whole eligible candidate set
// BEFORE its `limit`, so a female candidate who ranked past position 20 can be
// promoted into the page. This module is the executable specification of that
// SQL — same bucketing, same slot arithmetic, same fallback — so the policy can
// be unit-tested without a database, and so the two cannot drift silently.
//
// FALLBACK. Slots are assigned per bucket and then sorted; a bucket that runs
// out simply stops claiming slots and the other bucket flows on in its own
// ranked order. The deck therefore never shrinks and never empties because one
// bucket is thin.
// ===========================================================================

/** How many female cards, then how many others, per repeating cycle. */
export const FEMALE_RUN = 2;
export const OTHER_RUN = 1;
const CYCLE = FEMALE_RUN + OTHER_RUN;

/**
 * Anything the pacer needs to read off a candidate.
 *
 * `tier` mirrors the RPC's fresh (0) vs recycled-pass (1) tier. Pacing runs
 * INSIDE a tier, never across one, so every fresh candidate still precedes
 * every recycled one. Omitted means "one tier".
 */
export type PacingCandidate = { gender?: string | null; tier?: number | null };

/**
 * Two buckets, mirroring SQL `lower(nullif(btrim(gender), '')) = 'female'`.
 * Null, `prefer_not_to_say` and unknown strings are all "other".
 */
export function pacingBucket(gender?: string | null): "female" | "other" {
  return (gender ?? "").trim().toLowerCase() === "female" ? "female" : "other";
}

/** True only for a viewer the policy applies to. */
export function isPacedViewer(viewerGender?: string | null): boolean {
  return pacingBucket(viewerGender) === "female";
}

/**
 * The 1-based deck slot a candidate claims, given its 1-based rank WITHIN its
 * own bucket. Female ranks take the two leading slots of each cycle, others
 * take the trailing one — so female slots are ≡1,2 (mod 3) and other slots are
 * ≡0 (mod 3) and the two can never collide.
 */
export function pacedSlot(bucket: "female" | "other", rank: number): number {
  if (bucket === "other") return rank * CYCLE;
  const i = rank - 1;
  return Math.floor(i / FEMALE_RUN) * CYCLE + (i % FEMALE_RUN) + 1;
}

/**
 * Reorder an ALREADY-RANKED candidate list into the 2:1 rhythm, preserving
 * relative ranking quality inside each bucket. Pure and stable: equal inputs
 * always give the same output, and the input array is not mutated.
 */
export function paceFemaleViewerDeck<T extends PacingCandidate>(
  ranked: readonly T[]
): T[] {
  // Per-tier bucket counters: the rhythm restarts in the recycle round rather
  // than continuing a cycle from the fresh one.
  const counts = new Map<number, { female: number; other: number }>();
  const tierOrder: number[] = [];
  return ranked
    .map((candidate, index) => {
      const tier = candidate.tier ?? 0;
      let c = counts.get(tier);
      if (!c) {
        c = { female: 0, other: 0 };
        counts.set(tier, c);
        tierOrder.push(tier);
      }
      const bucket = pacingBucket(candidate.gender);
      const rank = bucket === "female" ? ++c.female : ++c.other;
      return {
        candidate,
        index,
        tierRank: tierOrder.indexOf(tier),
        slot: pacedSlot(bucket, rank),
      };
    })
    .sort(
      (a, b) =>
        a.tierRank - b.tierRank || a.slot - b.slot || a.index - b.index
    )
    .map((entry) => entry.candidate);
}

/**
 * The whole policy: paced for a female viewer, byte-identical passthrough for
 * everyone else (male, `prefer_not_to_say`, null, unrecognised).
 */
export function paceCandidatesForViewer<T extends PacingCandidate>(
  ranked: readonly T[],
  viewerGender?: string | null
): T[] {
  return isPacedViewer(viewerGender) ? paceFemaleViewerDeck(ranked) : [...ranked];
}
