/**
 * Human labels for aura_reason enum values.
 *
 * These are the strings the Aura breakdown on /profile/aura renders, so every
 * reason the database can emit needs one — an unlabelled reason falls through
 * to the raw enum value and shows a student "comment_received".
 */
export const AURA_REASON_LABELS: Record<string, string> = {
  match: "Matches",
  event_attend: "Events attended",
  post_created: "Posts created",
  post_liked: "Posts liked",
  community_join: "Communities joined",
  daily_login: "Daily logins",
  profile_completed: "Profile completed",
  achievement: "Badges",
  admin_adjust: "Admin adjustments",
  help_thanked: "Helping others",
  comment_received: "Comments received",
  // The one-time 100 Aura gift written at account creation (migration 0191).
  // Deliberately worded as a gift, not an achievement: it is not earned.
  signup_bonus: "Welcome bonus",
};

export function auraReasonLabel(reason: string): string {
  return AURA_REASON_LABELS[reason] ?? reason;
}
