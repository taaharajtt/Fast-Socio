import { Skeleton } from "@/components/ui/skeleton";

/** Header + the one swipe card, which is all Discover ever shows. */
export default function DiscoverLoading() {
  return (
    <div className="mx-auto flex h-[var(--shell-content-h)] w-full min-h-0 max-w-md flex-col px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-20 rounded-full" />
      </div>
      <div className="mx-auto aspect-[3/4.4] max-h-[calc(var(--shell-content-h)-var(--deck-chrome))] w-full min-h-0 max-w-sm">
        <Skeleton className="h-full w-full rounded-3xl" />
      </div>
      <div className="mt-5 flex items-center justify-center gap-6">
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-16 w-16 rounded-full" />
      </div>
    </div>
  );
}
