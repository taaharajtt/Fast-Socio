import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function SocietiesLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-10 w-10 rounded-[14px]" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <Skeleton className="h-10 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-5 h-12 w-full rounded-xl" />
      <div className="mt-4 space-y-2.5">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </main>
  );
}
