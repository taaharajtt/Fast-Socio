"use client";

import { useState, useTransition } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import { roleLabel } from "@/lib/societies/constants";
import {
  assignableRoles,
  canRemoveRole,
  type SocietyOfficerRole,
  type Viewer,
} from "@/lib/societies/logic";
import {
  searchStudents,
  assignSocietyRole,
  removeSocietyRole,
  type StudentHit,
} from "@/app/(student)/societies/actions";
import type { OfficerVM } from "@/lib/societies/types";

export function MemberRoleList({
  societyId,
  officers: initial,
  viewer,
}: {
  societyId: string;
  officers: OfficerVM[];
  viewer: Viewer;
}) {
  const [officers, setOfficers] = useState(initial);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [picked, setPicked] = useState<StudentHit | null>(null);
  const [role, setRole] = useState<SocietyOfficerRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [searching, startSearch] = useTransition();

  const roles = assignableRoles(viewer);

  function runSearch(q: string) {
    setQuery(q);
    setPicked(null);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    startSearch(async () => setHits(await searchStudents(q)));
  }

  function assign() {
    if (!picked || !role) return;
    setError(null);
    start(async () => {
      const res = await assignSocietyRole(societyId, picked.id, role);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Reflect locally (owner-first ordering handled server-side on reload).
      setOfficers((prev) => {
        const rest = prev.filter((o) => o.user_id !== picked.id);
        return [
          ...rest,
          {
            user_id: picked.id,
            role,
            title: null,
            full_name: picked.full_name,
            username: picked.username,
            avatar_url: picked.avatar_url,
          },
        ];
      });
      setPicked(null);
      setRole(null);
      setQuery("");
      setHits([]);
    });
  }

  function remove(o: OfficerVM) {
    start(async () => {
      const res = await removeSocietyRole(societyId, o.user_id);
      if (res.ok) setOfficers((prev) => prev.filter((x) => x.user_id !== o.user_id));
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {roles.length > 0 && (
        <div className="space-y-2 rounded-[14px] bg-card p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => runSearch(e.target.value)}
              placeholder="Add officer by name or roll number…"
              className="h-10 w-full rounded-[10px] bg-bg-elevated pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/30"
            />
          </div>

          {searching && <p className="text-xs text-fg-muted">Searching…</p>}

          {!picked &&
            hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setPicked(h)}
                className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-white/5"
              >
                <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white/10 text-xs font-bold text-fg-muted">
                  {h.avatar_url ? (
                    <AppImage src={h.avatar_url} alt="" sizes="32px" />
                  ) : (
                    (h.full_name ?? h.username ?? "?").charAt(0).toUpperCase()
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {h.full_name ?? h.username}
                  </span>
                  {h.username && (
                    <span className="block truncate text-xs text-fg-muted">
                      @{h.username}
                    </span>
                  )}
                </span>
              </button>
            ))}

          {picked && (
            <div className="space-y-2 rounded-[10px] bg-bg-elevated p-2.5">
              <p className="text-sm font-medium">
                {picked.full_name ?? picked.username}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {roles.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                      role === r ? "bg-accent text-white" : "bg-card text-fg-muted"
                    )}
                  >
                    {roleLabel(r)}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPicked(null);
                    setRole(null);
                  }}
                  className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-fg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!role || pending}
                  onClick={assign}
                  className="flex flex-1 items-center justify-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden /> Appoint
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="space-y-2">
        {officers.map((o) => {
          const removable = o.role !== "owner" && canRemoveRole(viewer, o.role);
          return (
            <div
              key={o.user_id}
              className="flex items-center gap-3 rounded-[14px] bg-card p-3"
            >
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold text-fg-muted">
                {o.avatar_url ? (
                  <AppImage src={o.avatar_url} alt="" sizes="36px" />
                ) : (
                  (o.full_name ?? o.username ?? "?").charAt(0).toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg">
                  {o.full_name ?? o.username ?? "Member"}
                </span>
                <span className="block text-xs text-accent">
                  {o.title?.trim() || roleLabel(o.role)}
                </span>
              </span>
              {removable && (
                <button
                  type="button"
                  aria-label="Remove officer"
                  disabled={pending}
                  onClick={() => remove(o)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:text-error"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
