import type { IncomingRequest } from "@/components/chat/request-row";

/**
 * Shape of the /chat inbox payload, shared by the server loader that produces
 * it and the client list that renders and re-fetches it.
 *
 * These live outside the loader module because that one is `server-only` — the
 * client component may import the types and the EPOCH sentinel, but must never
 * pull the Supabase server client in with them.
 */

export type InboxProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  gender: string | null;
  department: string | null;
  /** App-wide activity, or null when they publish none (privacy, RLS). */
  last_seen_at: string | null;
  /** Their read-receipt setting: false means we never render "Seen" to them. */
  read_receipts: boolean;
};

/**
 * A DISCOVER TEAM ROOM in the inbox.
 *
 * Discover team rooms (mig 0129) are `communities` rows carrying
 * `is_discover_group = true`. They are the ONE kind of group conversation still
 * in the global inbox: unlike a chat room or a society, a Discover room has no
 * profile page to host its own Chat tab — the conversation IS the whole thing —
 * so /chat is where it lives. Ordinary community rooms and verified communities
 * are excluded at the query layer on that same column.
 *
 * `is_society` / `is_official` are carried because the row shape is shared with
 * the rest of the space rendering; a Discover room is neither.
 */
export type InboxSpace = {
  id: string;
  name: string;
  avatar_url: string | null;
  cover_url: string | null;
  is_society: boolean;
  is_official: boolean;
  status: string;
  /**
   * Always true for anything that reaches the inbox now. These three fields are
   * what makes the row render as a Discover thread: a gradient
   * "Discover · <Mode>" capsule and the title the author chose.
   */
  is_discover_group: boolean;
  discover_mode: string | null;
  discover_title: string | null;
};

export type InboxThread =
  | {
      kind: "dm";
      ts: string;
      convId: string;
      otherId: string;
      preview: string | null;
      unread: number;
      /**
       * MY newest message in this thread, for the "Sent …/Seen …" status line.
       * Null when the other person spoke last (or when my last message fell
       * outside the preview window).
       */
      lastOutgoing: { createdAt: string; readAt: string | null } | null;
    }
  | { kind: "space"; ts: string; space: InboxSpace; preview: string | null };

export type InboxData = {
  me: string;
  /**
   * Started direct conversations, plus Discover team rooms — one recency-sorted
   * list. Community chat rooms and verified communities are NOT here: their
   * chat lives inside the room itself (/communities/[id] -> Chat).
   */
  threads: InboxThread[];
  /**
   * Matched people this viewer has not exchanged a message with yet. These are
   * NOT conversations, so they render on the Requests panel rather than in
   * Messages.
   */
  newMatches: string[];
  /** Every profile referenced by a thread, match or request, keyed by id. */
  profiles: Record<string, InboxProfile>;
  incoming: IncomingRequest[];
};

/** Sentinel for "no messages yet", so such a thread sorts to the bottom. */
export const EPOCH = "1970-01-01T00:00:00Z";
