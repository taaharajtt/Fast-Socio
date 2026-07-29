import { Suspense } from "react";
import { SwipeDeck } from "@/components/discover/swipe-deck";
import { PostIntentButton } from "@/components/discover/post-intent-button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLogo } from "@/components/ui/section-logo";
import { timed } from "@/lib/perf";
import {
  getDiscoverSwipeDeck,
  getMyDiscoverData,
} from "@/app/(student)/discover/discover-actions";

// No `unstable_instant` export here — it only adds build-time validation, and
// that validation currently trips on @sentry/nextjs reading the `sentry-trace`
// header during every server render. See the note in next.config.ts; the static
// shell itself is unaffected (this route builds as Partial Prerender).

/**
 * Discover — one continuous swipe experience.
 *
 * No tabs, no filters, no browsable list. A single deck mixes SOCIO people with
 * the campus opportunities students post (project partners, hackathon teams,
 * sports plans, recruitment calls, FYP teammates); swipe right to act, left to
 * dismiss. The only other control is "Post", which puts your own intent into
 * everyone else's deck.
 *
 * Building the deck is the most expensive read in the app (candidate scoring
 * plus the unified-feed RPC), so it is the one thing here that waits. The title
 * and the Post button ship in the prerendered shell and are usable immediately.
 */
export default function DiscoverPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <SectionLogo />
          <h1 className="text-lg font-bold tracking-tight">Discover</h1>
        </div>
        <Suspense fallback={<PostIntentButton />}>
          <PostButtonSlot />
        </Suspense>
      </header>

      <Suspense fallback={<DeckSkeleton />}>
        <DeckSlot />
      </Suspense>
    </main>
  );
}

async function PostButtonSlot() {
  const mine = await getMyDiscoverData();
  return mine ? <PostIntentButton data={mine} /> : null;
}

async function DeckSlot() {
  const cards = await timed("discover:deck", getDiscoverSwipeDeck);
  return <SwipeDeck initial={cards} />;
}

/** The card + action row, at the exact geometry SwipeDeck renders, so nothing
 *  moves when the real deck replaces it. Mirrors discover/loading.tsx. */
function DeckSkeleton() {
  return (
    <>
      <div className="mx-auto aspect-[3/4.4] w-full max-w-sm flex-1">
        <Skeleton className="h-full w-full rounded-3xl" />
      </div>
      <div className="mt-5 flex items-center justify-center gap-6">
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-16 w-16 rounded-full" />
      </div>
    </>
  );
}
