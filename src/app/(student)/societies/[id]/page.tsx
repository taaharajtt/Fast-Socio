import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  Globe,
  Camera,
  Mail,
  Megaphone,
  Sparkles,
  Users,
} from "lucide-react";
import { SocietyShell } from "@/components/societies/society-shell";
import { OfficerRow } from "@/components/societies/officer-row";
import { EventMini } from "@/components/societies/event-mini";
import { AnnouncementCard } from "@/components/societies/announcement-card";
import { getSocietyContext } from "@/lib/societies/load";
import {
  getSocietyOfficers,
  getUpcomingSocietyEvents,
  getSocietyAnnouncements,
} from "@/lib/societies/queries";
import { canManageSociety } from "@/lib/societies/logic";

export default async function SocietyOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getSocietyContext(id);
  const { society: s, viewer } = ctx;
  const base = `/societies/${id}`;

  const [officers, events, announcements] = await Promise.all([
    getSocietyOfficers(id),
    getUpcomingSocietyEvents(id, 3),
    getSocietyAnnouncements(id, 2),
  ]);
  const canManage = canManageSociety(viewer);

  return (
    <SocietyShell ctx={ctx} active="overview">
      <div className="space-y-6">
        {/* About + socials */}
        <section>
          {s.description ? (
            <p className="whitespace-pre-wrap text-[15px] text-fg/90">
              {s.description}
            </p>
          ) : (
            <p className="text-sm text-fg-muted">No description yet.</p>
          )}
          {(s.instagram_url || s.website_url || s.contact_email) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {s.instagram_url && (
                <a
                  href={s.instagram_url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-fg-muted"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden /> Instagram
                </a>
              )}
              {s.website_url && (
                <a
                  href={s.website_url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-fg-muted"
                >
                  <Globe className="h-3.5 w-3.5" aria-hidden /> Website
                </a>
              )}
              {s.contact_email && (
                <a
                  href={`mailto:${s.contact_email}`}
                  className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-fg-muted"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden /> Contact
                </a>
              )}
            </div>
          )}
        </section>

        {/* Stats */}
        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-[14px] bg-card p-4">
            <p className="flex items-center gap-1.5 text-xs text-fg-muted">
              <Users className="h-3.5 w-3.5" aria-hidden /> Followers
            </p>
            <p className="mt-1 text-xl font-bold">{s.member_count.toLocaleString()}</p>
          </div>
          <div className="rounded-[14px] bg-card p-4">
            <p className="flex items-center gap-1.5 text-xs text-fg-muted">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Upcoming
            </p>
            <p className="mt-1 text-xl font-bold">{events.length}</p>
          </div>
        </section>

        {/* Recruiting banner */}
        {s.recruitment_open && (
          <Link
            href={`${base}/recruitment`}
            className="flex items-center gap-3 rounded-[14px] bg-success/12 p-4"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success/20 text-success">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-fg">
                Recruitment is open
              </span>
              <span className="block text-xs text-fg-muted">
                Applications are being accepted — tap to apply.
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
          </Link>
        )}

        {/* Upcoming events */}
        <Section
          title="Upcoming events"
          href={`${base}/events`}
          show={events.length > 0}
        >
          <div className="space-y-2">
            {events.map((e) => (
              <EventMini key={e.id} event={e} />
            ))}
          </div>
        </Section>

        {/* Recent announcements */}
        <Section
          title="Latest news"
          href={`${base}/announcements`}
          show={announcements.length > 0}
        >
          <div className="space-y-2">
            {announcements.map((a) => (
              <AnnouncementCard key={a.id} a={a} canManage={canManage} />
            ))}
          </div>
        </Section>

        {/* Officers */}
        <Section title="Officers" href={`${base}/members`} show={officers.length > 0}>
          <div className="space-y-2">
            {officers.slice(0, 5).map((o) => (
              <OfficerRow key={o.user_id} officer={o} />
            ))}
          </div>
        </Section>

        {events.length === 0 &&
          announcements.length === 0 &&
          officers.length <= 1 && (
            <div className="rounded-[14px] bg-card px-5 py-8 text-center">
              <Megaphone className="mx-auto h-7 w-7 text-fg-muted" aria-hidden />
              <p className="mt-2 text-sm text-fg-muted">
                This society is just getting started.
              </p>
            </div>
          )}
      </div>
    </SocietyShell>
  );
}

function Section({
  title,
  href,
  show,
  children,
}: {
  title: string;
  href: string;
  show: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <Link href={href} className="text-xs font-medium text-accent">
          See all
        </Link>
      </div>
      {children}
    </section>
  );
}
