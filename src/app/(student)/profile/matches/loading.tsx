import { Skeleton } from "@/components/ui/skeleton";

/**
 * Matches: back header + a list of matched people.
 *
 * Nearest boundary was `profile/loading.tsx` (cover banner + avatar), which is
 * the wrong shape for this `max-w-md pb-24` header-and-rows page.
 */
export default function MatchesLoading() {
  return (
    <div className="mx-auto w-full max-w-md pb-24">
      <header className="flex items-center gap-2 px-4 py-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-28" />
      </header>
      <div className="space-y-3 px-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
