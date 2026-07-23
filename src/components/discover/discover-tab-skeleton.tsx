import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import type { DiscoverMode } from "@/lib/smart-match/modes";

/** Shimmer placeholder shown while a Discover mode switch is in flight. */
export function DiscoverTabSkeleton({ mode }: { mode: DiscoverMode }) {
  if (mode === "socio") {
    // Approximates the swipe deck: one tall profile card.
    return (
      <div className="relative mx-auto h-[70vh] max-h-[560px] w-full overflow-hidden rounded-[28px]">
        <Skeleton className="h-full w-full rounded-[28px]" />
        <div className="absolute inset-x-0 bottom-0 space-y-2 p-5">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3.5 w-1/3" />
        </div>
      </div>
    );
  }
  // Post modes: tagline + create button + a few scored cards.
  return (
    <div className="space-y-5">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-11 w-full rounded-full" />
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
