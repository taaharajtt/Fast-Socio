/**
 * ONE message shape for every non-DM conversation surface.
 *
 * WHY THIS EXISTS. Community rooms, event discussions and society broadcasts
 * are three different tables with three different column vocabularies
 * (`sender_id` / `author_id`, `is_anonymous` only in two of them, `is_mine`
 * computed by a view in one), and each surface had grown its OWN bubble markup
 * around its own shape. That is why they drifted away from the Messages thread
 * — and from each other — on spacing, timestamps, sender treatment and every
 * interaction.
 *
 * Rather than rewrite the tables, each surface maps its row into this view
 * model at the edge and hands it to one row component. The mapping is here,
 * not in the components, so the fiddly parts (anonymity, "is this mine" when
 * the sender id is deliberately masked, a resolved avatar) are unit-tested.
 *
 * DELIBERATELY NOT USED BY THE DM THREAD. Direct messages carry voice notes,
 * shared posts, read receipts and selective reporting, none of which exist on
 * any of these three surfaces; folding them in would mean either a union type
 * with five unused branches or a rewrite of the one surface that already works.
 * The DM thread shares the PRIMITIVES below it instead — the composer, the
 * action sheet, the press gestures, the reaction rules, the merge helpers.
 */

import { resolveAvatarUrl } from "@/lib/avatar";
import type { QuotablePreview } from "@/lib/chat/reply-preview";

export type ConversationMessage = {
  id: string;
  /** NULL when the row is masked (anonymous) or the author is unknown. */
  authorId: string | null;
  authorName: string | null;
  /** Already resolved to a displayable URL (or null). */
  authorAvatar: string | null;
  body: string | null;
  /** Raw private `chat-media` storage path; signed at display time. */
  attachmentPath: string | null;
  attachmentType: "image" | null;
  pollId: string | null;
  isAnonymous: boolean;
  /** Sent by the person reading — drives the outgoing bubble treatment. */
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  pinned: boolean;
  replyToId: string | null;
  /** Client-only: an optimistic bubble's lifecycle. Absent on server rows. */
  status?: "sending" | "error";
  /** Client-only: object-URL preview for an image still uploading. */
  localSrc?: string;
};

/** The one place a surface decides what a masked/anonymous author is called. */
export function displayName(m: ConversationMessage, fallback = "Member"): string {
  if (m.isAnonymous) return m.mine ? "You (anonymous)" : "Anonymous";
  return m.authorName ?? fallback;
}

/** The quote-able projection of a message, for `replyPreviewText`. */
export function toQuotable(m: ConversationMessage): QuotablePreview {
  return {
    body: m.pollId && m.body ? `📊 ${m.body}` : m.body,
    attachment_type: m.attachmentType,
    shared_post_id: null,
    deleted_at: m.deletedAt,
  };
}

/**
 * The relationship line above a quote ("You replied to Ali", "Replied to you").
 *
 * A group thread cannot use the DM wording unchanged: there are more than two
 * people in it, so "them" is ambiguous and the quoted author has to be NAMED —
 * except when they are anonymous, where naming them is the one thing we must
 * not do.
 */
export function quoteLabel(
  reply: Pick<ConversationMessage, "mine">,
  quoted: ConversationMessage | null | undefined
): string {
  if (!quoted) return reply.mine ? "You replied" : "Replied";
  const who = quoted.mine
    ? reply.mine
      ? "yourself"
      : "you"
    : quoted.isAnonymous
      ? "an anonymous message"
      : (quoted.authorName ?? "a member");
  return reply.mine ? `You replied to ${who}` : `Replied to ${who}`;
}

/** True for a message nothing can be done to: a tombstone or an unsent bubble. */
export function isInert(m: ConversationMessage): boolean {
  return Boolean(m.deletedAt) || m.id.startsWith("temp-") || m.status === "error";
}

// ---------------------------------------------------------------------------
// Adapters. One per surface, at the edge of the component that owns the read.
// ---------------------------------------------------------------------------

