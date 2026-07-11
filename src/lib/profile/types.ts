/** Public-facing profile shape returned by get_discover_candidates. */
export type DiscoverProfile = {
  id: string;
  full_name: string | null;
  department: string | null;
  semester: number | null;
  bio: string | null;
  avatar_url: string | null;
  aura_score: number;
  /** Whether this candidate is a verified account (UISpec V3 §2.7). */
  verified?: boolean | null;
  interests: string[];
  /** True when this candidate is a previously-liked profile being recycled
   *  because fresh candidates ran low (Discover never runs empty, P4-05). */
  is_recycled?: boolean;
  /** Deterministic compatibility score 0–100 (Refactor Phase 4). */
  compatibility?: number;
  /** Interests this candidate shares with the viewer (Refactor Phase 4).
   *  Rendered as highlighted chips on the card. */
  shared_interests?: string[];
};
