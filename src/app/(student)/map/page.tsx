import type { Metadata } from "next";
import { CampusMapExperience } from "@/components/map/campus-map-experience";
import { getActiveSportsPlans } from "@/app/(student)/discover/discover-actions";
import { resolvePlace } from "@/lib/map/places";
import type { SmartMatchPost } from "@/lib/smart-match/types";

export const metadata: Metadata = {
  title: "Campus Map",
  description: "Find blocks, offices, labs, and event spots across FAST.",
};

/**
 * Campus Map (v2) — a utility screen, not a landing page. The map is the whole
 * point, so it takes the full column height between a compact header and the
 * bottom dock.
 *
 * A Server Component so it can read the `?place=` deep link (from a Sports
 * card's "Show on map") and fetch open Sports plans up front — everything
 * else (search, filters, pins, zoom/pan) still lives client-side in the
 * CampusMapExperience island.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ place?: string }>;
}) {
  const { place } = await searchParams;
  const sportsPlans = await getActiveSportsPlans();

  // Group open Sports plans by the campus pin they were tagged to, so the map
  // can show "N active games" on a place without a separate DB relationship.
  const sportsByPlace = new Map<string, SmartMatchPost[]>();
  for (const post of sportsPlans) {
    const pin = resolvePlace(post.place);
    if (!pin) continue;
    sportsByPlace.set(pin.id, [...(sportsByPlace.get(pin.id) ?? []), post]);
  }

  return (
    /* The vertical rhythm here is deliberate and the reason for the odd-looking
       height: title/subtitle, a gap, the search field, a LARGER gap, then the
       map, then room to breathe before the dock. The title block and the search
       field used to sit almost on top of each other and the map started
       immediately under the field, so three unrelated things read as one dense
       cluster. The map still takes every pixel that is left over — it is what
       the screen is for — it just is not crowded up against its controls. */
    <main className="page-x mx-auto flex h-[calc(100dvh-var(--safe-top)-var(--shell-pb)-2.5rem)] w-full max-w-md flex-col pt-7 pb-5">
      <header className="mb-6 shrink-0">
        <h1 className="type-display">Campus Map</h1>
        <p className="type-callout mt-1.5 text-fg-muted">
          Find blocks, offices, labs, and event spots.
        </p>
      </header>

      <CampusMapExperience
        initialPlace={place ?? null}
        sportsByPlace={Object.fromEntries(sportsByPlace)}
      />
    </main>
  );
}
