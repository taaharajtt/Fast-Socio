import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function CommunitiesLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
      <div className="mt-5 space-y-2">
        <Skeleton className="h-5 w-24" />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </main>
  );
}
