import { Skeleton } from "@/components/ui/skeleton";

/**
 * Event attendees: back header + a roster.
 *
 * Nearest boundary was `events/[id]/loading.tsx`, the event DETAIL skeleton
 * (cover, title, host, description). This page is a list, so the parent
 * promised a hero image this route does not have.
 */
export default function AttendeesLoading() {
  return (
    <main className="mx-auto flex h-full w-full max-w-md flex-col px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
