import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Community detail: banner, tab pills, post cards. */
export default function CommunityDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-md">
      <Skeleton className="h-44 w-full rounded-none" />
      <div className="flex gap-2 px-5 py-3">
        <Skeleton className="h-9 w-24 rounded-[var(--radius-pill)]" />
        <Skeleton className="h-9 w-20 rounded-[var(--radius-pill)]" />
      </div>
      <main className="space-y-3 px-5 pb-28">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </main>
    </div>
  );
}
