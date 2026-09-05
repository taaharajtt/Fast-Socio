import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { SkeletonRows } from "@/components/ui/skeleton";
import { MatchRow, type MatchListRow } from "@/components/profile/match-row";

/**
 * PERF/CORRECTNESS — the default export is deliberately NOT async and never
 * awaits `params`. See the same note on /post/[id]: under Cache Components,
 * awaiting params (or calling notFound()) at the top level makes the route
 * dynamic while Next is still building its fallback shell, and the resume of
 * that shell then throws
 *
 *   InvariantError: postponed state should not be provided when fallback
 *   params are provided        (E592)
 *
 * which surfaces as a 500 on the page. Keeping the shell request-free lets the
 * fallback prerender on its own; everything request-scoped lives in the async
 * body behind the Suspense boundary.
 *
 * Second degree (fix-056): the matches of someone YOU have matched with.
 *
 * One hop, not arbitrary browsing. The rule is enforced inside
 * `get_matches_of()` — and `matches` itself has RLS allowing a user to read
 * only rows they are part of, so hand-crafting a request cannot walk the graph
 * either. Asking about a non-match returns an empty set rather than raising,
 * which is indistinguishable from "they have no matches" and so leaks nothing.
 *
 * Mig 0182 puts the owner's `show_matches` preference, a live-and-unbanned
 * check and the block check inside that same function, so a hidden list, a
 * newly-unmatched viewer, a blocked pair, a banned or deactivated owner and a
 * plain stranger all reach this page identically: the empty state. Nothing on
 * this route is cached (it reads auth-scoped data behind Suspense), so a list
 * cannot flash before the check lands.
 *
 * Note the deliberate omission: these rows carry NO match percentage. The score
 * between two other people is not the viewer's to see.
 */
export default function SecondDegreeMatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
      </header>

      <Suspense fallback={<SkeletonRows />}>
        <SecondDegreeMatchesBody params={params} />
      </Suspense>
    </div>
  );
}

async function SecondDegreeMatchesBody({
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
    <>
      <div className="min-w-0 px-4 pb-3">
        <h1 className="truncate text-lg font-bold tracking-tight">
          {name}&rsquo;s matches
        </h1>
        <p className="text-xs text-fg-muted">
          {rows.length} {rows.length === 1 ? "person" : "people"}
        </p>
      </div>

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
            // Informational only: no onward hop, no chat shortcut (you have not
            // matched them) and no Unmatch (not your relationship to end).
            <MatchRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </>
  );
}
