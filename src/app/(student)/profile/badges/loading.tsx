import { Skeleton } from "@/components/ui/skeleton";

/**
 * Badges: back header + a grid of badge cards.
 *
 * Without this the nearest boundary is `profile/loading.tsx`, which draws a
 * 176px cover banner and an overlapping avatar — the OWN-PROFILE shape. This
 * page is a plain `max-w-md px-5 py-6` list with a back header, so the parent
 * skeleton promised a layout this route never renders and then shifted.
 */
export default function BadgesLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="glass rounded-[var(--radius-md)] p-5">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 grid grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-14 w-14 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
