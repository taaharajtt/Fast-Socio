import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="flex items-start justify-between">
        <Skeleton className="h-9 w-28" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
      </div>
      <div className="glass mt-6 rounded-[var(--radius-card)] p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-2 h-4 w-32" />
            <Skeleton className="mt-3 h-6 w-24 rounded-full" />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
    </main>
  );
}
