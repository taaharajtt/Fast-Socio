"use client";

import Link from "next/link";
import { parseMentions } from "@/lib/mentions";
import { renderLinkifiedText } from "@/lib/linkify";

/**
 * A post body: @-mention tokens become profile links, and every plain run in
 * between still goes through the existing linkifier, so a post can carry both
 * a tagged match and a URL. Comments render through CommentBody, which does the
 * same for mentions but has never linkified — keeping these separate preserves
 * each surface's current behaviour instead of quietly changing comments too.
 */
export function PostBody({ body }: { body: string }) {
  const parts = parseMentions(body);
  return (
    <>
      {parts.map((p, i) =>
        p.type === "mention" ? (
          <Link
            key={i}
            href={`/profile/${p.id}`}
            // The card itself is tappable; a tag must not open the post too.
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-accent hover:underline"
          >
            @{p.username}
          </Link>
        ) : (
          <span key={i}>{renderLinkifiedText(p.value)}</span>
        )
      )}
    </>
  );
}
