import { Skeleton } from "@/components/ui/skeleton";

export default function DiscoverLoading() {
  return (
    <div className="relative flex flex-1 flex-col px-5 py-6">
      <div className="mx-auto aspect-[3/4.4] w-full max-w-sm">
        <Skeleton className="h-full w-full rounded-[36px]" />
      </div>
      <div className="mt-5 flex items-center justify-center gap-6">
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-14 w-14 rounded-full" />
      </div>
    </div>
  );
}
