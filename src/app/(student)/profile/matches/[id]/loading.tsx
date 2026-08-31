import { Skeleton } from "@/components/ui/skeleton";

/**
 * A single match: back header + the other person's summary.
 *
 * Its nearest boundary was two levels up at `profile/loading.tsx` — the
 * own-profile cover skeleton, which is neither this page's container nor its
 * header.
 */
export default function MatchDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-md pb-24">
      <header className="flex items-center gap-2 px-4 py-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-40" />
      </header>
      <div className="px-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-2 h-3.5 w-28" />
          </div>
        </div>
        <Skeleton className="mt-5 h-11 w-full rounded-full" />
        <Skeleton className="mt-6 h-4 w-24" />
        <div className="mt-3 flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
