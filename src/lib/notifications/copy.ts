/**
 * The single source of truth for what a notification SAYS and where it GOES.
 *
 * Every type the database can emit is listed in NOTIFICATION_TYPES, and both
 * `notificationCopy` and `notificationHref` switch exhaustively over that union
 * with a `never` guard at the end — so adding a type to the list without adding
 * copy and a destination is a TypeScript build error, not a "New notification"
 * placeholder shipped to a student (fix-004, fix-005).
 *
 * The list was derived by enumerating every `create_notification(...)` call and
 * every direct `insert into public.notifications` in the live database's
 * function bodies, cross-checked against the distinct `type` values actually
 * present in the table. `notifications.type` is plain `text` with no check
 * constraint, so the DB cannot enforce this — the boundary helpers below
 * (`isNotificationType`) are what keep an unknown string from crashing a render.
 *
 * COPY RULES: one line, ≤ ~90 characters, actor name first, present tense, a
 * concrete noun, and the target's title/snippet where the payload carries one.
 */

export const NOTIFICATION_TYPES = [
  "achievement",
  "announcement",
  "appeal_result",
  "aura_adjusted",
  "comment",
  "comment_like",
  "comment_reply",
  "community_approved",
  "community_join_approved",
  "community_join_rejected",
  "community_join_request",
  "community_message",
  "community_post",
  "community_post_approved",
  "community_post_rejected",
  "community_post_review",
  "community_rejected",
  "content_moderated",
  "event_approved",
  "event_message",
  "event_organizer_added",
  "event_organizer_removed",
  "event_post_request",
  "event_rejected",
  "event_reminder",
  "event_updated",
  "help_follow",
  "help_offer_accepted",
  "help_resolved",
  "help_response",
  "help_thanked",
  "leaderboard_top_finish",
  "level_up",
  "match",
  "match_post",
  "matching_accepted",
  "matching_request",
  "mention",
  "message",
  "message_reaction",
  "message_request",
  "message_request_accepted",
  "moderation_warning",
  "post_like",
  "smart_match_accepted",
  "smart_match_application",
  "smart_match_mention",
  "society_announcement",
  "society_role",
  "society_role_removed",
  "waitlist_promoted",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * The ONLY notification types the Notifications page and the bell/dropdown are
 * allowed to render.
 *
 * This is an allow-list, not a deny-list: a type that is not listed here never
 * reaches the Notifications surface, even if a future migration starts emitting
 * it.
 *
 * UAT-18 REVISED THIS POLICY DELIBERATELY. The previous rule excluded every
 * conversation surface on the grounds that Chat has its own dock badge. That
 * held for DMs, where the badge points at the one place the message lives — but
 * it was wrong for SHARED spaces. A society broadcast, a chat-room message and
 * an event discussion post are each addressed to a group the reader belongs to,
 * they do not raise the Chat badge (their conversations live on the room, the
 * society and the event pages respectively), and so they produced no signal
 * anywhere in the app. What is now allowed, and why:
 *
 *   * community_message / society_announcement / event_message — group
 *     conversation the reader is a member of. GROUPED by subject in mig 0178
 *     (`group_key`), so a burst in a busy room is one row carrying a count, not
 *     thirty rows burying everything else.
 *   * the community/society lifecycle rows (join requests and their outcomes,
 *     post review outcomes, role changes, space approval) — each one is a
 *     decision about the reader or one they have to make.
 *   * event_post_request — an approval the reader owes someone.
 *
 * STILL DELIBERATELY ABSENT: `message`, `message_request`,
 * `message_request_accepted` and `message_reaction`. Direct chat has a dock
 * badge, a per-conversation unread count and a Requests panel; adding a fourth
 * surface would duplicate all three and, for `message`, would put a row on a
 * public-ish screen for every private message received. `announcement` is also
 * absent — it is delivered as a cold-open modal.
 */
export const ACTIVITY_VISIBLE_TYPES = [
  // 1. Post reacts
  "post_like",
  // 2. Comment reacts
  "comment_like",
  // 3. Comments and replies
  "comment",
  "comment_reply",
  "mention",
  // 4. Matches and Discover
  "match",
  "match_post",
  "matching_request",
  "matching_accepted",
  "smart_match_application",
  "smart_match_accepted",
  "smart_match_mention",
  // 5. Event approved / declined
  "event_approved",
  "event_rejected",
  // 6. Organizer changes, reminders, waitlist promotion
  "event_organizer_added",
  "event_organizer_removed",
  "event_reminder",
  "event_updated",
  "waitlist_promoted",
  // 7. Campus Help
  "help_response",
  "help_offer_accepted",
  "help_follow",
  "help_thanked",
  "help_resolved",
  // 8. Aura and badges
  "level_up",
  "achievement",
  "aura_adjusted",
  "leaderboard_top_finish",
  // 9. Moderation and appeals
  "content_moderated",
  "moderation_warning",
  "appeal_result",
  // 10. Group conversations (UAT-18) — grouped by subject, never one per line
  "community_message",
  "society_announcement",
  "event_message",
  // 11. Community and society lifecycle
  "community_post",
  "community_post_review",
  "community_post_approved",
  "community_post_rejected",
  "community_join_request",
  "community_join_approved",
  "community_join_rejected",
  "community_approved",
  "community_rejected",
  "society_role",
  "society_role_removed",
  "event_post_request",
] as const satisfies readonly NotificationType[];

export type ActivityVisibleType = (typeof ACTIVITY_VISIBLE_TYPES)[number];

const VISIBLE_SET: ReadonlySet<string> = new Set(ACTIVITY_VISIBLE_TYPES);

/** True when a type may be rendered on the Notifications page / bell. */
export function isActivityVisibleType(value: string): value is ActivityVisibleType {
  return VISIBLE_SET.has(value);
}

/**
 * The allow-list as a plain (mutable) array for PostgREST `.in("type", …)`.
 * Every query that feeds the Notifications surface — the page, the bell list,
 * the bell count, and the dock badge — uses this, so a badge can never count a
 * row the page refuses to show.
 */
export function activityVisibleTypeList(): string[] {
  return [...ACTIVITY_VISIBLE_TYPES];
}

const TYPE_SET: ReadonlySet<string> = new Set(NOTIFICATION_TYPES);

/** Boundary guard — `notifications.type` is untyped text in the database. */
export function isNotificationType(value: string): value is NotificationType {
  return TYPE_SET.has(value);
}

/** The jsonb `data` payload, read defensively — every field is optional. */
export type NotificationData = Record<string, unknown>;

function str(data: NotificationData, key: string): string | null {
  const v = data[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Trim a title/snippet so a row stays one line. */
function snippet(value: string | null, max = 40): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** "Alice", "Alice and 1 other", "Alice and 4 others" for a collapsed group. */
export function actorSummary(actorName: string | null, count = 1): string {
  const who = actorName ?? "Someone";
  if (count <= 1) return who;
  const others = count - 1;
  return `${who} and ${others} other${others === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * One line of display text for a notification. `actorName` is the actor's
 * display name (null for system notifications), `count` the collapsed
 * group_count.
 */
export function notificationCopy(
  type: NotificationType,
  actorName: string | null,
  data: NotificationData,
  count = 1
): string {
  const who = actorSummary(actorName, count);
  // Help and community surfaces let a student act anonymously; never leak the
  // name the payload happens to carry when that flag is set.
  const anonWho = data.is_anonymous ? "Someone" : who;
  const community = snippet(str(data, "community_name"));
  const inCommunity = community ? ` in ${community}` : "";

  switch (type) {
    // — Reactions ————————————————————————————————————————————————
    case "post_like":
      return `${who} reacted to your ${data.community_id ? "community post" : "post"}`;
    case "comment_like":
      return `${who} liked your comment`;
    case "message_reaction":
      return `${who} reacted ${str(data, "emoji") ?? ""} to your message`.trim();

    // — Comments & mentions ——————————————————————————————————————
    case "comment":
      return `${who} commented on your ${data.community_id ? "community post" : "post"}`;
    case "comment_reply":
      return `${who} replied to your comment`;
    case "mention":
      return `${who} mentioned you in a comment`;

    // — Messages ——————————————————————————————————————————————————
    case "message":
      return `${who} sent you a message`;
    case "message_request":
      return `${who} sent you a message request`;
    case "message_request_accepted":
      return `${who} accepted your message request — say hi 👋`;

    // — Discover / matching ——————————————————————————————————————
    case "match":
      return `You matched with ${who}!`;
    case "match_post":
      return `${who} shared a new post`;
    case "matching_request":
      return `${who} wants to connect`;
    case "matching_accepted":
      return `${who} accepted your request 🎉`;
    case "smart_match_application":
      return `${who} wants to join your ${snippet(str(data, "mode_label"), 24) ?? "post"}`;
    case "smart_match_accepted":
      return `${who} accepted your request to join 🎉`;
    case "smart_match_mention":
      return `${who} tagged you as a teammate`;

    // — Communities & societies ——————————————————————————————————
    case "community_message":
      return `${anonWho} sent a message${inCommunity || " in your community"}`;
    case "community_post":
      return `${who} posted${inCommunity || " in your community"}`;
    case "community_post_review":
      return `${anonWho} submitted a post for review${inCommunity || " in your community"}`;
    case "community_post_approved":
      return `${who} approved your post${inCommunity} ✅`;
    case "community_post_rejected":
      return `${who} declined your post${inCommunity}`;
    case "community_join_request":
      return `${who} asked to join${inCommunity || " your community"}`;
    case "community_join_approved":
      return `Your join request for ${community ?? "the community"} was approved 🎉`;
    case "community_join_rejected":
      return `Your join request for ${community ?? "the community"} wasn't accepted`;
    case "community_approved":
      return `Your community ${community ?? ""} was approved 🎉`.replace("  ", " ");
    case "community_rejected":
      return `Your community request${community ? ` for ${community}` : ""} was declined`;
    case "society_announcement":
      return `${who} posted an announcement${inCommunity} 📣`;
    case "society_role":
      return `You were appointed ${snippet(str(data, "role_label"), 24) ?? "a society officer"} 🎖️`;
    case "society_role_removed":
      return "Your society officer role was removed";

    // — Events ————————————————————————————————————————————————————
    case "event_approved":
      return `Your event ${snippet(str(data, "title"), 34) ?? ""} was approved 🎉`.replace("  ", " ");
    case "event_message":
      return `${who} sent a message in ${snippet(str(data, "event_title"), 34) ?? "your event"}`;
    case "event_rejected":
      return `Your event request${data.title ? ` for ${snippet(str(data, "title"), 34)}` : ""} was declined`;
    case "event_post_request":
      return `${who} wants to post in your event`;
    case "event_organizer_added":
      return `${who} added you as a co-organizer`;
    case "event_organizer_removed":
      return `${who} removed you as a co-organizer`;
    case "event_reminder":
      return data.kind === "1h"
        ? "An event you're attending starts within the hour ⏰"
        : "An event you're attending is coming up tomorrow ⏰";
    case "event_updated": {
      const title = snippet(str(data, "title"), 34);
      const what = title ? `“${title}”` : "An event you're going to";
      switch (data.change) {
        case "cancelled":
          return `${what} was cancelled`;
        case "rescheduled":
          return `${what} moved to a new time`;
        case "venue":
          return `${what} changed venue`;
        default:
          return `${what} was updated`;
      }
    }
    case "waitlist_promoted":
      return "A seat opened up — you're in! 🎟️";

    // — Campus Help ————————————————————————————————————————————————
    case "help_response":
      return `${anonWho} offered to help with your request`;
    case "help_offer_accepted":
      return `${who} approved your offer to help — say hi 👋`;
    case "help_follow":
      return `${who} is following your help request`;
    case "help_thanked":
      return "You were thanked for helping 🙏 (+15 Aura)";
    case "help_resolved":
      return "A request you follow was resolved ✅";

    // — Aura, badges, moderation, system ————————————————————————
    case "level_up":
      return `You reached level ${data.level ?? ""}! 🎉`.replace("  ", " ");
    case "achievement":
      return `Badge earned: ${snippet(str(data, "title"), 34) ?? "a new badge"} 🏅`;
    case "aura_adjusted":
      return `An admin adjusted your Aura${data.delta ? ` by ${data.delta}` : ""}`;
    case "leaderboard_top_finish":
      return "You finished in the weekly leaderboard's top ranks 🏆";
    case "content_moderated":
      return "Content of yours was removed for breaking community guidelines";
    case "moderation_warning":
      return `You received a moderation warning${
        data.level ? ` (strike ${data.level})` : ""
      }. Tap to appeal.`;
    case "appeal_result":
      return data.approved
        ? "Your appeal was approved ✅"
        : "Your appeal was reviewed and declined";
    case "announcement":
      return snippet(str(data, "title"), 80) ?? "A message from the Fast Socio team";

    default:
      return assertNever(type);
  }
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

/** `/post/{id}`, anchored to the comment when the payload names one. */
function postHref(data: NotificationData): string {
  const post = str(data, "post_id");
  if (!post) return "/home";
  const comment = str(data, "comment_id");
  return comment ? `/post/${post}#comment-${comment}` : `/post/${post}`;
}

/** A community's own page — societies have a richer shell at /societies. */
function spaceHref(data: NotificationData, tab?: string): string {
  const id = str(data, "community_id") ?? str(data, "society_id");
  if (!id) return "/communities";
  const base = str(data, "society_id") ? `/societies/${id}` : `/communities/${id}`;
  return tab ? `${base}?tab=${tab}` : base;
}

function eventHref(data: NotificationData): string {
  const id = str(data, "event_id");
  return id ? `/events/${id}` : "/events";
}

function helpHref(data: NotificationData): string {
  const id = str(data, "request_id");
  return id ? `/help/${id}` : "/help";
}

/**
 * The exact screen a notification must open. Anchored `#comment-<id>` fragments
 * are scrolled into view and briefly highlighted by the post detail page.
 */
export function notificationHref(
  type: NotificationType,
  data: NotificationData
): string {
  switch (type) {
    // Post detail, anchored to the comment where we have one.
    case "post_like":
    case "comment":
    case "comment_reply":
    case "comment_like":
    case "mention":
    case "match_post":
      return postHref(data);

    // Chat.
    case "message":
      return str(data, "conversation_id")
        ? `/chat/${str(data, "conversation_id")}`
        : "/chat";
    case "message_request":
    case "message_request_accepted":
    // The payload carries only message_id, with no conversation to resolve it
    // against, so these land on the inbox rather than a wrong thread.
    case "message_reaction":
    case "match":
    case "matching_accepted":
      return "/chat";
    // A chat room's conversation lives ON the room now, not in the global Chat
    // inbox: Community -> Room -> Chat. `/communities/<id>?tab=chat` is the one
    // link that resolves for every kind of space — the room page opens its Chat
    // tab, a society redirects to /societies/<id> (verified communities have no
    // chat), and a Discover team room redirects to /chat/c/<id>. Membership is
    // re-checked server-side on arrival either way.
    case "community_message":
      return str(data, "community_id")
        ? `/communities/${str(data, "community_id")}?tab=chat`
        : "/communities";

    // Discover.
    case "matching_request":
      return "/discover";
    case "smart_match_application":
    case "smart_match_accepted":
    case "smart_match_mention":
      return "/discover/post";

    // Community & society surfaces. Manage-queue destinations open the Manage
    // tab directly via ?tab=, which the space shells honour.
    case "community_join_request":
    case "community_post_review":
      return spaceHref(data, "manage");
    case "community_post":
    case "community_post_approved":
    case "community_post_rejected":
    case "community_join_approved":
    case "community_join_rejected":
    case "community_approved":
    case "community_rejected":
    case "society_announcement":
    case "society_role":
    case "society_role_removed":
      return spaceHref(data);

    // Events.
    case "event_approved":
    case "event_message":
    case "event_rejected":
    case "event_post_request":
    case "event_organizer_added":
    case "event_organizer_removed":
    case "event_reminder":
    case "event_updated":
    case "waitlist_promoted":
      return eventHref(data);

    // Campus Help.
    case "help_response":
    case "help_offer_accepted":
    case "help_follow":
    case "help_thanked":
    case "help_resolved":
      return helpHref(data);

    // Aura, badges, moderation, system.
    case "level_up":
    case "aura_adjusted":
    case "leaderboard_top_finish":
      return "/profile/aura";
    case "achievement":
      return "/profile/badges";
    case "content_moderated":
    case "moderation_warning":
    case "appeal_result":
      return "/appeals";
    case "announcement":
      return str(data, "url") ?? "/home";

    default:
      return assertNever(type);
  }
}

/** Compile-time exhaustiveness: an unhandled type fails `npm run build`. */
function assertNever(value: never): never {
  throw new Error(`Unhandled notification type: ${String(value)}`);
}
