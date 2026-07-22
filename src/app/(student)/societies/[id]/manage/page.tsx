import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ExternalLink,
  Megaphone,
  ShieldCheck,
  Users,
} from "lucide-react";
import { VerifiedBadge } from "@/components/ui";
import { SocietyProfileEditor } from "@/components/societies/society-profile-editor";
import { MemberRoleList } from "@/components/societies/member-role-list";
import { AnnouncementComposer } from "@/components/societies/announcement-composer";
import { getSocietyContext } from "@/lib/societies/load";
import { getSocietyOfficers } from "@/lib/societies/queries";
import { canManageSociety } from "@/lib/societies/logic";

export const metadata = { title: "Manage society · FAST SOCIO" };

function Card({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[16px] bg-bg-elevated p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-fg-muted">{icon}</span>
        <div>
          <h2 className="text-sm font-bold text-fg">{title}</h2>
          {desc && <p className="text-xs text-fg-muted">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default async function SocietyManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getSocietyContext(id);
  if (!canManageSociety(ctx.viewer)) redirect(`/societies/${id}`);

  const officers = await getSocietyOfficers(id);
  const { society: s, viewer } = ctx;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <Link
          href={`/societies/${id}`}
          aria-label="Back to society"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-lg font-bold">{s.name}</h1>
            {s.is_official && <VerifiedBadge size={15} />}
          </div>
          <p className="text-xs text-fg-muted">Society control centre</p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Quick links */}
        <div className="grid grid-cols-3 gap-2">
          <Link
            href={`/societies/${id}`}
            className="flex flex-col items-center gap-1 rounded-[14px] bg-card p-3 text-center"
          >
            <ExternalLink className="h-5 w-5 text-accent" aria-hidden />
            <span className="text-xs font-medium">Public page</span>
          </Link>
          <Link
            href={`/societies/${id}/events`}
            className="flex flex-col items-center gap-1 rounded-[14px] bg-card p-3 text-center"
          >
            <CalendarDays className="h-5 w-5 text-accent" aria-hidden />
            <span className="text-xs font-medium">Events</span>
          </Link>
          <Link
            href={`/societies/${id}/members`}
            className="flex flex-col items-center gap-1 rounded-[14px] bg-card p-3 text-center"
          >
            <Users className="h-5 w-5 text-accent" aria-hidden />
            <span className="text-xs font-medium">Members</span>
          </Link>
        </div>

        {s.is_official ? (
          <p className="flex items-center gap-1.5 rounded-[12px] bg-verified/10 px-3 py-2 text-xs text-fg-muted">
            <ShieldCheck className="h-4 w-4 text-verified" aria-hidden />
            Verified as an official society.
          </p>
        ) : (
          <p className="rounded-[12px] bg-card px-3 py-2 text-xs text-fg-muted">
            Not yet official — an admin can verify your society for a blue check.
          </p>
        )}

        <Card
          icon={<Megaphone className="h-4 w-4" aria-hidden />}
          title="Post an announcement"
          desc="Broadcast to everyone or members only."
        >
          <AnnouncementComposer societyId={id} />
        </Card>

        <Card
          icon={<Users className="h-4 w-4" aria-hidden />}
          title="Officers & roles"
          desc="Appoint officers; you can’t grant a role at or above your own."
        >
          <MemberRoleList
            societyId={id}
            officers={officers}
            viewer={{ role: viewer.role, isAdmin: viewer.isAdmin }}
          />
        </Card>

        <Card
          icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
          title="Society profile"
          desc="Category, bio, banner, recruiting and links."
        >
          <SocietyProfileEditor society={s} />
        </Card>
      </div>
    </main>
  );
}
