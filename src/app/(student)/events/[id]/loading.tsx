import { Skeleton } from "@/components/ui/skeleton";

/** Event detail: banner, title, 2×2 metadata grid, attendee stack, CTA. */
export default function EventDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-md">
      <Skeleton className="h-56 w-full rounded-none" />
      <main className="-mt-6 px-5 pb-36">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex-1">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="mt-2 h-4 w-28" />
          </div>
          <Skeleton className="ml-3 h-16 w-16 rounded-[var(--radius-md)]" />
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />
          ))}
        </div>

        <Skeleton className="mb-2 h-4 w-24" />
        <div className="mb-5 flex -space-x-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-8 rounded-full" />
          ))}
        </div>

        <Skeleton className="h-24 w-full rounded-[var(--radius-md)]" />
      </main>
    </div>
  );
}
