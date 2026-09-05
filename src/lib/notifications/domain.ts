import type { NotificationType } from "@/lib/notifications/copy";

/**
 * WHICH SURFACE OWNS A NOTIFICATION. One rule, four answers, one file.
 *
 * This is the TypeScript mirror of `public.notification_domain()` (migration
 * 0195). The database is authoritative — the lists, the badge counts and the
 * read RPCs all go through views built on it — and this copy exists so the
 * client can reason about a row it already holds, and so the rule is testable
 * without a database.
 *
 * WHY A SEPARATE FILE. Before 0195 the rule lived inside
 * `lib/community/updates.ts`, which made "is this a Community update?" the only
 * question anyone could ask, and the answer to "is this a DM?" was "not a
 * Community update" — which is exactly the mistake 0192 shipped. The four
 * domains are now peers and no surface owns the classification.
 *
 * TWO WAYS TYPE ALONE IS WRONG, and both bit us:
 *
 *   * a like on a community post and a like on a feed post are BOTH
 *     `post_like`. Only the SUBJECT separates them.
 *   * `message` and `community_message` both contain the word "message" and are
 *     different domains entirely — one is a private conversation, the other is
 *     a room inside a space. Matching on a substring, a URL or display copy
 *     would get this wrong in both directions.
 *
 * So: the type lists below are authoritative for the types the app actually
 * emits, and the subject decides everything else.
 */

/**
 * The four surfaces a notification can belong to.
 *
 *   community_updates     — Community → Updates, and the Community dock badge.
 *   chat                  — Chat: DMs, DM requests, DM reactions. Chat renders
 *                           from `messages`/`message_requests`, not from these
 *                           rows, so nothing lists them; what matters is that
 *                           no OTHER surface claims them.
 *   general_notifications — the Notifications page and the bell.
 *   system                — cold-open modal (admin announcements), never a row.
 */
export type NotificationDomain =
  | "community_updates"
  | "chat"
  | "general_notifications"
  | "system";

/**
 * Types that ALWAYS belong to Community Updates, whatever their subject.
 * Mirrors `public.community_update_types()`; `updates.test.ts` parses the
 * migration and asserts the two lists are identical.
 *
 * COMMUNITY CONVERSATION IS HERE, CHAT CONVERSATION IS NOT. A community chat
 * room, an event discussion and a society broadcast are group conversations
 * that live inside a space: they raise no Chat badge, they are read on the
 * room/event/society screen, and they are addressed to a membership rather than
 * to a person. A DM is the opposite of every one of those things.
 */
export const COMMUNITY_UPDATE_TYPES = [
  // Work waiting on the reader as a manager of a space.
  "community_join_request",
  "community_post_review",
  "event_post_request",
  // Decisions about the reader, made inside a space.
  "community_join_approved",
  "community_join_rejected",
  "community_approved",
  "community_rejected",
  "community_post_approved",
  "community_post_rejected",
  "society_role",
  "society_role_removed",
  // Spaces the reader follows or has joined.
  "society_announcement",
  "community_post",
  // Conversation inside a space. Grouped by room/event, so a busy channel is
  // one row carrying a count, never one row per message.
  "community_message",
  "event_message",
  // Events the reader hosts or is going to.
  "event_approved",
  "event_rejected",
  "event_updated",
  "event_reminder",
  "waitlist_promoted",
  "event_organizer_added",
  "event_organizer_removed",
] as const satisfies readonly NotificationType[];

export type CommunityUpdateType = (typeof COMMUNITY_UPDATE_TYPES)[number];

/**
 * The Chat family. Mirrors `public.chat_notification_types()`.
 *
 * These are the four types migration 0192 wrongly routed to Community Updates.
 * They belong to Chat, which already carries them three other ways — the dock
 * badge, the per-conversation unread count, and the Requests panel — and none
 * of those three reads a notification row, so this list is about EXCLUSION:
 * whatever else happens, no other surface may count these.
 */
export const CHAT_NOTIFICATION_TYPES = [
  "message",
  "message_request",
  "message_request_accepted",
  "message_reaction",
] as const satisfies readonly NotificationType[];

export type ChatNotificationType = (typeof CHAT_NOTIFICATION_TYPES)[number];

/**
 * Generic social types that live in EITHER Community Updates or the general
 * Notifications page depending on WHERE they happened. Mirrors
 * `public.social_notification_types()`.
 */
export const SOCIAL_NOTIFICATION_TYPES = [
  "post_like",
  "comment_like",
  "comment",
  "comment_reply",
  "mention",
] as const satisfies readonly NotificationType[];

/** Types delivered as a cold-open modal rather than as a list row anywhere. */
export const SYSTEM_NOTIFICATION_TYPES = [
  "announcement",
] as const satisfies readonly NotificationType[];

const COMMUNITY_SET: ReadonlySet<string> = new Set(COMMUNITY_UPDATE_TYPES);
const CHAT_SET: ReadonlySet<string> = new Set(CHAT_NOTIFICATION_TYPES);
const SOCIAL_SET: ReadonlySet<string> = new Set(SOCIAL_NOTIFICATION_TYPES);
const SYSTEM_SET: ReadonlySet<string> = new Set(SYSTEM_NOTIFICATION_TYPES);

/** The authoritative subject of a notification, as the database stores it. */
export type NotificationSubject = {
  communityId?: string | null;
  eventId?: string | null;
  /** A PRIVATE chat conversation. Community rooms are not conversations —
   *  their messages live in `community_chat_messages` / `event_messages`. */
  conversationId?: string | null;
};

/**
 * Classify one notification. Same order of tests as the SQL, deliberately:
 *
 *  1. system — a modal, never a row.
 *  2. chat BY TYPE, checked before the community list so the two lists cannot
 *     both claim a row even if someone later adds a type to both.
 *  3. community BY TYPE.
 *  4. community BY SUBJECT — a generic social type inside a space.
 *  5. chat BY SUBJECT — the future-proofing clause: a row that names a Chat
 *     conversation and no space is Chat whatever its type is called. Last among
 *     the positives, so a space-scoped row carrying a stray conversation id
 *     still routes to Community.
 *  6. everything else is platform-level activity.
 */
export function notificationDomain(
  type: string,
  subject: NotificationSubject = {}
): NotificationDomain {
  if (SYSTEM_SET.has(type)) return "system";
  if (CHAT_SET.has(type)) return "chat";
  if (COMMUNITY_SET.has(type)) return "community_updates";
  if (SOCIAL_SET.has(type) && (subject.communityId || subject.eventId))
    return "community_updates";
  if (subject.conversationId && !subject.communityId && !subject.eventId)
    return "chat";
  return "general_notifications";
}

/** True when a type ALWAYS belongs to Community Updates. */
export function isCommunityUpdateType(
  value: string
): value is CommunityUpdateType {
  return COMMUNITY_SET.has(value);
}

/** True when a type belongs to a private Chat conversation. */
export function isChatNotificationType(
  value: string
): value is ChatNotificationType {
  return CHAT_SET.has(value);
}

/** The always-community list as a plain array, for PostgREST `.in("type", …)`. */
export function communityUpdateTypeList(): string[] {
  return [...COMMUNITY_UPDATE_TYPES];
}

/** The chat list as a plain array, for a `.not("type", "in", …)` exclusion. */
export function chatNotificationTypeList(): string[] {
  return [...CHAT_NOTIFICATION_TYPES];
}
