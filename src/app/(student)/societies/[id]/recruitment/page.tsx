import { Mail, Sparkles, Wrench } from "lucide-react";
import { SocietyShell } from "@/components/societies/society-shell";
import { getSocietyContext } from "@/lib/societies/load";
import { canManageSociety } from "@/lib/societies/logic";

/**
 * Recruitment (application forms + reviews) is Phase B of the Society/Event OS.
 * This page ships the surface + status today; the form builder and applications
 * land next. For now it exposes the society's recruiting state and a contact.
 */
export default async function SocietyRecruitmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getSocietyContext(id);
  const { society: s } = ctx;
  const canManage = canManageSociety(ctx.viewer);

  return (
    <SocietyShell ctx={ctx} active="recruitment">
      <div className="space-y-4">
        {s.recruitment_open ? (
          <div className="rounded-[14px] bg-success/12 p-5 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-success/20 text-success">
              <Sparkles className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-3 font-semibold text-fg">Recruitment is open</p>
            <p className="mt-1 text-sm text-fg-muted">
              This society is welcoming new members.
            </p>
            {s.contact_email && (
              <a
                href={`mailto:${s.contact_email}`}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white"
              >
                <Mail className="h-4 w-4" aria-hidden /> Get in touch
              </a>
            )}
          </div>
        ) : (
          <div className="rounded-[14px] bg-card px-5 py-10 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
            <p className="mt-3 font-semibold text-fg">Not recruiting right now</p>
            <p className="mt-1 text-sm text-fg-muted">
              Follow the society to hear when applications open.
            </p>
          </div>
        )}

        <div className="flex items-start gap-3 rounded-[14px] border border-dashed border-glass-border p-4">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
          <p className="text-xs text-fg-muted">
            Application forms and a review inbox are coming soon.
            {canManage
              ? " You'll be able to build forms and triage applicants here."
              : " You'll be able to apply here in one tap."}
          </p>
        </div>
      </div>
    </SocietyShell>
  );
}
