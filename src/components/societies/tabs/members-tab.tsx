"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { OfficerRow } from "@/components/societies/officer-row";
import type { OfficerVM } from "@/lib/societies/types";

type FollowerVM = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  gender: string | null;
};

export function MembersTab({
  description,
  officers,
  followers,
}: {
  description: string | null;
  officers: OfficerVM[];
  followers: FollowerVM[];
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (name: string, username: string | null) =>
    !q || name.toLowerCase().includes(q) || (username?.toLowerCase().includes(q) ?? false);

  const filteredOfficers = officers.filter((o) =>
    matches(o.full_name ?? o.username ?? "", o.username)
  );
  const filteredFollowers = followers.filter((f) =>
    matches(f.full_name ?? f.username ?? "", f.username)
  );
  const empty = officers.length === 0 && followers.length === 0;

  return (
    <div className="space-y-5">
      {/* Plain title + text, no card: the description is prose about the
          society, not another tappable surface competing with the roster. */}
      {description && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-fg">Description</h2>
          <p className="whitespace-pre-wrap text-[14px] text-fg-muted">{description}</p>
        </section>
      )}

      {empty ? (
        <div className="rounded-[14px] bg-card px-5 py-10 text-center">
          <Users className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
          <p className="mt-3 font-semibold text-fg">No members listed</p>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members…"
              aria-label="Search members"
              className="glass h-11 w-full rounded-[var(--radius-pill)] pl-9 pr-4 text-[15px] text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
            />
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-fg">
              Leadership &amp; Officers ({filteredOfficers.length})
            </h2>
            {filteredOfficers.length === 0 ? (
              <p className="rounded-[14px] bg-card px-4 py-6 text-center text-sm text-fg-muted">
                No match.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredOfficers.map((o) => (
                  <OfficerRow key={o.user_id} officer={o} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-fg">
              Members ({filteredFollowers.length})
            </h2>
            {filteredFollowers.length === 0 ? (
              <p className="rounded-[14px] bg-card px-4 py-6 text-center text-sm text-fg-muted">
                No members yet.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredFollowers.map((p) => {
                  const name = p.full_name ?? p.username ?? "Member";
                  return (
                    <Link
                      key={p.id}
                      href={`/profile/${p.id}`}
                      prefetch={false}
                      // Plain row, no card — matches the events attendee list.
                      className="flex items-center gap-3 rounded-[12px] px-2 py-2.5 transition-colors hover:bg-card"
                    >
                      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold text-fg-muted">
                        {resolveAvatarUrl(p.avatar_url, p.gender) ? (
                          <AppImage src={resolveAvatarUrl(p.avatar_url, p.gender)!} alt="" sizes="36px" />
                        ) : (
                          name.charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-fg">
                          {name}
                        </span>
                        {p.username && (
                          <span className="block truncate text-xs text-fg-muted">
                            @{p.username}
                          </span>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
