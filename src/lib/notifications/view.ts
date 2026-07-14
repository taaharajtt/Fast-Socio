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
]);

/** Short verb phrase for a groupable actor action, e.g. "liked your post". */
export function notificationActionPhrase(type: string): string {
  switch (type) {
    case "post_like":
      return "reacted to your post";
    case "comment":
      return "replied to your post";
    case "message":
      return "sent you a message";
    case "message_request":
      return "sent you a message request";
    case "community_post_approved":
      return "approved your community post";
    case "community_post_rejected":
      return "rejected your community post";
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
      return "replies";
    case "match":
      return "matches";
    case "message_request":
      return "requests";
    case "message":
      return "messages";
    case "community_approved":
    case "event_approved":
    case "community_post_approved":
    case "community_post_rejected":
      return "announcements";
    case "waitlist_promoted":
    case "event_reminder":
    case "moderation_warning":
    case "appeal_result":
      return "announcements";
    case "level_up":
    case "achievement":
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
    default:
      return { text: "New notification", href: "/home" };
  }
}
