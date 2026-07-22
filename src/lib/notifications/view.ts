/**
 * Notification types that are NOT tied to a specific "actor doing something to
 * you" and must never be bundled (CR-013): system events shown individually.
 */
export const SYSTEM_NOTIFICATION_TYPES = new Set([
  "match",
  "community_approved",
  "event_approved",
  "level_up",
  "achievement",
  "waitlist_promoted",
  "event_reminder",
  "moderation_warning",
  "appeal_result",
  "help_thanked",
  "help_resolved",
  "help_offer_accepted",
  "matching_accepted",
  "smart_match_accepted",
]);

/** Short verb phrase for a groupable actor action, e.g. "liked your post". */
export function notificationActionPhrase(type: string): string {
  switch (type) {
    case "post_like":
      return "reacted to your post";
    case "comment":
      return "replied to your post";
    case "mention":
      return "mentioned you in a comment";
    case "message":
      return "sent you a message";
    case "message_request":
      return "sent you a message request";
    case "matching_request":
      return "wants to connect";
    case "matching_accepted":
      return "accepted your request";
    case "help_response":
      return "responded to your help request";
    case "help_offer_accepted":
      return "approved your offer to help";
    case "help_follow":
      return "is following your help request";
    case "society_announcement":
      return "posted a society announcement";
    case "society_role":
      return "made you a society officer";
    case "community_post_approved":
      return "approved your community post";
    case "community_post_rejected":
      return "rejected your community post";
    case "match_post":
      return "shared a new post";
    case "smart_match_application":
      return "wants to join your post";
    case "smart_match_accepted":
      return "accepted your request";
    case "smart_match_mention":
      return "tagged you as a teammate";
    default:
      return "interacted with you";
  }
}

/**
 * Activity categories used by the Activity panel's filter chips. Each notification
 * type maps to exactly one category; "announcements" bundles all system approvals.
 */
export type ActivityCategory =
  | "reacts"
  | "replies"
  | "matches"
  | "requests"
  | "messages"
  | "announcements"
  | "other";

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  reacts: "Reacts",
  replies: "Replies",
  matches: "Matches",
  requests: "Requests",
  messages: "Messages",
  announcements: "Announcements",
  other: "Other",
};

/** Which Activity filter a notification type belongs to. */
export function notificationCategory(type: string): ActivityCategory {
  switch (type) {
    case "post_like":
      return "reacts";
    case "comment":
    case "mention":
      return "replies";
    case "match":
    case "match_post":
      return "matches";
    case "message_request":
    case "matching_request":
      return "requests";
    case "matching_accepted":
    case "smart_match_accepted":
      return "matches";
    case "smart_match_application":
    case "smart_match_mention":
      return "requests";
    case "message":
      return "messages";
    case "community_approved":
    case "event_approved":
    case "community_post_approved":
    case "community_post_rejected":
    case "society_announcement":
    case "society_role":
      return "announcements";
    case "waitlist_promoted":
    case "event_reminder":
    case "moderation_warning":
    case "appeal_result":
      return "announcements";
    case "level_up":
    case "achievement":
      return "other";
    case "help_response":
    case "help_follow":
    case "help_thanked":
    case "help_resolved":
    case "help_offer_accepted":
      return "other";
    default:
      return "other";
  }
}

/** "Alice", "Alice and 1 other", "Alice and 4 others" for a grouped count. */
function actorSummary(actorName: string | null, count: number): string {
  const who = actorName ?? "Someone";
  if (count <= 1) return who;
  const others = count - 1;
  return `${who} and ${others} other${others === 1 ? "" : "s"}`;
}

/**
 * Maps a notification (type + actor + data) to display text and a link. `count`
 * is the collapsed group_count (Phase 7) — 1 for ungrouped notifications.
 */
