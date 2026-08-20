import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * Route-level shimmer for a space page (society, chat room, event). It mirrors
 * the real chrome — cover, name, tab bar — so the header does not jump when the
 * server content lands; only the area under the bar changes.
 */
export function SpaceLoadingSkeleton({ tabs = 4 }: { tabs?: number }) {
  return (
    <main className="mx-auto w-full max-w-md">
      <div className="px-4 pt-2">
        <Skeleton className="aspect-[16/9] w-full rounded-[20px]" />
      </div>
      <div className="px-4 pt-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-32" />
      </div>
      <div className="flex gap-2 border-b border-hairline px-4 pb-3 pt-4">
        {Array.from({ length: tabs }, (_, i) => (
          <Skeleton key={i} className="h-5 flex-1" />
        ))}
      </div>
      <div className="space-y-3 px-4 pt-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </main>
  );
}
