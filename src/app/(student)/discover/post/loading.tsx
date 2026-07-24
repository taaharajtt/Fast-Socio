import { Skeleton } from "@/components/ui/skeleton";

export default function DiscoverPostLoading() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-3">
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-56 max-w-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-[14px]" />
        ))}
      </div>
    </div>
  );
}
