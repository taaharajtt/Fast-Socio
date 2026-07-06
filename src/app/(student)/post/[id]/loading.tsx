import { Skeleton } from "@/components/ui/skeleton";

/** Post detail: back header + post card + comment rows. */
export default function PostLoading() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 py-4">
      <div className="mb-3 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-16" />
      </div>

      <div className="glass rounded-[var(--radius-md)] p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        </div>
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-3 h-52 w-full rounded-[var(--radius-sm)]" />
      </div>

      <div className="mt-4 space-y-4">
        <Skeleton className="h-4 w-24" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
