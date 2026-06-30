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
};