export function notificationView(
  type: string,
  actorName: string | null,
  data: Record<string, unknown>,
  count = 1
): { text: string; href: string } {
  const who = actorSummary(actorName, count);
  switch (type) {
    case "match":
      return { text: `You matched with ${who}!`, href: "/chat" };
    case "message_request":
      return { text: `${who} sent you a message request`, href: "/chat" };
    case "matching_request":
      return {
        text: `${who} wants to connect`,
        href: data.mode ? `/discover?mode=${data.mode}` : "/discover",
      };
    case "matching_accepted":
      return {
        text: `${who} accepted your request 🎉`,
        href: data.mode ? `/discover?mode=${data.mode}` : "/discover",
      };
    case "message":
      return {
        text: `${who} sent you a message`,
        href: data.conversation_id ? `/chat/${data.conversation_id}` : "/chat",
      };
    case "post_like":
      return {
        text: `${who} reacted to your ${data.community_id ? "community post" : "post"}`,
        href: data.post_id ? `/post/${data.post_id}` : "/home",
      };
    case "comment":
      return {
        text: `${who} replied to your ${data.community_id ? "community post" : "post"}`,
        href: data.post_id ? `/post/${data.post_id}` : "/home",
      };
    case "mention":
      return {
        text: `${who} mentioned you in a comment`,
        href: data.post_id ? `/post/${data.post_id}` : "/home",
      };
    case "match_post":
      return {
        text: `${who} shared a new post`,
        href: data.post_id ? `/post/${data.post_id}` : "/home",
      };
    case "community_approved":
      return {
        text: "Your community was approved 🎉",
        href: data.community_id
          ? `/communities/${data.community_id}`
          : "/communities",
      };
    case "event_approved":
      return {
        text: "Your event was approved 🎉",
        href: data.event_id ? `/events/${data.event_id}` : "/events",
      };
    case "community_post_approved":
      return {
        text: `${who} approved your community post ✅`,
        href: data.community_id
          ? `/communities/${data.community_id}`
          : "/communities",
      };
    case "community_post_rejected":
      return {
        text: `${who} rejected your community post`,
        href: data.community_id
          ? `/communities/${data.community_id}`
          : "/communities",
      };
    case "level_up":
      return {
        text: `You reached level ${data.level ?? ""}! 🎉`.replace("  ", " "),
        href: "/profile/aura",
      };
    case "achievement":
      return {
        text: `Badge earned: ${data.title ?? "a new badge"} 🏅`,
        href: "/profile/badges",
      };
    case "waitlist_promoted":
      return {
        text: "A seat opened up — you're in! 🎟️",
        href: data.event_id ? `/events/${data.event_id}` : "/events",
      };
    case "event_reminder":
      return {
        text:
          data.kind === "1h"
            ? "An event you're attending starts within the hour ⏰"
            : "An event you're attending is coming up tomorrow ⏰",
        href: data.event_id ? `/events/${data.event_id}` : "/events",
      };
    case "moderation_warning":
      return {
        text: `You received a moderation warning${
          data.level ? ` (strike ${data.level})` : ""
        }. Tap to appeal.`,
        href: "/appeals",
      };
    case "appeal_result":
      return {
        text: data.approved
          ? "Your appeal was approved ✅"
          : "Your appeal was reviewed and declined.",
        href: "/appeals",
      };
    case "help_response":
      return {
        text: `${who} responded to your help request`,
        href: data.request_id ? `/help/${data.request_id}` : "/help",
      };
    case "help_follow":
      return {
        text: `${who} is following your help request`,
        href: data.request_id ? `/help/${data.request_id}` : "/help",
      };
    case "help_thanked":
      return {
        text: "You were thanked for helping 🙏 (+15 Aura)",
        href: data.request_id ? `/help/${data.request_id}` : "/help",
      };
    case "help_offer_accepted":
      return {
        text: `${who} approved your offer to help — say hi 👋`,
        href: data.request_id ? `/help/${data.request_id}` : "/help",
      };
    case "help_resolved":
      return {
        text: "A request you follow was resolved ✅",
        href: data.request_id ? `/help/${data.request_id}` : "/help",
      };
    case "society_announcement":
      return {
        text: `${who} posted a society announcement 📣`,
        href: data.society_id
          ? `/societies/${data.society_id}/announcements`
          : "/societies",
      };
    case "society_role":
      return {
        text: "You were appointed a society officer 🎖️",
        href: data.society_id ? `/societies/${data.society_id}` : "/societies",
      };
    case "smart_match_application":
      return {
        text: `${who} wants to join your post`,
        href: data.mode ? `/discover?mode=${data.mode}` : "/discover",
      };
    case "smart_match_accepted":
      return {
        text: `${who} accepted your request 🎉`,
        href: data.mode ? `/discover?mode=${data.mode}` : "/discover",
      };
    case "smart_match_mention":
      return {
        text: `${who} tagged you as a teammate`,
        href: data.mode ? `/discover?mode=${data.mode}` : "/discover",
      };
    default:
      return { text: "New notification", href: "/home" };
  }
}
