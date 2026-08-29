import {
  actorSummary,
  isNotificationType,
  notificationCopy,
  notificationHref,
} from "@/lib/notifications/copy";

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
  "community_join_approved",
  "community_rejected",
  "event_rejected",
  "aura_adjusted",
  "leaderboard_top_finish",
  "content_moderated",
]);

/** Short verb phrase for a groupable actor action, e.g. "liked your post". */
export function notificationActionPhrase(type: string): string {
  switch (type) {
    case "post_like":
      return "reacted to your post";
    case "comment":
      return "replied to your post";
    case "comment_reply":
      return "replied to your comment";
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
    case "community_message":
      return "sent a message in your community";
    case "community_post":
      return "posted in your community";
    case "community_post_review":
      return "submitted a post for review in your community";
    case "community_join_request":
      return "asked to join your community";
    case "event_post_request":
      return "wants to post in your event";
    case "event_message":
      return "sent a message in your event";
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
    case "comment_like":
      return "liked your comment";
    case "message_request_accepted":
      return "accepted your message request";
    case "message_reaction":
      return "reacted to your message";
    case "community_rejected":
      return "declined your community request";
    case "event_rejected":
      return "declined your event request";
    case "society_role_removed":
      return "updated your society role";
    case "event_organizer_added":
      return "added you as an event co-organizer";
    case "event_organizer_removed":
      return "removed you as an event co-organizer";
    case "aura_adjusted":
      return "adjusted your Aura score";
    case "leaderboard_top_finish":
      return "earned a top weekly leaderboard finish";
    case "content_moderated":
      return "removed content for violating community guidelines";
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
    case "comment_like":
    case "message_reaction":
      return "reacts";
    case "comment":
    case "comment_reply":
    case "mention":
      return "replies";
    case "match":
    case "match_post":
    case "message_request_accepted":
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
    case "community_rejected":
    case "event_approved":
    case "event_rejected":
    case "community_post_approved":
    case "community_post_rejected":
    case "society_announcement":
    case "society_role":
    case "society_role_removed":
    case "event_organizer_added":
    case "event_organizer_removed":
    case "content_moderated":
      return "announcements";
    case "waitlist_promoted":
    case "event_reminder":
    case "moderation_warning":
    case "appeal_result":
      return "announcements";
    case "level_up":
    case "achievement":
    case "aura_adjusted":
    case "leaderboard_top_finish":
      return "other";
    case "help_response":
    case "help_follow":
    case "help_thanked":
    case "help_resolved":
    case "help_offer_accepted":
      return "other";
    case "community_message":
      return "messages";
    case "community_post":
      return "announcements";
    case "community_post_review":
      return "requests";
    case "community_join_request":
      return "requests";
    case "community_join_approved":
      return "announcements";
    case "event_post_request":
      return "requests";
    case "event_message":
      return "messages";
    default:
      return "other";
  }
}

/**
 * Display text + destination for a notification. Both come from
 * `@/lib/notifications/copy`, which switches exhaustively over the known type
 * union — this wrapper exists only to absorb the fact that `notifications.type`
 * is untyped `text` in the database, so a row written by a future migration
 * cannot crash a render before its copy lands here.
 *
 * `count` is the collapsed group_count (1 for ungrouped notifications).
 */
export function notificationView(
  type: string,
  actorName: string | null,
  data: Record<string, unknown>,
  count = 1
): { text: string; href: string } {
  if (!isNotificationType(type)) {
    // Deliberately generic, and deliberately unreachable for every type the
    // system emits today — see NOTIFICATION_TYPES.
    return { text: `${actorSummary(actorName, count)} sent you an update`, href: "/home" };
  }
  return {
    text: notificationCopy(type, actorName, data, count),
    href: notificationHref(type, data),
  };
}

