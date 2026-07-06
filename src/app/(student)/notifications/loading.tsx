import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="space-y-2">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </main>
  );
}
