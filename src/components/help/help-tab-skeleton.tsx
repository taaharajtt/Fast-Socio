import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import type { HelpTab } from "@/lib/help/constants";

/** Shimmer placeholder shown while a Help tab switch is in flight. */
export function HelpTabSkeleton({ tab }: { tab: HelpTab }) {
  if (tab === "me") {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[52px] w-full rounded-full" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="-mt-1 mb-4 flex justify-end">
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
