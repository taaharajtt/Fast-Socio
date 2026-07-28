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
  last_seen_at: string | null;
};

export type InboxSpace = {
  id: string;
  name: string;
  avatar_url: string | null;
  cover_url: string | null;
  is_society: boolean;
  status: string;
};

export type InboxThread =
  | {
      kind: "dm";
      ts: string;
      convId: string;
      otherId: string;
      preview: string | null;
      unread: number;
    }
  | { kind: "space"; ts: string; space: InboxSpace; preview: string | null };

export type InboxData = {
  me: string;
  threads: InboxThread[];
  /** Matched people with no conversation yet — surfaced above the threads. */
  newMatches: string[];
  /** Every profile referenced by a thread, match or request, keyed by id. */
  profiles: Record<string, InboxProfile>;
  incoming: IncomingRequest[];
};

/** Sentinel for "no messages yet", so such a thread sorts to the bottom. */
export const EPOCH = "1970-01-01T00:00:00Z";
