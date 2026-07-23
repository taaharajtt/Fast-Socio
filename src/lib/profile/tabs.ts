/**
 * Profile ("Me") tab model. The profile is now purely personal identity: your
 * own profile shows Posts | Stats, and a public profile is Posts-only (no tab
 * switcher at all). Two surfaces that used to live here have moved out entirely:
 *   · Communities — the joined-community list was removed (the global
 *     Communities feature is untouched; only the profile listing is gone).
 *   · Help — Campus Help is its own product at /help, discovered from Home. It
 *     must never be reachable through a profile, least of all someone else's.
 * Stats renders only when its data is supplied (i.e. on your own profile).
 */
export const PROFILE_TABS = ["posts", "stats"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function isProfileTab(v: unknown): v is ProfileTab {
  return typeof v === "string" && (PROFILE_TABS as readonly string[]).includes(v);
}

/**
 * The tabs actually rendered given the data available. Posts is always present;
 * Stats appears only on your own profile (where its data is passed). A public
 * profile therefore resolves to `["posts"]` — a single tab, which the UI renders
 * without a tab switcher (see ProfileTabs).
 */
export function availableProfileTabs(opts: { stats: boolean }): ProfileTab[] {
  const tabs: ProfileTab[] = ["posts"];
  if (opts.stats) tabs.push("stats");
  return tabs;
}

/**
 * Resolve the initial tab from a raw `?tab=` value: it must be a real, currently
 * available tab, otherwise fall back to Posts. The retired `help` and
 * `communities` values (and anything else unknown, or `stats` on a public
 * profile) therefore all land on Posts.
 */
export function resolveInitialProfileTab(
  raw: unknown,
  available: ProfileTab[]
): ProfileTab {
  return isProfileTab(raw) && available.includes(raw) ? raw : "posts";
}
