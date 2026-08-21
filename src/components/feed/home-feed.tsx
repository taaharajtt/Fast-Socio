"use client";

import { Suspense, use, useState } from "react";
import { Newspaper } from "lucide-react";
import { PostComposer } from "@/components/feed/post-composer";
import { FeedList } from "@/components/feed/feed-list";
import { SectionHeader } from "@/components/ui";
import { SkeletonCards } from "@/components/ui/skeleton";
import type { FeedPost } from "@/lib/feed/types";

type FeedData = { posts: FeedPost[]; currentUserId: string | null };

/**
 * Client shell tying the composer to the feed so a new post appears by fetching
 * ONE feed page and prepending it — instead of router.refresh(), which re-ran
 * the whole layout + page on the server (seconds) to show one new row.
 * `belowComposer` is a server-rendered slot (the Campus Help strip) placed
 * directly under the composer so the composer reads first on the page.
 *
 * `feed` arrives as a PROMISE rather than resolved rows. The composer, the
 * section heading and the Campus Help slot are all renderable before any query
 * comes back, so they paint with the rest of the shell; only the rows below
 * wait, behind their own boundary. Awaiting the feed on the server instead
 * would have held every one of them hostage to the slowest query on the page.
 */
/** Unwraps the placeholder promise in isolation, so suspending on it can only
 *  ever hold back the composer itself (fix-038). */
function PersonalisedComposer({
  placeholder,
  onPosted,
}: {
  placeholder?: Promise<string>;
  onPosted: () => void;
}) {
  const resolved = placeholder ? use(placeholder) : undefined;
  return <PostComposer placeholder={resolved} onPosted={onPosted} />;
}

export function HomeFeed({
  feed,
  belowComposer,
  composerPlaceholder,
}: {
  feed: Promise<FeedData>;
  belowComposer?: React.ReactNode;
  /** fix-038: "Yo, {name}! What's on your mind?". A PROMISE, for the same reason
   *  `feed` is one — resolving it on the server would hold back the whole shell. */
  composerPlaceholder?: Promise<string>;
}) {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <>
      <div className="px-4">
        {/* data-tour anchors the first-run tour's spotlight on the composer. */}
        <div data-tour="composer">
          {/* Only the composer waits on the personalised placeholder — never the
              shell. The fallback is the same composer with its built-in default,
              so the card's geometry is identical and nothing shifts. */}
          <Suspense
            fallback={
              <PostComposer onPosted={() => setRefreshToken((t) => t + 1)} />
            }
          >
            <PersonalisedComposer
              placeholder={composerPlaceholder}
              onPosted={() => setRefreshToken((t) => t + 1)}
            />
          </Suspense>
        </div>
        {belowComposer}
      </div>
      {/* Section label for the campus feed, mirroring the Campus Help header
          above it — gives the feed its own identity instead of running straight
          on from the Campus Help card. */}
      <div className="mb-2 mt-6 px-4">
        <SectionHeader title="Feed" icon={Newspaper} className="mb-0" />
      </div>
      <div>
        <Suspense fallback={<SkeletonCards count={3} className="px-4" />}>
          <StreamedFeedList feed={feed} refreshToken={refreshToken} />
        </Suspense>
      </div>
    </>
  );
}

function StreamedFeedList({
  feed,
  refreshToken,
}: {
  feed: Promise<FeedData>;
  refreshToken: number;
}) {
  const { posts, currentUserId } = use(feed);
  return (
    <FeedList
      initial={posts}
      currentUserId={currentUserId}
      refreshToken={refreshToken}
    />
  );
}
