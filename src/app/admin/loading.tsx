import { Skeleton } from "@/components/ui/skeleton";

/**
 * Admin area loading state. One skeleton at the /admin segment root covers the
 * whole nested admin subtree (dashboard, reports, users, audit, …) via Suspense.
 * Data-dense/utilitarian per UI Spec §5.18, but still on-brand tokens.
 */
export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-3xl">
      <Skeleton className="h-7 w-48" />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />
        ))}
      </div>
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-[var(--radius-sm)]" />
        ))}
      </div>
    </div>
  );
}
