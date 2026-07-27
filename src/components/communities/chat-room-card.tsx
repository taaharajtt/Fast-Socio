"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { communityIcon } from "@/lib/communities/icon";
import { FollowJoinButtons } from "@/components/communities/follow-join-buttons";
import type { JoinState } from "@/app/(student)/communities/actions";

export type ChatRoomCardVM = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  member_count: number;
  /** Your matches who are already in this room. */
  mutuals: number;
  isFollowing: boolean;
  joinStatus: JoinState;
  isOwner: boolean;
};

/**
 * The one rectangular card on the Community hub. Community chats earn the extra
 * width because they carry the Follow/Join pair — the discovery rails above
 * are pure navigation and stay square.
 *
 * This is a directory entry, not a conversation: it opens the room's profile,
 * and the profile's Overview is where "Open chat" hands off to the Chat area.
 */
export function ChatRoomCard({ c }: { c: ChatRoomCardVM }) {
  const image = c.avatar_url ?? c.cover_url;
  return (
    <div className="rounded-[16px] bg-card p-3.5">
      <div className="flex items-start gap-3">
        <Link
          href={`/communities/${c.id}`}
          className="glass relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[14px]"
        >
          {image ? (
            <AppImage src={image} alt="" sizes="48px" />
          ) : (
            <span className="text-xl" aria-hidden>
              {communityIcon(c.name)}
            </span>
          )}
        </Link>

        <Link href={`/communities/${c.id}`} className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-fg">{c.name}</p>
          {c.description ? (
            <p className="truncate text-[13px] text-fg-muted">{c.description}</p>
          ) : (
            <p className="truncate text-[13px] text-fg-disabled">No description yet</p>
          )}
          <p className="mt-1 flex items-center gap-1 text-[12px] text-fg-muted">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {c.member_count.toLocaleString()} member
            {c.member_count === 1 ? "" : "s"}
            {c.mutuals > 0 && (
              <span className="text-accent">
                · {c.mutuals} match{c.mutuals === 1 ? "" : "es"} here
              </span>
            )}
          </p>
        </Link>
      </div>

      <div className="mt-3 flex justify-end">
        <FollowJoinButtons
          communityId={c.id}
          isFollowing={c.isFollowing}
          joinStatus={c.joinStatus}
          isOwner={c.isOwner}
          tone="onCard"
          size="sm"
        />
      </div>
    </div>
  );
}
