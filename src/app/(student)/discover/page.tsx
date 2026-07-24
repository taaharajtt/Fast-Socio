import { SwipeDeck } from "@/components/discover/swipe-deck";
import { PostIntentButton } from "@/components/discover/post-intent-button";
import {
  getDiscoverSwipeDeck,
  getMyDiscoverData,
} from "@/app/(student)/discover/discover-actions";

/**
 * Discover — one continuous swipe experience.
 *
 * No tabs, no filters, no browsable list. A single deck mixes SOCIO people with
 * the campus opportunities students post (project partners, hackathon teams,
 * sports plans, recruitment calls, FYP teammates); swipe right to act, left to
 * dismiss. The only other control is "Post", which puts your own intent into
 * everyone else's deck.
 */
export default async function DiscoverPage() {
  const [cards, mine] = await Promise.all([
    getDiscoverSwipeDeck(),
    getMyDiscoverData(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold tracking-tight">Discover</h1>
        {mine && <PostIntentButton data={mine} />}
      </header>

      <SwipeDeck initial={cards} />
    </main>
  );
}
