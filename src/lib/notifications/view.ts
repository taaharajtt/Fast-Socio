import {
  actorSummary,
  isActivityVisibleType,
  isNotificationType,
  notificationCopy,
  notificationHref,
  type ActivityVisibleType,
} from "@/lib/notifications/copy";

export {
  ACTIVITY_VISIBLE_TYPES,
  activityVisibleTypeList,
  isActivityVisibleType,
  type ActivityVisibleType,
} from "@/lib/notifications/copy";

/**
 * Notification types that are NOT tied to a specific "actor doing something to
 * you" and must never be bundled (CR-013): system events shown individually.
 * Only types the Notifications surface actually renders appear here.
 */
export const SYSTEM_NOTIFICATION_TYPES = new Set<ActivityVisibleType>([
  "match",
  "event_approved",
  "event_rejected",
  "event_reminder",
  "event_updated",
  "waitlist_promoted",
  "level_up",
  "achievement",
  "aura_adjusted",
  "leaderboard_top_finish",
  "moderation_warning",
  "appeal_result",
  "content_moderated",
  "help_thanked",
  "help_resolved",
  "help_offer_accepted",
  "matching_accepted",
  "smart_match_accepted",
  // Anonymous aggregate — there is no actor, so it can never be bundled.
  "incoming_match_interest",
  // Space lifecycle decisions ABOUT the reader — an approval or a rejection is
  // a single fact, not an actor doing something repeatedly.
  "community_approved",
  "community_rejected",
  "community_join_approved",
  "community_join_rejected",
  "community_post_approved",
  "community_post_rejected",
  "society_role",
  "society_role_removed",
]);

/** Short verb phrase for a groupable actor action, e.g. "liked your post". */
export function notificationActionPhrase(type: string): string {
  switch (type) {
    case "post_like":
      return "reacted to your post";
    case "comment_like":
      return "liked your comment";
    case "comment":
      return "commented on your post";
    case "comment_reply":
      return "replied to your comment";
    case "mention":
      return "mentioned you in a comment";
    case "matching_request":
      return "wants to connect";
    case "matching_accepted":
      return "accepted your request";
    case "match_post":
      return "shared a new post";
    case "smart_match_application":
      return "wants to join your post";
    case "smart_match_accepted":
      return "accepted your request";
    case "smart_match_mention":
      return "tagged you as a teammate";
    case "incoming_match_interest":
      // Never used for this type (it has no actor to prefix), but the map is
      // consulted by type, so it must not fall through to "interacted with you".
      return "tried to match with you";
    case "event_organizer_added":
      return "added you as an event co-organizer";
    case "event_organizer_removed":
      return "removed you as an event co-organizer";
    case "help_response":
      return "responded to your help request";
    case "help_offer_accepted":
      return "approved your offer to help";
    case "help_follow":
      return "is following your help request";
    case "aura_adjusted":
      return "adjusted your Aura score";
    case "leaderboard_top_finish":
      return "earned a top weekly leaderboard finish";
    case "content_moderated":
      return "removed content for violating community guidelines";
    case "community_message":
      return "sent a message in a community";
    case "society_announcement":
      return "posted a broadcast";
    case "event_message":
      return "sent a message in an event";
    case "community_post":
      return "posted in a community";
    case "community_post_review":
      return "submitted a post for review";
    case "community_join_request":
      return "asked to join a community";
    case "community_join_rejected":
      return "declined your join request";
    case "event_updated":
      return "changed an event you're going to";
    case "event_post_request":
      return "asked to post in an event";
    default:
      return "interacted with you";
  }
}

/**
 * The categories the Notifications page shows.
 *
 * UAT-18 adds two. `spaces` covers the community/society lifecycle decisions;
 * `conversations` covers group chat surfaces (chat rooms, society broadcasts,
 * event discussion) — the ones that have no dock badge of their own. DIRECT
 * chat still has no category, on purpose: it is served by the Chat badge, the
 * per-conversation unread count and the Requests panel, and does not reach this
 * surface. Admin announcements likewise arrive as a cold-open modal.
 */
export type ActivityCategory =
  | "post_reacts"
  | "comment_reacts"
  | "comments"
  | "discover"
  | "event_decision"
  | "event_updates"
  | "help"
  | "aura"
  | "moderation"
  | "spaces"
  | "conversations";

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  post_reacts: "Post reacts",
  comment_reacts: "Comment reacts",
  comments: "Comments and replies",
  discover: "Matches and Discover",
  event_decision: "Event decisions",
  event_updates: "Event updates",
  help: "Campus Help",
  aura: "Aura and badges",
  moderation: "Moderation and appeals",
  spaces: "Communities and societies",
  conversations: "Group chats",
};

/**
 * Which category a notification belongs to, or `null` when the type must not
 * appear on the Notifications page at all.
 */
export function notificationCategory(type: string): ActivityCategory | null {
  if (!isActivityVisibleType(type)) return null;
  switch (type) {
    case "post_like":
      return "post_reacts";
    case "comment_like":
      return "comment_reacts";
    case "comment":
    case "comment_reply":
    case "mention":
      return "comments";
    case "match":
    case "match_post":
    case "matching_request":
    case "matching_accepted":
    case "smart_match_application":
    case "smart_match_accepted":
    case "smart_match_mention":
    case "incoming_match_interest":
      return "discover";
    case "event_approved":
    case "event_rejected":
      return "event_decision";
    case "event_organizer_added":
    case "event_organizer_removed":
    case "event_reminder":
    case "event_updated":
    case "waitlist_promoted":
      return "event_updates";
    case "help_response":
    case "help_offer_accepted":
    case "help_follow":
    case "help_thanked":
    case "help_resolved":
      return "help";
    case "level_up":
    case "achievement":
    case "aura_adjusted":
    case "leaderboard_top_finish":
      return "aura";
    case "content_moderated":
    case "moderation_warning":
    case "appeal_result":
      return "moderation";
    case "community_message":
    case "society_announcement":
    case "event_message":
      return "conversations";
    case "community_post":
    case "community_post_review":
    case "community_post_approved":
    case "community_post_rejected":
    case "community_join_request":
    case "community_join_approved":
    case "community_join_rejected":
    case "community_approved":
    case "community_rejected":
    case "society_role":
    case "society_role_removed":
    case "event_post_request":
      return "spaces";
    default: {
      const never: never = type;
      throw new Error(`Uncategorised notification type: ${String(never)}`);
    }
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

