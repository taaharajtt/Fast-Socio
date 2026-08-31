import { Skeleton } from "@/components/ui/skeleton";

/**
 * Appeals: back header + restriction banner + strike rows + the appeal form.
 *
 * This was the ONLY student route with no `loading.tsx` anywhere above it, so
 * it was the only one falling through to the layout's generic <RouteFallback/>
 * — a title bar and three cards, which is not the shape of this page. Every
 * other route that lacked its own file inherits a parent's: `settings/` covers
 * all four settings sub-pages, `profile/` covers badges and matches, `help/`
 * covers `help/new`, and so on, because a `loading.tsx` boundary applies to its
 * whole subtree and not just its own segment.
 *
 * Worth being precise about, because the perf audit originally claimed ten
 * routes were falling through here. Only this one was.
 */
export default function AppealsLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-4">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-24" />
      </div>

      {/* Restriction banner — the first thing this page answers. */}
      <div className="glass rounded-[var(--radius-md)] p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        </div>
      </div>

      {/* Strike history. */}
      <Skeleton className="mt-6 h-4 w-20" />
      <div className="mt-3 space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="glass rounded-[var(--radius-sm)] p-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-2 h-4 w-3/4" />
          </div>
        ))}
      </div>

      {/* Appeal form. */}
      <Skeleton className="mt-6 h-4 w-28" />
      <Skeleton className="mt-3 h-24 w-full rounded-[var(--radius-sm)]" />
      <Skeleton className="mt-3 h-11 w-full rounded-full" />
    </main>
  );
}
