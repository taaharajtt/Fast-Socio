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
    <main className="mx-auto w-full max-w-md px-4 py-4">
      <header className="mb-4 flex items-center gap-3">
        <Link
          href="/communities"
          aria-label="Back to Community"
          className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight">Updates</h1>
          <p className="text-xs text-fg-muted">
            Requests, decisions and announcements from your spaces
          </p>
        </div>
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
