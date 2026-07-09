import { Skeleton } from "@/components/ui/skeleton";

/**
 * Admin console loading state. One skeleton at the /admin segment root covers the
 * whole nested subtree (overview, reports, users, audit, …) via Suspense. Sharp,
 * neutral blocks — matches the minimalist control-centre skin.
 */
export default function AdminLoading() {
  return (
    <div>
      <Skeleton className="h-6 w-40 rounded-[3px]" />
      <div className="mt-6 overflow-hidden rounded-[4px] border border-glass-border">
        <div className="grid grid-cols-2 gap-px bg-glass-border md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-bg p-3">
              <Skeleton className="h-6 w-12 rounded-[3px]" />
              <Skeleton className="mt-2 h-3 w-16 rounded-[3px]" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-6 space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-[4px]" />
        ))}
      </div>
    </div>
  );
}
