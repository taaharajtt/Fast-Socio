import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function ChatLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <Skeleton className="h-9 w-28" />
      <Skeleton className="mt-5 h-11 w-full rounded-[var(--radius-pill)]" />
      <div className="mt-6 space-y-2">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </main>
  );
}
