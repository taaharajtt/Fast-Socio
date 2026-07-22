import { Skeleton } from "@/components/ui/skeleton";

export default function HelpDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="glass space-y-3 rounded-[14px] p-5">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <div className="flex items-center gap-2 pt-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        <Skeleton className="h-20 w-full rounded-[14px]" />
        <Skeleton className="h-20 w-full rounded-[14px]" />
      </div>
    </main>
  );
}
