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

/**
 * A post-shaped shimmer.
 *
 * Posts and list rows are no longer bordered cards floating in a gap — they are
 * full-width rows separated by hairlines. The skeleton has to be the same
 * shape, or the content visibly jumps and re-flows the instant it arrives,
 * which is the loading equivalent of a layout shift (apple.md §16 — craft; a
 * placeholder that lies about the shape is worse than none).
 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("border-b border-hairline py-4", className)}>
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-1.5 h-3 w-24" />
        </div>
      </div>
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
    </div>
  );
}

/** A compact list-row skeleton (avatar + two lines). */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3.5">
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
    <div className="mt-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/**
 * `count` stacked feed posts — the shimmer for a tab that renders posts.
 * `className` is forwarded to each row so an edge-to-edge feed can supply its
 * own gutter, the same way the real post list does.
 */
export function SkeletonCards({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className="mt-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} className={className} />
      ))}
    </div>
  );
}

/**
 * Shimmer for a stable-shell subtab panel while its content streams in (society,
 * chat room, and event detail pages) — 3 rows so the panel never collapses and
 * the frozen header above it never jumps.
 */
export function TabSkeletonLoader() {
  return <SkeletonRows count={3} />;
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
