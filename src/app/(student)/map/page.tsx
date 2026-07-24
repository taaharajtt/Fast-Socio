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
    <main className="mx-auto flex h-[100dvh] w-full max-w-md flex-col px-4 pt-5 pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <header className="shrink-0">
        <h1 className="text-[22px] font-bold tracking-tight">Campus Map</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
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
