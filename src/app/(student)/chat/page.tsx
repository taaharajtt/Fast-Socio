import { Suspense } from "react";
import { ChatCommunityTabs } from "@/components/chat/chat-community-tabs";
import { InboxList } from "@/components/chat/inbox-list";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ScreenHeader } from "@/components/ui";
import { loadInbox } from "@/app/(student)/chat/inbox-data";
import { timed } from "@/lib/perf";

// No `unstable_instant` export here — it only adds build-time validation, and
// that validation currently trips on @sentry/nextjs reading the `sentry-trace`
// header during every server render. See the note in next.config.ts; the static
// shell itself is unaffected (this route builds as Partial Prerender).

/**
 * Messages. Two panels of one screen (UAT-006): the tab bar swaps Messages and
 * Requests without a full-page header change.
 *
 * The title prerenders, so the tab lands on a real screen immediately. The tab
 * bar and the rows below it both depend on request-scoped data (which panel the
 * URL selects, and the inbox itself) so they stream in together — the inbox is
 * a fan-out of a dozen queries and is by far the slowest thing here.
 *
 * `InboxRealtime` is gone: the list component now owns its own data and
 * re-reads only the inbox when realtime fires, instead of asking the router to
 * refresh the entire tree.
 */
export default function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <ScreenHeader title="Messages" className="mb-5" />
      <Suspense fallback={<InboxSkeleton />}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Inbox({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ view }, data] = await Promise.all([
    searchParams,
    timed("chat:inbox", loadInbox),
  ]);
  const showRequests = view === "requests";

  return (
    <ChatCommunityTabs
      active={showRequests ? "requests" : "messages"}
      requestCount={data.incoming.length}
    >
      <InboxList initial={data} showRequests={showRequests} />
    </ChatCommunityTabs>
  );
}

/** Tab bar + rows, at the geometry ChatCommunityTabs renders. */
function InboxSkeleton() {
  return (
    <div className="mt-4">
      <div className="h-11 w-full" />
      <SkeletonRows count={5} />
    </div>
  );
}