/** `community_chat_view` row -> view model. */
export function fromCommunityRow(
  r: {
    id: string;
    sender_id: string | null;
    sender_name: string | null;
    sender_avatar: string | null;
    sender_gender: string | null;
    body: string;
    poll_id: string | null;
    is_anonymous: boolean;
    created_at: string;
    deleted_at: string | null;
    edited_at?: string | null;
    pinned_at?: string | null;
    reply_to_id?: string | null;
    attachment_url: string | null;
    attachment_type: string | null;
    _status?: "sending" | "error";
    _localSrc?: string;
  },
  meId: string
): ConversationMessage {
  return {
    id: r.id,
    // The view NULLs sender_id on someone else's anonymous message, so this is
    // "mine" exactly when the row is attributable to me — an anonymous message
    // of my own still resolves, because the view discloses my own id to me.
    authorId: r.sender_id,
    authorName: r.sender_name,
    authorAvatar: resolveAvatarUrl(r.sender_avatar, r.sender_gender),
    body: r.body === "" ? null : r.body,
    attachmentPath: r.attachment_url,
    attachmentType: r.attachment_type === "image" ? "image" : null,
    pollId: r.poll_id,
    isAnonymous: r.is_anonymous,
    mine: r.sender_id === meId,
    createdAt: r.created_at,
    editedAt: r.edited_at ?? null,
    deletedAt: r.deleted_at,
    pinned: Boolean(r.pinned_at),
    replyToId: r.reply_to_id ?? null,
    status: r._status,
    localSrc: r._localSrc,
  };
}

/** `event_messages` row (with its joined sender) -> view model. */
export function fromEventRow(
  r: {
    id: string;
    sender_id: string;
    sender_name: string | null;
    sender_avatar: string | null;
    body: string;
    created_at: string;
    edited_at?: string | null;
    deleted_at?: string | null;
    reply_to_id?: string | null;
    attachment_url?: string | null;
    attachment_type?: string | null;
    _status?: "sending" | "error";
    _localSrc?: string;
  },
  meId: string
): ConversationMessage {
  return {
    id: r.id,
    authorId: r.sender_id,
    authorName: r.sender_name,
    authorAvatar: r.sender_avatar,
    body: r.body === "" ? null : r.body,
    attachmentPath: r.attachment_url ?? null,
    attachmentType: r.attachment_type === "image" ? "image" : null,
    pollId: null,
    // Event discussion is attributed by design: attendees coordinate openly.
    isAnonymous: false,
    mine: r.sender_id === meId,
    createdAt: r.created_at,
    editedAt: r.edited_at ?? null,
    deletedAt: r.deleted_at ?? null,
    pinned: false,
    replyToId: r.reply_to_id ?? null,
    status: r._status,
    localSrc: r._localSrc,
  };
}

/** `society_announcement_feed` row -> view model. */
export function fromAnnouncementRow(r: {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
  title: string | null;
  body: string;
  poll_id: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  created_at: string;
  updated_at?: string | null;
  pinned: boolean;
  is_mine: boolean;
  is_anonymous?: boolean;
  reply_to_id?: string | null;
  _status?: "sending" | "error";
  _localSrc?: string;
}): ConversationMessage {
  // Older broadcasts (pre-mig 0147) carry a title. The channel is a
  // conversation now, so a title is folded into the body as its first line
  // rather than rendered as a card heading nothing else in the thread has.
  const titled =
    r.title && r.body ? `${r.title}\n${r.body}` : (r.title ?? (r.body || null));
  return {
    id: r.id,
    authorId: r.author_id,
    authorName: r.author_name,
    // The feed view returns a raw avatar path and no gender column, so the
    // gendered placeholder profiles use elsewhere is not available here; an
    // author with no avatar gets the empty fallback circle.
    authorAvatar: resolveAvatarUrl(r.author_avatar, null),
    // A poll announcement carries its question in `body` and PollCard prints
    // it, so the bubble must not print it a second time.
    body: r.poll_id ? null : titled,
    attachmentPath: r.attachment_url,
    attachmentType: r.attachment_type === "image" ? "image" : null,
    pollId: r.poll_id,
    isAnonymous: r.is_anonymous === true,
    mine: r.is_mine,
    createdAt: r.created_at,
    // A broadcast has no `edited_at` column; `updated_at` moves when the row is
    // edited (and when it is pinned), so an edit is only reported when the gap
    // is bigger than the write's own jitter.
    editedAt:
      r.updated_at &&
      new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 1000
        ? r.updated_at
        : null,
    // Broadcasts are hard-deleted (`delete_society_announcement`), so no
    // tombstone exists here — the row simply leaves the thread.
    deletedAt: null,
    pinned: r.pinned,
    replyToId: r.reply_to_id ?? null,
    status: r._status,
    localSrc: r._localSrc,
  };
}
