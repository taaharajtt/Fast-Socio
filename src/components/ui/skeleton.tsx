import { cn } from "@/lib/utils";

/**
 * Skeleton placeholder block. Used by route-level loading.tsx files so a
 * page-shaped shimmer appears instantly (via Suspense) while the server
 * component streams — perceived-performance only, no data or behavior.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn("animate-pulse rounded-[var(--radius-sm)] bg-white/[0.06]", className)}
    />
  );
}

/** A glass card wrapper of skeleton lines — matches the feed/list card shape. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("glass rounded-[var(--radius-md)] p-4", className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
    </div>
  );
}

/** A compact list-row skeleton (avatar + two lines). */
export function SkeletonRow() {
  return (
    <div className="glass flex items-center gap-3 rounded-[var(--radius-md)] p-4">
      <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-2 h-3 w-40" />
      </div>
    </div>
  );
}

/** `count` stacked list rows — the shimmer for a tab that renders a list. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="mt-4 space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/** `count` stacked feed cards — the shimmer for a tab that renders posts. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-4 space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/**
 * Alternating left/right message bubbles — the shimmer for a chat panel, whose
 * shape a generic list skeleton would misrepresent.
 */
export function SkeletonChat({ count = 6 }: { count?: number }) {
  return (
    <div className="mt-4 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={i % 2 ? "flex justify-end" : "flex justify-start"}>
          <Skeleton
            className="h-10 rounded-2xl"
            // Vary the width so it reads as conversation, not a loading bar.
            style={{ width: `${45 + ((i * 17) % 35)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
