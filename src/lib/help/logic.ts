/**
 * Campus Help Network — pure domain logic.
 *
 * No React, no Supabase, no lucide: everything here is a plain function of its
 * inputs so it can be unit-tested and reused on both server and client. The DB
 * (mig 0102) is the source of truth for the same rules — these mirror it so the
 * UI can decide what to show without a round trip, and the CHECK constraints /
 * RPC guards remain the real enforcement.
 */

export const HELP_CATEGORIES = [
  "academic",
  "advice",
  "help",
  "sports",
  "events",
  "lost_found",
] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

// Urgency is stored as text for schema stability, but the product now exposes it
// as a single toggle: a request is either urgent or not. Only 'normal'/'urgent'
// are ever written by the UI; 'low' remains a legal DB value for older rows.
export const HELP_URGENCIES = ["low", "normal", "urgent"] as const;
export type HelpUrgency = (typeof HELP_URGENCIES)[number];

export const HELP_STATUSES = ["open", "resolved"] as const;
export type HelpStatus = (typeof HELP_STATUSES)[number];

export function isHelpCategory(v: unknown): v is HelpCategory {
  return typeof v === "string" && (HELP_CATEGORIES as readonly string[]).includes(v);
}

export function isHelpUrgency(v: unknown): v is HelpUrgency {
  return typeof v === "string" && (HELP_URGENCIES as readonly string[]).includes(v);
}

/** Coerce arbitrary input to a valid urgency, defaulting to "normal". */
export function normalizeUrgency(v: unknown): HelpUrgency {
  return isHelpUrgency(v) ? v : "normal";
}

/** The single urgent toggle maps onto the text column: on → urgent, off → normal. */
export function urgencyFromToggle(isUrgent: boolean): HelpUrgency {
  return isUrgent ? "urgent" : "normal";
}

/** Whether a request should show the URGENT capsule / rank boost. */
export function isUrgentRequest(u: HelpUrgency): boolean {
  return u === "urgent";
}

/** Sort key: urgent first, then normal, then low (ascending = most urgent). */
export function urgencyRank(u: HelpUrgency): number {
  return { urgent: 0, normal: 1, low: 2 }[u];
}

/** Minimal shape the SOCIO ranking needs from a request. */
export type SocioSortable = { urgency: HelpUrgency; created_at: string };

/**
 * SOCIO feed order: urgent unresolved asks float to the top, then everything
 * else by most-recent. A pure comparator so it's unit-testable and reused by the
 * feed and the home strip.
 */
