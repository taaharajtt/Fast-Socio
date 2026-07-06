import { Skeleton } from "@/components/ui/skeleton";

/** Profile (other user): cover, avatar, name + CTA, stats, posts grid. */
export default function ProfileLoading() {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="relative h-44">
        <Skeleton className="h-full w-full rounded-none" />
        <div className="absolute -bottom-10 left-5">
          <Skeleton className="h-20 w-20 rounded-full border-[3px] border-bg" />
        </div>
      </div>

      <main className="px-5 pb-28">
        <div className="mt-12 mb-4 flex items-end justify-between">
          <div>
            <Skeleton className="h-6 w-36" />
            <Skeleton className="mt-2 h-4 w-28" />
          </div>
          <Skeleton className="h-9 w-24 rounded-[var(--radius-pill)]" />
        </div>

        <div className="mb-5 flex gap-3">
          <Skeleton className="h-16 flex-1 rounded-[var(--radius-md)]" />
          <Skeleton className="h-16 flex-1 rounded-[var(--radius-md)]" />
        </div>

        <Skeleton className="mb-5 h-4 w-3/4" />

        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="aspect-square rounded-[var(--radius-md)]" />
          ))}
        </div>
      </main>
    </div>
  );
}
