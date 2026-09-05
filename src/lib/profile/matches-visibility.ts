/**
 * Who may open whose matches list (mig 0182).
 *
 * The rule lives here rather than inline in the two profile pages so both ask
 * the same question, and so it can be tested without a database.
 *
 * THIS IS NOT THE AUTHORISATION. `get_matches_of()` re-derives every one of
 * these conditions server-side and returns an empty set when they do not hold,
 * so a hand-typed URL or a direct RPC call gets nothing. What this decides is
 * whether the Matches stat is a LINK — an affordance, not a permission.
 */
export function matchesHref({
  profileId,
  isSelf,
  matched,
  showMatches,
}: {
  profileId: string;
  /** The viewer is looking at their own profile. */
  isSelf: boolean;
  /** The viewer is CURRENTLY matched with this profile (authoritative read). */
  matched: boolean;
  /**
   * The profile owner's `show_matches` preference. `null`/`undefined` means the
   * column was not read (or predates the migration) and is treated as visible,
   * matching the column default.
   */
  showMatches?: boolean | null;
}): string | undefined {
  // The owner always reaches their own list, whatever their preference says.
  if (isSelf) return "/profile/matches";
  if (!matched) return undefined;
  if (showMatches === false) return undefined;
  return `/profile/matches/${profileId}`;
}
