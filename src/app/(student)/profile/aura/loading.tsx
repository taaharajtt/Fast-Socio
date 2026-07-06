import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

/** Aura history: header, total card, transaction rows. */
export default function AuraLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-4">
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="mb-5 h-28 w-full rounded-[var(--radius-card)]" />
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </main>
  );
}
