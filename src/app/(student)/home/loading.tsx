import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
      <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
      <div className="mt-4 space-y-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </main>
  );
}
