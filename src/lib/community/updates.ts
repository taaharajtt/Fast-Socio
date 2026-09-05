import type { CopySegment, NotificationType } from "@/lib/notifications/copy";

/**
 * What counts as a Community update.
 *
 * ONE unit of measurement: an update is a concrete, unseen thing that happened
 * in Community/Space/Event land and is addressed to THIS student. The dock
 * badge is `count(*)` of the unread ones and the /communities/updates screen
 * renders exactly the same rows — so "why does it say 6" is answered by opening
 * it and reading six lines.
 *
 * This list mirrors `public.community_update_types()` (migration 0183), which
 * is what the database's view and RPCs actually use. Two copies exist because
 * neither side can import the other; `updates.test.ts` asserts they match by
 * parsing the migration, so a type added on one side and forgotten on the other
 * fails the test run rather than quietly under- or over-counting.
 *
 * TYPE ALONE DOES NOT DECIDE. A like on a community post and a like on a feed
 * post are both `post_like`; what separates them is the SUBJECT. The types
 * below always belong to Updates; the generic social types below that belong
 * there only when the notification carries a space subject. Both halves are
 * mirrored from `public.notification_domain()` (migration 0192), which is what
 * the database actually routes on.
 *
 * Nothing counts an action the reader took themselves: `create_notification`
 * returns early when recipient = actor, so there is no row to exclude.
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
  // Direct messages, by explicit product decision. Grouped by conversation.
  // The Chat dock badge is unaffected: it counts unread MESSAGES, not
  // notifications, so the two are independent numbers of different things.
  "message",
  "message_request",
  "message_request_accepted",
  "message_reaction",
] as const satisfies readonly NotificationType[];

export type CommunityUpdateType = (typeof COMMUNITY_UPDATE_TYPES)[number];

const TYPE_SET: ReadonlySet<string> = new Set(COMMUNITY_UPDATE_TYPES);

export function isCommunityUpdateType(
  value: string
): value is CommunityUpdateType {
  return TYPE_SET.has(value);
}

/**
 * Generic social types that live in EITHER surface depending on where they
 * happened. Mirrors `public.social_notification_types()`.
 */
export const SOCIAL_NOTIFICATION_TYPES = [
  "post_like",
  "comment_like",
  "comment",
  "comment_reply",
  "mention",
] as const satisfies readonly NotificationType[];

const SOCIAL_SET: ReadonlySet<string> = new Set(SOCIAL_NOTIFICATION_TYPES);

/**
 * Which surface owns a notification. The TypeScript mirror of
 * `public.notification_domain()`; the database is authoritative and both
 * surfaces read views built on it, so this exists for tests and for any client
 * that needs to reason about a row it already holds.
 */
export function notificationDomain(
  type: string,
  subject: { communityId?: string | null; eventId?: string | null }
): "community" | "activity" {
  if (TYPE_SET.has(type)) return "community";
  if (SOCIAL_SET.has(type) && (subject.communityId || subject.eventId))
    return "community";
  return "activity";
}

/** The allow-list as a plain array, for PostgREST `.in("type", …)`. */
export function communityUpdateTypeList(): string[] {
  return [...COMMUNITY_UPDATE_TYPES];
}

/**
 * The types that represent WORK — something the reader is expected to go and
 * decide, rather than news they are expected to read. The list surfaces these
 * with an "Action needed" marker; the database independently re-checks that
 * each is still pending and still the reader's to act on (the liveness rules in
 * the `community_updates` view), so this is presentation only.
 */
const ACTIONABLE: ReadonlySet<string> = new Set<CommunityUpdateType>([
  "community_join_request",
  "community_post_review",
  "event_post_request",
]);

export function isActionableUpdate(type: string): boolean {
  return ACTIONABLE.has(type);
}

/**
 * Which date heading a row sits under. Uppercased at render time; kept as
 * plain values here so the grouping is testable without a DOM.
 */
export type UpdateBucket = "TODAY" | "YESTERDAY" | "EARLIER";

/**
 * The date section for a timestamp, relative to `now`.
 *
 * CALENDAR DAYS, NOT ELAPSED HOURS. "Yesterday" means the previous calendar
 * date in the reader's own timezone — something at 23:00 last night is
 * yesterday at 08:00 today, even though it is only nine hours old. Comparing
 * elapsed milliseconds would call that "today" and put it under the wrong
 * heading.
 */
export function updateBucket(createdAt: string, now: Date = new Date()): UpdateBucket {
  const then = new Date(createdAt);
  if (Number.isNaN(then.getTime())) return "EARLIER";
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  return "EARLIER";
}

/**
 * Group rows into date sections, preserving their incoming order.
 *
 * PAGINATION SAFE, and that is the whole reason this is a function over the
 * WHOLE list rather than a header emitted per row. Rows arrive newest-first and
 * a later page continues that order, so re-grouping the accumulated array can
 * never emit "TODAY" twice — a second page of today's rows extends the first
 * group instead of starting a new one.
 */
export function groupUpdatesByDate(
  items: CommunityUpdate[],
  now: Date = new Date()
): { bucket: UpdateBucket; items: CommunityUpdate[] }[] {
  const out: { bucket: UpdateBucket; items: CommunityUpdate[] }[] = [];
  for (const item of items) {
    const bucket = updateBucket(item.createdAt, now);
    const last = out[out.length - 1];
    if (last && last.bucket === bucket) last.items.push(item);
    else out.push({ bucket, items: [item] });
  }
  return out;
}

/** One row of the Updates list, as it crosses to the client. */
export type CommunityUpdate = {
  id: string;
  type: string;
  text: string;
  /** The same sentence as `text`, split into emphasised/muted runs. */
  segments: CopySegment[];
  href: string;
  unread: boolean;
  actionable: boolean;
  createdAt: string;
  timeAgo: string;
  actorName: string | null;
  avatar: string | null;
};

/** Page size for the Updates list — one screen-and-a-bit on a phone. */
export const UPDATES_PAGE_SIZE = 25;
