import type { ActivityVisibleType } from "@/lib/notifications/copy";

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
 * WHAT IS DELIBERATELY ABSENT, and why each one:
 *
 *   community_message / event_message   Chat. Talking is not a task, and Chat
 *                                       has its own dock badge pointing at the
 *                                       place the message actually lives.
 *   community_post                      Someone posted in a space you are in.
 *                                       That is a feed, not an update to act
 *                                       on; it is the "every new thing on the
 *                                       platform" mistake the old badge made.
 *   post_like / comment / mention / …   Social reactions belong to Activity.
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
  // Spaces the reader follows or has joined. One per ANNOUNCEMENT, never one
  // per space — a society that posts twice has said two things.
  "society_announcement",
  // Events the reader hosts or is going to.
  "event_approved",
  "event_rejected",
  "event_updated",
  "event_reminder",
  "waitlist_promoted",
] as const satisfies readonly ActivityVisibleType[];

export type CommunityUpdateType = (typeof COMMUNITY_UPDATE_TYPES)[number];

const TYPE_SET: ReadonlySet<string> = new Set(COMMUNITY_UPDATE_TYPES);

export function isCommunityUpdateType(
  value: string
): value is CommunityUpdateType {
  return TYPE_SET.has(value);
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

/** One row of the Updates list, as it crosses to the client. */
export type CommunityUpdate = {
  id: string;
  type: string;
  text: string;
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
