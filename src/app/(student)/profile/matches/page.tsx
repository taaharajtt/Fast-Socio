import Link from "next/link";
import { ChevronLeft, Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MatchRow, type MatchListRow } from "@/components/profile/match-row";

/**
 * Your matches (fix-056), reached from the Matches stat card on the Me page.
 *
 * Route chosen: `/profile/matches`, sitting alongside `/profile/aura` and
 * `/profile/badges` rather than a top-level `/matches` — it is a view of your
 * own profile data and inherits those pages' back-to-profile chrome.
 *
 * Reads `get_my_matches()`, which resolves the pair from either side of the
 * canonical `matches` row and carries fix-037's percentage.
 */
export default async function MatchesPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_matches");
  const rows = (data as MatchListRow[] | null) ?? [];

  return (
    <div className="mx-auto w-full max-w-md pb-24">
      <header className="flex items-center gap-2 px-4 py-3">
        <Link
          href="/profile?tab=stats"
          aria-label="Back to profile"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight">Your matches</h1>
          <p className="text-xs text-fg-muted">
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 px-8 text-center">
          <Heart className="h-8 w-8 text-fg-muted" aria-hidden />
          <p className="font-semibold text-fg">No matches yet</p>
          <p className="-mt-1 text-sm text-fg-muted">
            Swipe in Discover — when you both like each other, they show up here.
          </p>
          <Link
            href="/discover"
            className="gradient-brand mt-2 rounded-full px-4 py-2 text-sm font-semibold text-white"
          >
            Open Discover
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-glass-border border-y border-glass-border">
          {rows.map((row) => (
            <MatchRow
              key={row.id}
              row={row}
              // One hop: from a person you matched with, you may look at THEIR
              // matches. The boundary is enforced in get_matches_of(), not here.
              hopHref={`/profile/matches/${row.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
