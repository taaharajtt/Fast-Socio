"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import {
  joinCommunity,
  leaveCommunity,
} from "@/app/(student)/communities/actions";
import { communityIcon } from "@/lib/communities/icon";

export type CommunityVM = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  member_count: number;
  isMember: boolean;
  isOwner: boolean;
};

const BANNER_GRADIENT = "linear-gradient(135deg, #4c1d95, #7c3aed)";

function CommunityCard({ c }: { c: CommunityVM }) {
  const [pending, start] = useTransition();
  const [member, setMember] = useState(c.isMember);

  function toggle() {
    const next = !member;
    setMember(next);
    start(async () => {
      if (next) await joinCommunity(c.id);
      else await leaveCommunity(c.id);
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div
        className="relative h-[90px]"
        style={
          c.cover_url || c.avatar_url ? undefined : { background: BANNER_GRADIENT }
        }
      >
        {(c.cover_url || c.avatar_url) && (
          <AppImage
            src={c.cover_url ?? c.avatar_url ?? ""}
            alt=""
            sizes="(max-width: 448px) 100vw, 448px"
          />
        )}
        <div className="absolute inset-0 bg-black/40" />
        <Link
          href={`/communities/${c.id}`}
          className="absolute bottom-2.5 left-3 flex items-center gap-2"
        >
          <span className="text-2xl leading-none" aria-hidden>
            {communityIcon(c.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold text-white">
              {c.name}
            </span>
            <span className="block text-xs text-white/70">
              {c.member_count.toLocaleString()} member
              {c.member_count === 1 ? "" : "s"}
            </span>
          </span>
        </Link>
        {c.isOwner ? (
          <span className="absolute bottom-2.5 right-3 rounded-full bg-white/15 px-3 py-1 text-[13px] font-semibold text-white">
            Owner
          </span>
        ) : (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            aria-pressed={member}
            className={cn(
              "absolute bottom-2.5 right-3 rounded-full px-3.5 py-1 text-[13px] font-semibold transition-all active:scale-95 disabled:opacity-60",
              member ? "bg-white/15 text-white" : "bg-accent text-white"
            )}
          >
            {member ? "Joined" : "Join"}
          </button>
        )}
      </div>
      {c.description && (
        <p className="truncate px-3.5 py-2.5 text-[13px] text-fg-muted">
          {c.description}
        </p>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-disabled">
      {children}
    </p>
  );
}

export function CommunityBrowser({
  communities,
}: {
  communities: CommunityVM[];
}) {
  const [query, setQuery] = useState("");

  const { joined, discover } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c: CommunityVM) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.description?.toLowerCase().includes(q) ?? false);
    const visible = communities.filter(match);
    return {
      joined: visible.filter((c) => c.isMember),
      discover: visible.filter((c) => !c.isMember),
    };
  }, [communities, query]);

  return (
    <>
      <div className="relative mt-4">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-fg-muted"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a community..."
          aria-label="Find a community"
          className="h-12 w-full rounded-xl bg-card pl-11 pr-4 text-[15px] text-fg placeholder:text-fg-disabled outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {joined.length === 0 && discover.length === 0 && (
        <p className="py-16 text-center text-sm text-fg-muted">
          No communities found.
        </p>
      )}

      {joined.length > 0 && (
        <section>
          <SectionLabel>Your Communities</SectionLabel>
          <div className="space-y-2.5">
            {joined.map((c) => (
              <CommunityCard key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}

      {discover.length > 0 && (
        <section>
          <SectionLabel>Discover More</SectionLabel>
          <div className="space-y-2.5">
            {discover.map((c) => (
              <CommunityCard key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
