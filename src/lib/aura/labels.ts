/** Human labels for aura_reason enum values. */
export const AURA_REASON_LABELS: Record<string, string> = {
  match: "Matches",
  event_attend: "Events attended",
  post_created: "Posts created",
  post_liked: "Posts liked",
  community_join: "Communities joined",
  daily_login: "Daily logins",
  profile_completed: "Profile completed",
  admin_adjust: "Admin adjustments",
};

export function auraReasonLabel(reason: string): string {
  return AURA_REASON_LABELS[reason] ?? reason;
}
