/** Public-facing profile shape returned by get_discover_candidates. */
export type DiscoverProfile = {
  id: string;
  full_name: string | null;
  department: string | null;
  semester: number | null;
  bio: string | null;
  avatar_url: string | null;
  aura_score: number;
  interests: string[];
  /** True when this candidate is a previously-liked profile being recycled
   *  because fresh candidates ran low (Discover never runs empty, P4-05). */
  is_recycled?: boolean;
};
