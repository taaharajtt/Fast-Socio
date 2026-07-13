"use client";

import { useState } from "react";
import { PostComposer } from "@/components/feed/post-composer";
import { FeedList } from "@/components/feed/feed-list";
import type { FeedPost } from "@/lib/feed/types";

/**
 * Client shell tying the composer to the feed so a new post appears by fetching
 * ONE feed page and prepending it — instead of router.refresh(), which re-ran
 * the whole layout + page on the server (seconds) to show one new row.
 * Renders exactly the same DOM the page rendered before; `eventsStrip` is the
 * server-rendered strip passed through as a child.
 */
export function HomeFeed({
  initialPosts,
  currentUserId,
  eventsStrip,
}: {
  initialPosts: FeedPost[];
  currentUserId?: string | null;
  eventsStrip?: React.ReactNode;
}) {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <>
      <div className="px-4">
        {/* data-tour anchors the first-run tour's spotlight on the composer. */}
        <div data-tour="composer">
          <PostComposer onPosted={() => setRefreshToken((t) => t + 1)} />
        </div>
        {eventsStrip}
      </div>
      <div className="mt-2">
        <FeedList
          initial={initialPosts}
          currentUserId={currentUserId}
          refreshToken={refreshToken}
        />
      </div>
    </>
  );
}
