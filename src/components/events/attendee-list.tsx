"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Check } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";

export type Attendee = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  checked_in: boolean;
};

/**
 * Scrollable, searchable "who's going" list. Search matches the DISPLAY NAME
 * (not the roll number) per the events spec. Each row links to the attendee's
 * profile. Purely client-side over the server-loaded list — fine for campus-
 * scale events; the page caps the fetch.
 */
export function AttendeeList({ attendees }: { attendees: Attendee[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return attendees;
    return attendees.filter((a) =>
      (a.full_name ?? "").toLowerCase().includes(q)
    );
  }, [attendees, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search attendees by name"
          className="glass h-11 w-full rounded-[var(--radius-pill)] pl-9 pr-4 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
        />
      </div>

      <p className="mt-3 px-1 text-xs text-fg-muted">
        {query.trim()
          ? `${filtered.length} of ${attendees.length}`
          : `${attendees.length} going`}
      </p>

      <div className="mt-1 flex-1 space-y-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-fg-muted">
            {attendees.length === 0
              ? "No one has RSVP'd yet."
              : "No one matches that name."}
          </p>
        ) : (
          filtered.map((a) => (
            <Link
              key={a.id}
              href={`/profile/${a.id}`}
              className="flex items-center gap-3 rounded-[12px] px-2 py-2.5 transition-colors hover:bg-card"
            >
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-card">
                {a.avatar_url ? (
                  <AppImage
                    src={a.avatar_url}
                    alt={a.full_name ?? ""}
                    sizes="40px"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-fg">
                  {a.full_name ?? "Student"}
                </p>
                {a.username && (
                  <p className="truncate text-[13px] text-fg-muted">
                    {a.username}
                  </p>
                )}
              </div>
              {a.checked_in && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                  <Check className="h-3 w-3" aria-hidden />
                  Checked in
                </span>
              )}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
