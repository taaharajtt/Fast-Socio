"use client";

import Link from "next/link";
import { Calendar, Compass, MapPin, MessageSquare, ShieldCheck, Users } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { communityIcon } from "@/lib/communities/icon";
import { CreationModalTrigger } from "@/components/communities/creation-modal";
import { CommunityBrowser, type CommunityVM } from "@/components/communities/community-browser";
import { SocietyBrowser } from "@/components/societies/society-browser";
import { QuickRsvpButton } from "@/components/communities/quick-rsvp-button";
import type { SocietyCardVM } from "@/lib/societies/types";

export type YourSpaceVM = {
  id: string;
  name: string;
  avatar_url: string | null;
  cover_url: string | null;
  role: "Owner" | "Officer" | "Member";
  isSociety: boolean;
};

export type UpcomingEventVM = {
  id: string;
  title: string;
  organizer: string;
  location: string | null;
  cover_url: string | null;
  day: string;
  month: string;
  attendee_count: number;
};

function SectionHeader({ title }: { title: string }) {
  return <h2 className="mb-3 text-[17px] font-bold">{title}</h2>;
}

function YourSpaceCard({ s }: { s: YourSpaceVM }) {
  return (
    <Link
      href={s.isSociety ? `/societies/${s.id}` : `/communities/${s.id}`}
      className="flex w-24 shrink-0 flex-col items-center gap-1.5 text-center"
    >
      <div className="glass relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl">
        {s.avatar_url || s.cover_url ? (
          <AppImage src={s.avatar_url ?? s.cover_url ?? ""} alt="" sizes="64px" />
        ) : (
          <span className="text-2xl" aria-hidden>
            {communityIcon(s.name)}
          </span>
        )}
      </div>
      <span className="w-full truncate text-[12px] font-medium text-fg">{s.name}</span>
      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
        {s.role}
      </span>
    </Link>
  );
}

function UpcomingEventCard({ e }: { e: UpcomingEventVM }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <Link href={`/events/${e.id}`} className="block">
        <div
          className="relative h-[90px]"
          style={
            e.cover_url
              ? undefined
              : { background: "linear-gradient(135deg, #7c3aed, #a855f7)" }
          }
        >
          {e.cover_url && (
            <AppImage src={e.cover_url} alt="" sizes="(max-width: 448px) 100vw, 448px" />
          )}
          <div className="absolute inset-0 bg-black/30" />
          <span className="absolute left-3 top-2.5 rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-white">
            {e.day} {e.month}
          </span>
        </div>
      </Link>
      <div className="space-y-1.5 p-3.5">
        <Link href={`/events/${e.id}`} className="block">
          <p className="truncate text-[15px] font-bold text-fg">{e.title}</p>
          <p className="truncate text-xs text-fg-muted">by {e.organizer}</p>
        </Link>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3 text-xs text-fg-muted">
            {e.location && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{e.location}</span>
              </span>
            )}
            <span className="flex shrink-0 items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {e.attendee_count}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <QuickRsvpButton eventId={e.id} />
            <Link
              href={`/events/${e.id}`}
              className="rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-semibold text-fg"
            >
              View
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CommunityMainView({
  yourSpaces,
  verifiedCommunities,
  upcomingEvents,
  chatRooms,
}: {
  yourSpaces: YourSpaceVM[];
  verifiedCommunities: SocietyCardVM[];
  upcomingEvents: UpcomingEventVM[];
  chatRooms: CommunityVM[];
}) {
  return (
    <>
      {/* Section 1: Your Spaces */}
      <section className="mt-6">
        <SectionHeader title="Your Spaces" />
        {yourSpaces.length === 0 ? (
          <div className="rounded-[14px] bg-card px-5 py-6 text-center">
            <Compass className="mx-auto h-7 w-7 text-fg-muted" aria-hidden />
            <p className="mt-2 text-sm text-fg-muted">No spaces joined yet</p>
            <p className="mt-0.5 text-xs text-fg-disabled">
              Explore verified communities below
            </p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {yourSpaces.map((s) => (
              <YourSpaceCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Verified Communities */}
      <section className="mt-8">
        <SectionHeader title="Verified Communities" />
        {verifiedCommunities.length === 0 ? (
          <div className="rounded-[14px] bg-card px-5 py-8 text-center">
            <ShieldCheck className="mx-auto h-7 w-7 text-fg-muted" aria-hidden />
            <p className="mt-2 text-sm text-fg-muted">No verified communities found</p>
          </div>
        ) : (
          <SocietyBrowser societies={verifiedCommunities} />
        )}
      </section>

      {/* Section 3: Upcoming Events */}
      <section className="mt-8">
        <SectionHeader title="Upcoming Events" />
        {upcomingEvents.length === 0 ? (
          <div className="rounded-[14px] bg-card px-5 py-8 text-center">
            <Calendar className="mx-auto h-7 w-7 text-fg-muted" aria-hidden />
            <p className="mt-2 text-sm text-fg-muted">No upcoming campus events scheduled</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingEvents.map((e) => (
              <UpcomingEventCard key={e.id} e={e} />
            ))}
          </div>
        )}
      </section>

      {/* Section 4: Chat Rooms */}
      <section className="mt-8">
        <SectionHeader title="Chat Rooms" />
        {chatRooms.length === 0 ? (
          <div className="rounded-[14px] bg-card px-5 py-8 text-center">
            <MessageSquare className="mx-auto h-7 w-7 text-fg-muted" aria-hidden />
            <p className="mt-2 text-sm text-fg-muted">No casual chat rooms available</p>
            <Link
              href="/communities/new"
              className="mt-2 inline-block text-xs font-medium text-accent"
            >
              Create the first chat room
            </Link>
          </div>
        ) : (
          <CommunityBrowser communities={chatRooms} />
        )}
      </section>
    </>
  );
}

export { CreationModalTrigger };
