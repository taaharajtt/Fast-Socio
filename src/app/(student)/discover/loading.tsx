import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** First paint of the unified Discover feed: actions, chips, then cards. */
export default function DiscoverLoading() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-3">
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3 w-64 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
