import { Suspense } from "react";
import { cookies } from "next/headers";
import { SwipeDeck } from "@/components/discover/swipe-deck";
import { PostIntentButton } from "@/components/discover/post-intent-button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScreenHeader } from "@/components/ui";
import { timed } from "@/lib/perf";
import {
  getDiscoverSwipeDeck,
  getMyDiscoverData,
} from "@/app/(student)/discover/discover-actions";
import { SEED_COOKIE } from "@/lib/discover/session-seed";

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
    /* Discover is the one screen that fills the viewport and never scrolls, so
       it takes a definite height (not flex-1) — that is what lets the card
       stack below shrink on short phones instead of shoving the action row
       off. */
    <main className="mx-auto flex h-[var(--shell-content-h)] w-full min-h-0 max-w-md flex-col px-4 py-3">
      <ScreenHeader
        title="Discover"
        className="mb-3"
        action={
          <Suspense fallback={<PostIntentButton />}>
            <PostButtonSlot />
          </Suspense>
        }
      />

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
  // UAT-15: the shuffle seed for THIS session. A server component cannot read
  // sessionStorage, so the client mirrors its session seed into a cookie and
  // rotates it — see `lib/discover/session-seed`. Absent on a first-ever visit,
  // which simply means the unseeded (pre-0178) order for that one page.
  //
  // Reading a cookie makes this slot dynamic, which it already was: the deck is
  // per-viewer and behind Suspense, and the prerendered shell above does not
  // touch it.
  const seed = (await cookies()).get(SEED_COOKIE)?.value ?? null;

  // The deck now arrives as a PAGE — cards plus the continuation state the
  // client needs to fetch the next one. Handing that whole object to SwipeDeck
  // is what lets it distinguish "still loading more" from "genuinely done".
  const page = await timed("discover:deck", () =>
    getDiscoverSwipeDeck({ seed })
  );
  return <SwipeDeck initial={page} seed={seed} />;
}

/** The card + action row, at the exact geometry SwipeDeck renders, so nothing
 *  moves when the real deck replaces it. Mirrors discover/loading.tsx. */
function DeckSkeleton() {
  return (
    <>
      <div className="mx-auto aspect-[3/4.4] max-h-[calc(var(--shell-content-h)-var(--deck-chrome))] w-full min-h-0 max-w-sm">
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
