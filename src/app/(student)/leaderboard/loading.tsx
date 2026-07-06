import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function LeaderboardLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-6 space-y-2">
        <Skeleton className="h-5 w-44" />
        <SkeletonRow />
        <SkeletonRow />
      </div>
      <div className="mt-7 space-y-2">
        <Skeleton className="h-5 w-44" />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </main>
  );
}
