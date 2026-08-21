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
 * where the conversation itself is the Chat tab (members only).
 *
 * The card is the cover photo edge to edge, with a bottom scrim carrying the
 * name/member-count on the left and the Follow/Join pair on the right — the
 * whole card is one navigation target, but the buttons sit above it in
 * stacking order so a tap on them never falls through to the link.
 */
export function ChatRoomCard({ c }: { c: ChatRoomCardVM }) {
  const cover = c.cover_url ?? c.avatar_url;
  return (
    <div className="relative h-[168px] w-full overflow-hidden rounded-[16px]">
      {cover ? (
        <AppImage src={cover} alt="" sizes="(max-width: 448px) 100vw, 448px" />
      ) : (
        <div className="gradient-brand absolute inset-0 flex items-center justify-center">
          <span className="text-4xl" aria-hidden>
            {communityIcon(c.name)}
          </span>
        </div>
      )}

      {/* Bottom scrim keeps the name/buttons legible over any photo. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />

      {/* The link is an absolutely-positioned overlay beneath the buttons in
          DOM/stacking order, so it covers the whole card without ever
          swallowing a tap meant for Follow/Join. */}
      <Link
        href={`/communities/${c.id}`}
        aria-label={c.name}
        className="absolute inset-0 z-0"
      />

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-white">{c.name}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-white/80">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {c.member_count.toLocaleString()} member
            {c.member_count === 1 ? "" : "s"}
            {c.mutuals > 0 && (
              <span className="text-white">
                · {c.mutuals} match{c.mutuals === 1 ? "" : "es"} here
              </span>
            )}
          </p>
        </div>

        <div className="pointer-events-auto shrink-0">
          <FollowJoinButtons
            communityId={c.id}
            isFollowing={c.isFollowing}
            joinStatus={c.joinStatus}
            isOwner={c.isOwner}
            tone="onCover"
            size="sm"
          />
        </div>
      </div>
    </div>
  );
}
