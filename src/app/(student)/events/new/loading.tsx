import { Skeleton } from "@/components/ui/skeleton";

/** Create event: header + stacked form fields + submit. */
export default function NewEventLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-4">
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="space-y-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i}>
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="h-11 w-full rounded-[var(--radius-sm)]" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-6 h-12 w-full rounded-[var(--radius-pill)]" />
    </main>
  );
}
