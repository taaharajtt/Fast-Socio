import Link from "next/link";
import { Calendar, Compass, MessageSquare, ShieldCheck } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { SectionHeader, VerifiedBadge } from "@/components/ui";
import { communityIcon } from "@/lib/communities/icon";
import { CreateSpaceButton } from "@/components/communities/create-space-button";
import { ChatRoomCard, type ChatRoomCardVM } from "@/components/communities/chat-room-card";

export type YourSpaceVM = {
  id: string;
  name: string;
  avatar_url: string | null;
  cover_url: string | null;
  isSociety: boolean;
  /** Official/verified society — shows the blue check next to the name. */
  isOfficial?: boolean;
  /** Members seen in the last two minutes. The dot lights up above 1. */
  activeNow: number;
};

/** A square tile in one of the horizontal discovery rows. */
export type TileVM = {
  id: string;
  name: string;
  image: string | null;
  href: string;
  /** Purple corner tag — the event date. */
  badge?: string;
  /** Official communities get a check in the top-right corner. */
  verified?: boolean;
  /** Caption under the name, e.g. "21 members · 1 active". */
  meta?: string;
  /** Members seen in the last two minutes; > 0 lights the corner dot. */
  activeNow?: number;
};

/**
 * Edge-to-edge horizontal rail; tiles bleed into the page gutter as they
 * scroll. Finger-scrolled only — no scrollbar chrome, and overscroll is
 * contained so swiping past the last tile can't trigger the browser's
 * back-navigation gesture.
 */
function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto overscroll-x-contain px-4 pb-1">
      <div className="flex gap-3">{children}</div>
    </div>
  );
}

/**
 * Live-presence dot. It hangs off the bottom-right corner of a tile — placed on
 * the tile's unclipped wrapper, ringed in the page background — so it floats
 * above both the cover art and the page rather than sitting inside the artwork.
 */
function ActiveDot({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} active now`}
      className="absolute -bottom-0.5 -right-0.5 z-10 h-3.5 w-3.5 rounded-full border-[3px] border-bg bg-success"
    />
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] bg-card px-5 py-6 text-center">
      <span className="mx-auto block w-fit text-fg-muted">{icon}</span>
      <p className="mt-2 text-sm text-fg-muted">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-disabled">{hint}</p>}
    </div>
  );
}

/**
 * Your Spaces: a compact 60px square per space — image, name, and nothing
 * else. Roles ("Owner"/"Officer") deliberately do NOT appear here; they belong
 * inside the space, on its member rows, not on a navigation tile.
 */
function SpaceTile({ s }: { s: YourSpaceVM }) {
  const image = s.avatar_url ?? s.cover_url;
  return (
    <Link
      href={s.isSociety ? `/societies/${s.id}` : `/communities/${s.id}`}
      className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 text-center"
    >
      {/* The dot lives on this wrapper, not inside the clipped tile, so it can
          straddle the corner and sit above both the cover and the page. */}
      <span className="relative block h-[60px] w-[60px]">
        <span className="glass relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl">
          {image ? (
            <AppImage src={image} alt="" sizes="60px" />
          ) : (
            <span className="text-2xl" aria-hidden>
              {communityIcon(s.name)}
            </span>
          )}
        </span>
        {/* Only meaningful when someone else is around too — a lone dot for
            your own heartbeat would light up on every tile, always. */}
        {s.activeNow > 1 && <ActiveDot count={s.activeNow} />}
      </span>
      <span className="flex w-full min-w-0 items-center justify-center gap-0.5">
        <span className="min-w-0 truncate text-[11px] font-medium text-fg-muted">
          {s.name}
        </span>
        {s.isSociety && s.isOfficial && <VerifiedBadge size={11} className="shrink-0" />}
      </span>
    </Link>
  );
}

/**
 * Discovery tile: a square cover with the name underneath (wireframe rows 2–3).
 * Corner marks are per-row — events carry a purple date tag, verified
 * communities a check plus a live-activity dot.
 */
function SquareTile({ t }: { t: TileVM }) {
  const active = t.activeNow ?? 0;
  return (
    <Link href={t.href} className="w-[156px] shrink-0">
      <span className="relative block h-[156px] w-[156px]">
        <span className="glass relative flex h-full w-full items-center justify-center overflow-hidden rounded-[22px]">
          {t.image ? (
            <AppImage src={t.image} alt="" sizes="156px" />
          ) : (
            <span className="text-4xl" aria-hidden>
              {communityIcon(t.name)}
            </span>
          )}

          {t.badge && (
            <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-white">
              {t.badge}
            </span>
          )}
          {t.verified && (
            <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/45">
              <VerifiedBadge size={13} />
            </span>
          )}
        </span>
        {/* Presence only earns a mark when someone is actually there. */}
        {active > 0 && <ActiveDot count={active} />}
      </span>

      <span className="mt-1.5 block truncate text-center text-[13px] font-medium text-fg">
        {t.name}
      </span>
      {t.meta && (
        <span className="block truncate text-center text-[11px] text-fg-muted">
          {t.meta}
        </span>
      )}
    </Link>
  );
}

/**
 * The Community hub body. Four sections in a fixed order — Your Spaces,
 * Upcoming Events, Verified Communities, Community Chats — with the first three
 * as compact horizontal rails so the page stays short, and only the last
 * rendered as full-width cards (they carry Follow/Join, the rails do not).
 *
 * Nothing here is a place to talk. The last section is a directory of rooms you
 * can follow or ask to join; the conversation itself opens in Chat, from the
 * room's own profile page.
 */
export function CommunityMainView({
  yourSpaces,
  verifiedCommunities,
  upcomingEvents,
  chatRooms,
}: {
  yourSpaces: YourSpaceVM[];
  verifiedCommunities: TileVM[];
  upcomingEvents: TileVM[];
  chatRooms: ChatRoomCardVM[];
}) {
  return (
    <>
      <section className="mt-6">
        <SectionHeader title="Your spaces" />
        {yourSpaces.length === 0 ? (
          <EmptyState
            icon={<Compass className="h-7 w-7" aria-hidden />}
            title="No spaces yet"
            hint="Follow a verified community below to get started"
          />
        ) : (
          <Rail>
            {yourSpaces.map((s) => (
              <SpaceTile key={s.id} s={s} />
            ))}
          </Rail>
        )}
      </section>

      <section className="mt-7">
        <SectionHeader title="Upcoming Events" />
        {upcomingEvents.length === 0 ? (
          <EmptyState
            icon={<Calendar className="h-7 w-7" aria-hidden />}
            title="No upcoming campus events"
          />
        ) : (
          <Rail>
            {upcomingEvents.map((t) => (
              <SquareTile key={t.id} t={t} />
            ))}
          </Rail>
        )}
      </section>

      <section className="mt-7">
        <SectionHeader title="Verified Communities" />
        {verifiedCommunities.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-7 w-7" aria-hidden />}
            title="No verified communities yet"
          />
        ) : (
          <Rail>
            {verifiedCommunities.map((t) => (
              <SquareTile key={t.id} t={t} />
            ))}
          </Rail>
        )}
      </section>

      <section className="mt-7">
        <SectionHeader title="Community Chats" />
        {chatRooms.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-7 w-7" aria-hidden />}
            title="No community chats yet"
            hint={
              <Link href="/communities/new" className="font-medium text-accent">
                Create the first one
              </Link>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {chatRooms.map((c) => (
              <ChatRoomCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export { CreateSpaceButton };
