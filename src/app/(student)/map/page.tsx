import type { Metadata } from "next";
import { CampusMapExperience } from "@/components/map/campus-map-experience";

export const metadata: Metadata = {
  title: "Campus Map",
  description: "Find blocks, offices, labs, and event spots across FAST.",
};

/**
 * Campus Map (v2) — a utility screen, not a landing page. The map is the whole
 * point, so it takes the full column height between a compact header and the
 * bottom dock.
 *
 * The page is a Server Component with no data fetching; all interactivity
 * (search, filters, pins, zoom/pan) lives in the CampusMapExperience client
 * island, so nothing beyond it ships client JS.
 */
export default function MapPage() {
  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-md flex-col px-4 pt-5 pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <header className="shrink-0">
        <h1 className="text-[22px] font-bold tracking-tight">Campus Map</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Find blocks, offices, labs, and event spots.
        </p>
      </header>

      <CampusMapExperience />
    </main>
  );
}
