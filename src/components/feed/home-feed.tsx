"use client";

import { useState } from "react";
import { Newspaper } from "lucide-react";
import { PostComposer } from "@/components/feed/post-composer";
import { FeedList } from "@/components/feed/feed-list";
import type { FeedPost } from "@/lib/feed/types";

/**
 * Client shell tying the composer to the feed so a new post appears by fetching
 * ONE feed page and prepending it — instead of router.refresh(), which re-ran
 * the whole layout + page on the server (seconds) to show one new row.
 * `belowComposer` is a server-rendered slot (the Campus Help strip) placed
 * directly under the composer so the composer reads first on the page.
 */
export function HomeFeed({
  initialPosts,
  currentUserId,
  belowComposer,
}: {
  initialPosts: FeedPost[];
  currentUserId?: string | null;
  belowComposer?: React.ReactNode;
}) {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <>
      <div className="px-4">
        {/* data-tour anchors the first-run tour's spotlight on the composer. */}
        <div data-tour="composer">
          <PostComposer onPosted={() => setRefreshToken((t) => t + 1)} />
        </div>
        {belowComposer}
      </div>
      {/* Section label for the campus feed, mirroring the Campus Help header
          above it — gives the feed its own identity instead of running straight
          on from the Campus Help card. */}
      <div className="mb-2 mt-4 px-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-accent">
          <Newspaper className="h-4 w-4" aria-hidden />
          Feed
        </h2>
      </div>
      <div>
        <FeedList
          initial={initialPosts}
          currentUserId={currentUserId}
          refreshToken={refreshToken}
        />
      </div>
    </>
  );
}
