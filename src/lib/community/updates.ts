import type { CopySegment } from "@/lib/notifications/copy";

/**
 * What counts as a Community update.
 *
 * ONE unit of measurement: an update is a concrete, unseen thing that happened
 * in Community/Space/Event land and is addressed to THIS student. The dock
 * badge is `count(*)` of the unread ones and the /communities/updates screen
 * renders exactly the same rows — so "why does it say 6" is answered by opening
 * it and reading six lines.
 *
 * THE CLASSIFICATION ITSELF LIVES IN `lib/notifications/domain.ts`, and the
 * database's `public.notification_domain()` (migration 0195) is authoritative
 * over both. This file re-exports the Community half so the existing callers
 * keep their import, and adds the presentation concerns — actionability, date
 * bucketing, the row shape — that only this screen has.
 *
 * WHY IT MOVED. Migration 0192 asked one question, "is this a Community
 * update?", and treated everything else as a leftover; the answer it gave for a
 * direct message was "yes", which put private chat traffic on a community
 * screen and into the Community badge. The four domains — community_updates,
 * chat, general_notifications, system — are now peers, and DMs belong to chat.
 *
 * Nothing counts an action the reader took themselves: `create_notification`
 * returns early when recipient = actor, so there is no row to exclude.
 */
export {
  COMMUNITY_UPDATE_TYPES,
  CHAT_NOTIFICATION_TYPES,
  SOCIAL_NOTIFICATION_TYPES,
  isCommunityUpdateType,
  isChatNotificationType,
  communityUpdateTypeList,
  chatNotificationTypeList,
  notificationDomain,
} from "@/lib/notifications/domain";
export type {
  CommunityUpdateType,
  ChatNotificationType,
  NotificationDomain,
  NotificationSubject,
} from "@/lib/notifications/domain";

import type { CommunityUpdateType } from "@/lib/notifications/domain";

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
