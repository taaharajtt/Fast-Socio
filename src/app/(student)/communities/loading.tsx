import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the hub itself: three tile rails, then chat-room cards. */
function RailSkeleton({ size }: { size: number }) {
  return (
    <div className="mt-7">
      <Skeleton className="h-5 w-40" />
      <div className="mt-3 flex gap-3 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            className="shrink-0 rounded-[18px]"
            style={{ height: size, width: size }}
          />
        ))}
      </div>
    </div>
  );
}

export default function CommunitiesLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>

      <RailSkeleton size={60} />
      <RailSkeleton size={156} />
      <RailSkeleton size={156} />

      <div className="mt-7">
        <Skeleton className="h-5 w-28" />
        <div className="mt-3 space-y-2.5">
          <Skeleton className="h-[124px] w-full rounded-[16px]" />
          <Skeleton className="h-[124px] w-full rounded-[16px]" />
        </div>
      </div>
    </main>
  );
}
