import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SkeletonRows } from "@/components/ui/skeleton";
import { CommunityUpdatesList } from "@/components/communities/community-updates-list";
import { loadCommunityUpdates } from "@/lib/community/updates-data";

/**
 * Community → Updates: the list behind the dock badge.
 *
 * This is the screen the old badge never had. Its number was derived from
 * timestamps and pointed at nothing in particular, so a student could not see
 * what it meant or work it down. Every row here is one unread thing, the badge
 * is `count(*)` of the unread ones, and reading them takes it to zero.
 *
 * PERF/CORRECTNESS — the default export is deliberately NOT async. Under Cache
 * Components, reading request data at the top level makes the route dynamic
 * while Next is still building its fallback shell, and resuming that shell then
 * throws E592 (see the same note on /post/[id] and /profile/[id]). The header
 * is identical for everyone and prerenders; the per-viewer read lives in the
 * async body behind Suspense.
 *
 * NOTHING IS MARKED READ BY OPENING THIS PAGE. Reading is a deliberate act —
 * open a row, or press Mark all as read.
 */
export default function CommunityUpdatesPage() {
  return (
    // The shell already pays the top safe-area inset and reserves dock
    // clearance (--shell-pb), so this page adds neither — it only needs enough
    // bottom padding that the last row clears the dock's shadow comfortably.
    <main className="mx-auto w-full max-w-md px-4 pb-10 pt-2">
      {/* Bare chevron and a large title on one line. The back control lost its
          glass disc: on a plain dark list there is no photo behind it to stay
          legible against, so the disc was chrome for its own sake and competed
          with the title for the corner. */}
      <header className="mb-2 flex items-center gap-2">
        <Link
          href="/communities"
          aria-label="Back to Community"
          className="pressable focus-ring -ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-fg"
        >
          <ChevronLeft className="h-7 w-7" strokeWidth={2.25} aria-hidden />
        </Link>
        <h1 className="type-display text-[30px] font-extrabold tracking-tight">
          Updates
        </h1>
      </header>

      <Suspense fallback={<SkeletonRows count={6} />}>
        <UpdatesBody />
      </Suspense>
    </main>
  );
}

async function UpdatesBody() {
  const { items, cursor, hasMore } = await loadCommunityUpdates();
  return (
    <CommunityUpdatesList
      initialItems={items}
      initialCursor={cursor}
      initialHasMore={hasMore}
    />
  );
}
