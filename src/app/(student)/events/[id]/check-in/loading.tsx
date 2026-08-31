import { Skeleton } from "@/components/ui/skeleton";

/**
 * Event check-in: back header + the scan/code panel.
 *
 * Nearest boundary was the event DETAIL skeleton, which draws a cover image
 * and description block this route never renders.
 */
export default function CheckInLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="mb-5 rounded-[var(--radius-card)] bg-card p-5">
        <Skeleton className="mx-auto h-44 w-44 rounded-[var(--radius-sm)]" />
        <Skeleton className="mx-auto mt-4 h-4 w-40" />
      </div>
      <Skeleton className="h-11 w-full rounded-full" />
    </main>
  );
}
