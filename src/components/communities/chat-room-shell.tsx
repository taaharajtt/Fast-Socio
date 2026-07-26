"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { GlassChip } from "@/components/ui";
import { JoinButton } from "@/components/communities/join-button";
import { communityIcon } from "@/lib/communities/icon";
import { cn } from "@/lib/utils";

export type ChatRoomShellTab = {
  key: string;
  label: string;
  badge?: number;
  content: React.ReactNode;
};

const GRADIENT = "linear-gradient(135deg, #4c1d95, #7c3aed)";

/**
 * Stable chrome for a casual chat room: the banner hero (cover, name, member
 * count, Join button) and the Chat/Members subtab bar stay mounted and
 * visually frozen while `activeTab` switches — both tabs' content is
 * server-fetched up front (see /communities/[id]/page.tsx) and handed in as
 * `tabs[].content`, so switching tabs is a pure client state change.
 */
export function ChatRoomShell({
  community,
  isMember,
  isOwner,
  pending,
  tabs,
}: {
  community: {
    id: string;
    name: string;
    avatar_url: string | null;
    cover_url: string | null;
    member_count: number;
  };
  isMember: boolean;
  isOwner: boolean;
  pending: boolean;
  tabs: ChatRoomShellTab[];
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="relative h-[200px] w-full overflow-hidden">
        {community.cover_url || community.avatar_url ? (
          <AppImage
            src={(community.cover_url ?? community.avatar_url)!}
            alt=""
            sizes="(max-width: 448px) 100vw, 448px"
          />
        ) : (
          <div className="h-full w-full" style={{ background: GRADIENT }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

        <Link
          href="/communities"
          aria-label="Back"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        {isOwner && (
          <Link
            href={`/communities/${community.id}/edit`}
            aria-label="Edit community"
            className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Link>
        )}

        <div className="absolute inset-x-4 bottom-3 flex items-end gap-3">
          <span className="text-3xl leading-none" aria-hidden>
            {communityIcon(community.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[17px] font-bold text-white">
                {community.name}
              </h1>
              {pending && <GlassChip tone="warning">pending</GlassChip>}
            </div>
            <p className="text-[13px] text-white/70">
              {community.member_count.toLocaleString()} member
              {community.member_count === 1 ? "" : "s"}
            </p>
          </div>
          {!pending && (
            <JoinButton
              communityId={community.id}
              isMember={isMember}
              isOwner={isOwner}
            />
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-4 py-4">
        {pending ? (
          <p className="mt-2 text-center text-sm text-fg-muted">
            This community is awaiting admin approval.
          </p>
        ) : (
          <>
            <div className="flex border-b border-white/[0.08]">
              {tabs.map((tab) => {
                const isActive = tab.key === activeTab?.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActive(tab.key)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative flex flex-1 items-center justify-center gap-1.5 pb-3 text-center text-[16px] font-semibold transition-colors",
                      isActive ? "text-fg" : "text-fg-muted hover:text-fg"
                    )}
                  >
                    {tab.label}
                    {tab.badge ? (
                      <span className="gradient-brand rounded-full px-1.5 text-xs text-white">
                        {tab.badge}
                      </span>
                    ) : null}
                    {isActive && (
                      <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="min-h-[300px] pt-4">{activeTab?.content}</div>
          </>
        )}
      </div>
    </main>
  );
}
