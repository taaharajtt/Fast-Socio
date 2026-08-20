import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    // Geometry mirrors the real Home shell exactly — px-4 (not px-5), a 64px
    // masthead, and two 40px round controls — so nothing shifts sideways or
    // downward when the real header replaces this one.
    <main className="mx-auto w-full max-w-md pb-4">
      <div className="flex h-16 items-center justify-between px-4">
        <Skeleton className="h-11 w-28" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
      </div>
      <div className="px-4">
        <Skeleton className="h-[168px] w-full rounded-[var(--radius-card)]" />
      </div>
      <div className="mt-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </main>
  );
}
