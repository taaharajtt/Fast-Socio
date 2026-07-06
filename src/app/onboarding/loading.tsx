import { Skeleton } from "@/components/ui/skeleton";

/** Profile setup: progress bar, single-focus step, pinned CTA. */
export default function OnboardingLoading() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col px-6 py-8">
      <Skeleton className="mb-8 h-1 w-full rounded-full" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-64" />
      <div className="mt-8 space-y-4">
        <Skeleton className="h-11 w-full rounded-[var(--radius-sm)]" />
        <Skeleton className="h-11 w-full rounded-[var(--radius-sm)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-sm)]" />
      </div>
      <Skeleton className="mt-auto h-12 w-full rounded-[var(--radius-pill)]" />
    </main>
  );
}
