"use client";

import { useRouter } from "next/navigation";
import { RenameControl } from "@/components/ui/rename-control";
import { renameEvent } from "@/app/(student)/events/actions";
import { TITLE_RULES } from "@/lib/spaces/rename";

/**
 * The event's rename affordance (UAT-08).
 *
 * A thin client wrapper so `EventShell` — which is rendered from a server
 * component — can host the control without becoming a client component itself.
 *
 * `router.refresh()` after a successful rename rather than local state: the
 * title appears in the shell, in the tab content and in anything else the
 * server render produced from it, and refreshing is what keeps those in step
 * instead of leaving the page showing two different names.
 */
export function EventRenameControl({
  eventId,
  title,
}: {
  eventId: string;
  title: string;
}) {
  const router = useRouter();
  return (
    <RenameControl
      value={title}
      label="event title"
      minLength={TITLE_RULES.event.min}
      maxLength={TITLE_RULES.event.max}
      onSave={async (next) => {
        const res = await renameEvent(eventId, next);
        if (!res.ok) return res;
        router.refresh();
        return { ok: true, value: res.title };
      }}
    />
  );
}
