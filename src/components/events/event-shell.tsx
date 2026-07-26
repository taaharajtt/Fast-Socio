"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { RsvpButton, type RsvpState } from "@/components/events/rsvp-button";
import { cn } from "@/lib/utils";

export type EventShellTab = {
  key: string;
  label: string;
  content: React.ReactNode;
};

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
 * Stable chrome for an event: the 16:9 cover hero (title, host link, Attend/
 * RSVP) and the Overview/Members subtab bar stay mounted and visually frozen
 * while `activeTab` switches — both tabs' content is server-fetched up front
 * (see /events/[id]/page.tsx) and handed in as `tabs[].content`.
 */
export function EventShell({
  event,
  rsvp,
  tabs,
}: {
  event: {
    id: string;
    title: string;
    category: string;
    cover_url: string | null;
    hostName: string | null;
    hostHref: string | null;
    pending: boolean;
    ended: boolean;
  };
  rsvp: {
    initialState: RsvpState;
    count: number;
    capacity: number | null;
  };
  tabs: EventShellTab[];
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="relative h-[200px] w-full overflow-hidden">
        {event.cover_url ? (
          <AppImage
            src={event.cover_url}
            alt=""
            sizes="(max-width: 448px) 100vw, 448px"
          />
        ) : (
          <div className="h-full w-full" style={{ background: gradient(event.category) }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

        <Link
          href="/communities"
          aria-label="Back"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>

        <div className="absolute inset-x-4 bottom-3 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-bold text-white">{event.title}</h1>
            {event.hostName && (
              <p className="truncate text-[13px] text-white/75">
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
          {!event.pending && (
            <RsvpButton
              eventId={event.id}
              initialState={rsvp.initialState}
              count={rsvp.count}
              capacity={rsvp.capacity}
              ended={event.ended}
            />
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-4 py-4">
        {event.pending ? (
          <p className="mt-2 text-center text-sm text-fg-muted">
            This event is awaiting admin approval.
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
