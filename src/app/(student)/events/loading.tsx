import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function EventsLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>
      <div className="mt-5 space-y-3">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </main>
  );
}
