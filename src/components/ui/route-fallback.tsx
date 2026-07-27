import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";

/**
 * Default shell for a route segment that has no `loading.tsx` of its own.
 *
 * Layouts wrap their `{children}` slot in a Suspense boundary using this as the
 * fallback. Routes that DO ship a `loading.tsx` are unaffected — that file is a
 * boundary nested below this one, so React shows the route's own, more accurate
 * skeleton instead. This exists purely so no route can fall back to a blank
 * dead wait while its server work runs.
 */
export function RouteFallback() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      <Skeleton className="h-7 w-40" />
      <SkeletonCards count={3} />
    </div>
  );
}
