import { Skeleton } from "@/components/ui/skeleton";

export default function MapLoading() {
  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-md flex-col px-4 pt-5 pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <div className="shrink-0">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      <Skeleton className="mt-3 h-11 w-full shrink-0 rounded-xl" />
      <Skeleton className="mt-3 min-h-0 flex-1 rounded-2xl" />
    </main>
  );
}
