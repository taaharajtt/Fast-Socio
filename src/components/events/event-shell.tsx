import Link from "next/link";
import { EventRenameControl } from "@/components/events/event-rename-control";
import { ChevronLeft } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { RsvpButton, type RsvpState } from "@/components/events/rsvp-button";
import { SocialProof } from "@/components/communities/social-proof";
import { SpaceShell, type SpaceShellTab } from "@/components/communities/space-shell";
import type { SocialProofVM } from "@/lib/communities/social-proof";

export type EventShellTab = SpaceShellTab;

const CAT_GRADIENT: Record<string, [string, string]> = {
  Social: ["#7c3aed", "#a855f7"],
  Tech: ["#2563eb", "#7c3aed"],
  Academic: ["#0ea5e9", "#6366f1"],
  Sports: ["#f97316", "#ef4444"],
  Music: ["#a855f7", "#ec4899"],
  Arts: ["#ec4899", "#f97316"],
  Career: ["#0d9488", "#2563eb"],
  Gaming: ["#7c3aed", "#22c55e"],
  Food: ["#f59e0b", "#ef4444"],
};

function gradient(category: string): string {
  const [a, b] = CAT_GRADIENT[category] ?? ["#7c3aed", "#a855f7"];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

/**
 * An event's stable chrome: the 16:9 cover with Attend, the title, and the
 * Overview/Members tab bar — the same shape as a society or chat room, so all
 * three campus surfaces read as one family.
 */
export function EventShell({
  event,
  rsvp,
  proof,
  tabs,
}: {
  proof: SocialProofVM;
  event: {
    id: string;
    title: string;
    category: string;
    cover_url: string | null;
    hostName: string | null;
    hostHref: string | null;
    pending: boolean;
    ended: boolean;
    /** UAT-08: the viewer may rename this event (host, co-organizer, admin). */
    canRename?: boolean;
  };
  rsvp: {
    initialState: RsvpState;
    count: number;
    capacity: number | null;
  };
  tabs: EventShellTab[];
}) {
  const hero = (
    <>
      <div className="px-4 pt-2">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[20px]">
          {event.cover_url ? (
            <AppImage
              src={event.cover_url}
              alt=""
              sizes="(max-width: 448px) 100vw, 448px"
              priority
            />
          ) : (
            <div className="h-full w-full" style={{ background: gradient(event.category) }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/25" />

          <Link
            href="/communities"
            aria-label="Back"
            className="absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Link>

          {!event.pending && (
            <div className="absolute inset-x-3 bottom-3 z-10 flex items-end justify-between gap-2">
              <SocialProof proof={proof} label="attending" />
              <RsvpButton
                eventId={event.id}
                initialState={rsvp.initialState}
                count={rsvp.count}
                capacity={rsvp.capacity}
                ended={event.ended}
                compact
              />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pt-3">
        {/* UAT-08: the title is renameable in place by whoever manages the
            event. `rename_event` re-checks host / co-organizer / admin, so this
            control is an affordance, not the gate. */}
        <div className="flex items-center gap-1.5">
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-bold text-fg">
            {event.title}
          </h1>
          {event.canRename && (
            <EventRenameControl eventId={event.id} title={event.title} />
          )}
        </div>
        {event.hostName && (
          <p className="truncate text-[13px] text-fg-muted">
            {event.hostHref ? (
              <Link href={event.hostHref} className="hover:underline">
                {event.hostName}
              </Link>
            ) : (
              event.hostName
            )}
          </p>
        )}
      </div>
    </>
  );

  if (event.pending) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {hero}
        <p className="px-4 pt-8 text-center text-sm text-fg-muted">
          This event is awaiting admin approval.
        </p>
      </main>
    );
  }

  return <SpaceShell hero={hero} tabs={tabs} />;
}
