/**
 * Profile ("Me") tab model. The profile used to carry a Communities tab that
 * listed the joined communities; that surface was removed (the global
 * Communities feature is untouched — this is only the profile listing). The
 * profile now has Posts | Help | Stats, and Help/Stats render only when their
 * data is supplied (i.e. on your own profile), so a public profile is Posts-only.
 */
export const PROFILE_TABS = ["posts", "help", "stats"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function isProfileTab(v: unknown): v is ProfileTab {
  return typeof v === "string" && (PROFILE_TABS as readonly string[]).includes(v);
}

/**
 * The tabs actually rendered given the data available. Posts is always present.
 * Stats appears whenever its data is passed. Help is gated on BOTH `help` data
 * being supplied AND `isOwnProfile` — a viewer's own Campus Help activity
 * (requests, offers, anonymous asks, resolved history) must never be reachable
 * from someone else's profile, even if a caller ever passed help data by
 * mistake. This is defense in depth: today only the owner's `/profile` page
 * builds `helpContent` at all, but the gate does not rely on that alone.
 */
export function availableProfileTabs(opts: {
  help: boolean;
  stats: boolean;
  isOwnProfile: boolean;
}): ProfileTab[] {
  const tabs: ProfileTab[] = ["posts"];
  if (opts.help && opts.isOwnProfile) tabs.push("help");
  if (opts.stats) tabs.push("stats");
  return tabs;
}

/**
 * Resolve the initial tab from a raw `?tab=` value: it must be a real, currently
 * available tab, otherwise fall back to Posts. The retired `communities` value
 * (and anything else unknown) therefore lands on Posts.
 */
export function resolveInitialProfileTab(
  raw: unknown,
  available: ProfileTab[]
): ProfileTab {
  return isProfileTab(raw) && available.includes(raw) ? raw : "posts";
}