export function compareSocio(a: SocioSortable, b: SocioSortable): number {
  const byUrgency = urgencyRank(a.urgency) - urgencyRank(b.urgency);
  if (byUrgency !== 0) return byUrgency;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

/** Minimal shape ME grouping needs from a request. */
export type MyGroupable = { status: HelpStatus; response_count: number };

export type MyHelpGroups<T extends MyGroupable> = {
  /** Open asks still waiting on help. */
  active: T[];
  /** Open asks that already have at least one response to review. */
  withResponses: T[];
  /** Closed-out asks (your history). */
  resolved: T[];
};

/**
 * Partition the current user's requests into the ME sections. `withResponses` is
 * a view over `active` (open asks that have offers to review), not a disjoint
 * bucket — the panel highlights them without hiding them from Active.
 */
export function groupMyRequests<T extends MyGroupable>(rows: T[]): MyHelpGroups<T> {
  const active = rows.filter((r) => r.status === "open");
  return {
    active,
    withResponses: active.filter((r) => r.response_count > 0),
    resolved: rows.filter((r) => r.status === "resolved"),
  };
}

/** Allowed status transitions: a request toggles between open and resolved. */
export function canTransition(from: HelpStatus, to: HelpStatus): boolean {
  if (from === to) return false;
  return (
    (from === "open" && to === "resolved") ||
    (from === "resolved" && to === "open")
  );
}

// ---------------------------------------------------------------------------
// Offer-approval lifecycle (mirrors help_responses.status in mig 0106).
// ---------------------------------------------------------------------------
export const HELP_OFFER_STATUSES = ["pending", "accepted", "declined"] as const;
export type HelpOfferStatus = (typeof HELP_OFFER_STATUSES)[number];

export function isHelpOfferStatus(v: unknown): v is HelpOfferStatus {
  return (
    typeof v === "string" && (HELP_OFFER_STATUSES as readonly string[]).includes(v)
  );
}

/** Only a pending offer can be approved or declined. */
export function canActOnOffer(status: HelpOfferStatus): boolean {
  return status === "pending";
}

/** An accepted offer has unlocked a chat between the two parties. */
export function offerUnlockedChat(status: HelpOfferStatus): boolean {
  return status === "accepted";
}

/** Allowed offer transitions: pending → accepted | declined, and nothing else. */
export function canTransitionOffer(
  from: HelpOfferStatus,
  to: HelpOfferStatus
): boolean {
  return from === "pending" && (to === "accepted" || to === "declined");
}

/** The viewer's relationship to a request. */
export type ViewerRel = {
  isOwner: boolean;
  isAdmin: boolean;
};

/** Only the owner may edit the content, and only while it is still open. */
export function canEditRequest(status: HelpStatus, rel: ViewerRel): boolean {
  return rel.isOwner && status === "open";
}

/** Owner or admin may mark an open request resolved. */
export function canResolve(status: HelpStatus, rel: ViewerRel): boolean {
  return (rel.isOwner || rel.isAdmin) && status === "open";
}

/** Owner or admin may reopen a resolved request. */
export function canReopen(status: HelpStatus, rel: ViewerRel): boolean {
  return (rel.isOwner || rel.isAdmin) && status === "resolved";
}

/** Only the owner (or admin) selects/thanks a helper. */
export function canSelectHelper(rel: ViewerRel): boolean {
  return rel.isOwner || rel.isAdmin;
}

/**
 * A signed-in student may respond to an OPEN request that isn't their own.
 * (The author "helping" their own request is nonsensical and is also blocked in
 * respond_to_help().)
 */
export function canRespond(
  status: HelpStatus,
  opts: { signedIn: boolean; isAuthor: boolean }
): boolean {
  return opts.signedIn && !opts.isAuthor && status === "open";
}

/** A response author may delete their own response unless it has been selected. */
export function canDeleteResponse(
  opts: { isResponseAuthor: boolean; isAdmin: boolean },
  isSelected: boolean
): boolean {
  if (opts.isAdmin) return true;
  return opts.isResponseAuthor && !isSelected;
}

/**
 * The anonymity contract, mirrored from the help_request_feed view: an author is
 * hidden only when the request is anonymous AND the viewer is neither its owner
 * nor an admin. Non-anonymous requests are never masked.
 */
export function shouldMaskAuthor(
  isAnonymous: boolean,
  rel: ViewerRel
): boolean {
  return isAnonymous && !rel.isOwner && !rel.isAdmin;
}

export type HelpAuthorFields = {
  isAnonymous: boolean;
  /** Already masked to null by the DB view when the viewer may not see it. */
  authorId: string | null;
  authorName: string | null;
  authorUsername: string | null;
  authorAvatarUrl: string | null;
};

export type HelpAuthorDisplay = {
  anonymous: boolean;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** Profile link, or null when there is no visible author to link to. */
  href: string | null;
};

/**
 * Normalize the (possibly DB-masked) author fields into what the card/detail
 * renders. When identity is hidden the fields arrive as null, so a null name is
 * treated as anonymous regardless of the flag — the view is authoritative.
 */
export function resolveHelpAuthor(f: HelpAuthorFields): HelpAuthorDisplay {
  const hidden = f.isAnonymous && !f.authorId;
  if (hidden || !f.authorName) {
    return {
      anonymous: true,
      name: "Anonymous",
      username: null,
      avatarUrl: null,
      href: null,
    };
  }
  return {
    anonymous: false,
    name: f.authorName,
    username: f.authorUsername,
    avatarUrl: f.authorAvatarUrl,
    href: f.authorId ? `/profile/${f.authorId}` : null,
  };
}
