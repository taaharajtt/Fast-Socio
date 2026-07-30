import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { MatchRow, type MatchListRow } from "@/components/profile/match-row";

/**
 * Second degree (fix-056): the matches of someone YOU have matched with.
 *
 * One hop, not arbitrary browsing. The rule is enforced inside
 * `get_matches_of()` — and `matches` itself has RLS allowing a user to read
 * only rows they are part of, so hand-crafting a request cannot walk the graph
 * either. Asking about a non-match returns an empty set rather than raising,
 * which is indistinguishable from "they have no matches" and so leaks nothing.
 *
 * Note the deliberate omission: these rows carry NO match percentage. The score
 * between two other people is not the viewer's to see.
 */
export default async function SecondDegreeMatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const me = await getAuthUserId();
  if (!me) notFound();
  // Your own list lives at /profile/matches and shows percentages.
  if (id === me) notFound();

  const [{ data: owner }, { data }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", id).maybeSingle(),
    supabase.rpc("get_matches_of", { p_user: id }),
  ]);

  const rows = (data as MatchListRow[] | null) ?? [];
  const name = (owner as { full_name: string | null } | null)?.full_name ?? "They";

  return (
    <div className="mx-auto w-full max-w-md pb-24">
      <header className="flex items-center gap-2 px-4 py-3">
        <Link
          href="/profile/matches"
          aria-label="Back to your matches"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold tracking-tight">
            {name}&rsquo;s matches
          </h1>
          <p className="text-xs text-fg-muted">
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 px-8 text-center">
          <Users className="h-8 w-8 text-fg-muted" aria-hidden />
          <p className="font-semibold text-fg">Nothing to show</p>
          <p className="-mt-1 text-sm text-fg-muted">
            Either they haven&rsquo;t matched with anyone yet, or this list
            isn&rsquo;t yours to see.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-glass-border border-y border-glass-border">
          {rows.map((row) => (
            // No further hop — the boundary is one step, so these rows do not
            // link onward. No chat shortcut either: you have not matched them.
            <MatchRow key={row.id} row={row} showChat={false} />
          ))}
        </div>
      )}
    </div>
  );
}
