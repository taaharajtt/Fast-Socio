"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageSquare, Search } from "lucide-react";
import { ChatRoomCard, type ChatRoomCardVM } from "@/components/communities/chat-room-card";

/**
 * The Community Chats directory.
 *
 * This list used to be the top 30 rooms by member count and nothing else, which
 * quietly buried every new community: a room starts at one member, sorts last,
 * and once the campus passed thirty approved rooms it never appeared on the hub
 * at all. The page now loads the whole directory and filters it by name here,
 * so finding a room no longer depends on how popular it already is.
 *
 * Filtering is client-side on purpose — the full set is small enough to ship in
 * the payload, and a keystroke-latency-free filter beats a round trip.
 */
export function ChatRoomDirectory({ rooms }: { rooms: ChatRoomCardVM[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
    );
  }, [rooms, query]);

  // The hub's EmptyState lives in a server module; this repeats its markup
  // rather than dragging that whole module into the client bundle.
  if (rooms.length === 0) {
    return (
      <div className="rounded-[14px] bg-card px-5 py-6 text-center">
        <span className="mx-auto block w-fit text-fg-muted">
          <MessageSquare className="h-7 w-7" aria-hidden />
        </span>
        <p className="mt-2 text-sm text-fg-muted">No community chats yet</p>
        <p className="mt-0.5 text-xs text-fg-disabled">
          <Link href="/communities/new" className="font-medium text-accent">
            Create the first one
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      {/* The search only earns its space once the list is long enough to scroll. */}
      {rooms.length > 8 && (
        <div className="relative mb-3">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search communities…"
            aria-label="Search community chats by name"
            className="glass h-11 w-full rounded-[var(--radius-pill)] pl-9 pr-4 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-muted">
          No community matches “{query.trim()}”.
        </p>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((c) => (
            <ChatRoomCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </>
  );
}
