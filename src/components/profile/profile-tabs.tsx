"use client";

import { useState } from "react";
import Link from "next/link";
import { SegmentedPills } from "@/components/ui";

export type GridPost = {
  id: string;
  body: string | null;
  image_url: string | null;
};

export type ProfileCommunity = {
  id: string;
  name: string;
  member_count: number;
};

/**
 * Posts | Communities switcher on the profile screen (Figma). Posts render as a
 * 3-column grid — image posts show their image, text posts show a gradient tile
 * with the opening line. Both link through to their detail routes.
 */
export function ProfileTabs({
  posts,
  communities,
}: {
  posts: GridPost[];
  communities: ProfileCommunity[];
}) {
  const [tab, setTab] = useState("posts");

  return (
    <div>
      <SegmentedPills
        options={[
          { value: "posts", label: "Posts" },
          { value: "communities", label: "Communities" },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === "posts" ? (
        posts.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">
            No posts yet.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {posts.map((p) => (
              <Link
                key={p.id}
                href={`/post/${p.id}`}
                className="aspect-square overflow-hidden rounded-[var(--radius-md)]"
              >
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image_url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="gradient-brand flex h-full w-full items-center p-2 text-[11px] leading-snug text-white/90">
                    <span className="line-clamp-4">{p.body ?? ""}</span>
                  </span>
                )}
              </Link>
            ))}
          </div>
        )
      ) : communities.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">
          Not in any communities yet.
        </p>
      ) : (
        <div className="space-y-2">
          {communities.map((c) => (
            <Link
              key={c.id}
              href={`/communities/${c.id}`}
              className="glass flex items-center gap-3 rounded-[var(--radius-md)] p-3"
            >
              <span className="gradient-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg">
                👥
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                <p className="text-xs text-fg-muted">
                  {c.member_count} member{c.member_count === 1 ? "" : "s"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
