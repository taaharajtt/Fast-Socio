import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { SocietyShell } from "@/components/societies/society-shell";
import { EventMini } from "@/components/societies/event-mini";
import { getSocietyContext } from "@/lib/societies/load";
import {
  getUpcomingSocietyEvents,
  getPastSocietyEvents,
} from "@/lib/societies/queries";
import { canManageSociety } from "@/lib/societies/logic";

export default async function SocietyEventsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getSocietyContext(id);
  const [upcoming, past] = await Promise.all([
    getUpcomingSocietyEvents(id, 40),
    getPastSocietyEvents(id, 20),
  ]);
  const canManage = canManageSociety(ctx.viewer);

  return (
    <SocietyShell ctx={ctx} active="events">
      <div className="space-y-6">
        {canManage && (
          // Reuses the existing event creator; the host picks this society there.
          <Link
            href="/events/new"
            className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white active:scale-95"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Create an event
          </Link>
        )}

        <section>
          <h2 className="mb-2 text-sm font-semibold text-fg">Upcoming</h2>
          {upcoming.length === 0 ? (
            <div className="rounded-[14px] bg-card px-5 py-8 text-center">
              <CalendarDays className="mx-auto h-7 w-7 text-fg-muted" aria-hidden />
              <p className="mt-2 text-sm text-fg-muted">No upcoming events yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((e) => (
                <EventMini key={e.id} event={e} />
              ))}
            </div>
          )}
        </section>

        {past.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-fg">Past events</h2>
            <div className="space-y-2 opacity-80">
              {past.map((e) => (
                <EventMini key={e.id} event={e} />
              ))}
            </div>
          </section>
        )}
      </div>
    </SocietyShell>
  );
}
