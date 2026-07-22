"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { GlassInput } from "@/components/ui";
import { searchTeammates } from "@/app/(student)/discover/smart-match-actions";
import type { TeamMember } from "@/lib/smart-match/types";

/**
 * Tag the "already booked" team members on a Project / Hackathon post. Searches
 * onboarded students by name/roll number (debounced), shows picks as safe
 * profile chips. The confirmed user ids are what the create RPC stores — never
 * raw @handle text — so a tag can't grant anyone permissions.
 */
export function TeamMemberMentions({
  value,
  onChange,
}: {
  value: TeamMember[];
  onChange: (members: TeamMember[]) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    timer.current = setTimeout(
      async () => {
        if (query.length < 2) {
          setResults([]);
          return;
        }
        setLoading(true);
        const rows = await searchTeammates(query);
        setLoading(false);
        const have = new Set(value.map((v) => v.id));
        setResults(rows.filter((r) => !have.has(r.id)));
      },
      query.length < 2 ? 0 : 250
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, value]);

  function add(m: TeamMember) {
    if (value.length >= 20) return;
    onChange([...value, m]);
    setQ("");
    setResults([]);
  }

  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((m) => (
            <span
              key={m.id}
              className="glass inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-xs"
            >
              <span className="relative h-5 w-5 overflow-hidden rounded-full bg-bg-elevated">
                {m.avatarUrl && <AppImage src={m.avatarUrl} alt="" sizes="20px" />}
              </span>
              @{m.username ?? "student"}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v.id !== m.id))}
                aria-label={`Remove ${m.username ?? "member"}`}
                className="text-fg-muted hover:text-fg"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <GlassInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search students to tag…"
          className="h-11"
          data-no-drag
        />
        {q.trim().length >= 2 && (loading || results.length > 0) && (
          <div
            className="glass-strong absolute inset-x-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-xl border border-glass-border"
            data-no-drag
          >
            {loading ? (
              <p className="px-3 py-2.5 text-sm text-fg-muted">Searching…</p>
            ) : (
              results.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => add(m)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
                >
                  <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
                    {m.avatarUrl && <AppImage src={m.avatarUrl} alt="" sizes="28px" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {m.fullName ?? "Student"}
                    </span>
                    <span className="block truncate text-xs text-fg-muted">
                      @{m.username}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
