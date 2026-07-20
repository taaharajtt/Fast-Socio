"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Trash2, X, Search, Loader2 } from "lucide-react";
import { GlassSheet } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import {
  addOrganizer,
  removeOrganizer,
  searchStudents,
  deleteEvent,
  type OrganizerCandidate,
} from "@/app/(student)/events/actions";

export type Organizer = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

/**
 * Host-only management for an event: appoint/remove co-organizers and delete
 * the event. Rendered only when the viewer is the host; the underlying RPCs
 * re-check host/admin, so this is UX, not the security boundary.
 */
export function EventHostControls({
  eventId,
  hostId,
  initialOrganizers,
}: {
  eventId: string;
  hostId: string;
  initialOrganizers: Organizer[];
}) {
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="mt-3 rounded-[var(--radius-card)] bg-card p-4">
      <p className="text-sm font-semibold text-fg">Host controls</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="glass flex items-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium text-fg"
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          Organizers
        </button>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="flex items-center gap-2 rounded-[var(--radius-pill)] bg-error/10 px-4 py-2 text-sm font-medium text-error"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Delete event
        </button>
      </div>

      <GlassSheet
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        label="Manage organizers"
      >
        {manageOpen && (
          <ManageOrganizers
            eventId={eventId}
            hostId={hostId}
            initialOrganizers={initialOrganizers}
            onChanged={() => router.refresh()}
          />
        )}
      </GlassSheet>

      <GlassSheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        label="Delete event"
      >
        <DeleteConfirm eventId={eventId} onCancel={() => setDeleteOpen(false)} />
      </GlassSheet>
    </div>
  );
}

function ManageOrganizers({
  eventId,
  hostId,
  initialOrganizers,
  onChanged,
}: {
  eventId: string;
  hostId: string;
  initialOrganizers: Organizer[];
  onChanged: () => void;
}) {
  const [organizers, setOrganizers] = useState<Organizer[]>(initialOrganizers);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrganizerCandidate[]>([]);
  const [searching, startSearch] = useTransition();
  const [pending, startWrite] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const excluded = new Set([hostId, ...organizers.map((o) => o.id)]);

  function onQueryChange(value: string) {
    setQuery(value);
    setError(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      const res = await searchStudents(value);
      setResults(res.filter((r) => !excluded.has(r.id)));
    });
  }

  function add(candidate: OrganizerCandidate) {
    setError(null);
    startWrite(async () => {
      const res = await addOrganizer(eventId, candidate.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOrganizers((prev) => [...prev, candidate]);
      setResults((prev) => prev.filter((r) => r.id !== candidate.id));
      setQuery("");
      onChanged();
    });
  }

  function remove(userId: string) {
    setError(null);
    startWrite(async () => {
      const res = await removeOrganizer(eventId, userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOrganizers((prev) => prev.filter((o) => o.id !== userId));
      onChanged();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold">Co-organizers</h3>
        <p className="mt-0.5 text-sm text-fg-muted">
          They can run door check-in and post in the discussion. Only you can
          delete the event or change organizers.
        </p>
      </div>

      {/* Current co-organizers */}
      {organizers.length > 0 && (
        <div className="space-y-1">
          {organizers.map((o) => (
            <div key={o.id} className="flex items-center gap-3 rounded-[12px] px-1 py-2">
              <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
                {o.avatar_url && (
                  <AppImage src={o.avatar_url} alt="" sizes="36px" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">
                  {o.full_name ?? "Student"}
                </p>
                {o.username && (
                  <p className="truncate text-xs text-fg-muted">{o.username}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(o.id)}
                disabled={pending}
                aria-label={`Remove ${o.full_name ?? "organizer"}`}
                className="shrink-0 rounded-full p-1.5 text-fg-muted hover:bg-glass hover:text-error disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search + add */}
      <div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Add by name or roll number…"
            aria-label="Search students"
            className="glass h-11 w-full rounded-[var(--radius-pill)] pl-9 pr-4 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
          />
          {searching && (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-fg-muted"
              aria-hidden
            />
          )}
        </div>

        {query.trim().length >= 2 && (
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {results.length === 0 && !searching ? (
              <p className="px-1 py-3 text-center text-sm text-fg-muted">
                No students found.
              </p>
            ) : (
              results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => add(r)}
                  disabled={pending}
                  className="flex w-full items-center gap-3 rounded-[12px] px-1 py-2 text-left transition-colors hover:bg-glass disabled:opacity-50"
                >
                  <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
                    {r.avatar_url && (
                      <AppImage src={r.avatar_url} alt="" sizes="36px" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">
                      {r.full_name ?? "Student"}
                    </p>
                    {r.username && (
                      <p className="truncate text-xs text-fg-muted">
                        {r.username}
                      </p>
                    )}
                  </div>
                  <UserPlus className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function DeleteConfirm({
  eventId,
  onCancel,
}: {
  eventId: string;
  onCancel: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    start(async () => {
      // deleteEvent redirects to /events on success; only returns on failure.
      const res = await deleteEvent(eventId);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Trash2 className="h-5 w-5 text-error" aria-hidden />
        <h3 className="text-lg font-bold">Delete this event?</h3>
      </div>
      <p className="text-sm text-fg-muted">
        This can&rsquo;t be undone. RSVPs, the waitlist, discussion and check-in
        records will all be removed.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={confirm}
        className="w-full rounded-[var(--radius-sm)] bg-error px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Delete event"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onCancel}
        className="glass w-full rounded-[var(--radius-sm)] px-4 py-3 text-sm text-fg"
      >
        Cancel
      </button>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
