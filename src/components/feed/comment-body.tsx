"use client";

import Link from "next/link";
import { parseMentions } from "@/lib/mentions";

/**
 * Renders a comment/reply body, turning stored @-mention tokens into links to
 * the mentioned user's profile. The link text is their roll-number username
 * (e.g. "@i240733"); plain text runs are emitted verbatim so the parent's
 * whitespace-pre-wrap still governs wrapping and newlines.
 */
export function CommentBody({ body }: { body: string }) {
  const parts = parseMentions(body);
  return (
    <>
      {parts.map((p, i) =>
        p.type === "mention" ? (
          <Link
            key={i}
            href={`/profile/${p.id}`}
            className="font-semibold text-accent hover:underline"
          >
            @{p.username}
          </Link>
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </>
  );
}
