import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function SocietyLoading() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <Skeleton className="h-[200px] w-full rounded-none" />
      <div className="px-4 py-4">
        <div className="flex gap-4 border-b border-white/[0.08] pb-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-14" />
          ))}
        </div>
        <SkeletonRows count={4} />
      </div>
    </main>
  );
}
