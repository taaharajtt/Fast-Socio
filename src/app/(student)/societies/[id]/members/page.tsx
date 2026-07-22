import Link from "next/link";
import { Settings2, Users } from "lucide-react";
import { SocietyShell } from "@/components/societies/society-shell";
import { OfficerRow } from "@/components/societies/officer-row";
import { AppImage } from "@/components/ui/app-image";
import { createClient } from "@/lib/supabase/server";
import { getSocietyContext } from "@/lib/societies/load";
import { getSocietyOfficers } from "@/lib/societies/queries";
import { canManageSociety } from "@/lib/societies/logic";

export default async function SocietyMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getSocietyContext(id);
  const supabase = await createClient();

  const officers = await getSocietyOfficers(id);
  const officerIds = new Set(officers.map((o) => o.user_id));

  const { data: memberRows } = await supabase
    .from("community_members")
    .select("user_id")
    .eq("community_id", id)
    .limit(200);
  const followerIds = (memberRows ?? [])
    .map((m) => m.user_id as string)
    .filter((uid) => !officerIds.has(uid))
    .slice(0, 60);

  const { data: profs } = followerIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, username, avatar_url")
        .in("id", followerIds)
    : { data: [] as { id: string; full_name: string | null; username: string | null; avatar_url: string | null }[] };

  const canManage = canManageSociety(ctx.viewer);

  return (
    <SocietyShell ctx={ctx} active="members">
      <div className="space-y-6">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">
              Officers ({officers.length})
            </h2>
            {canManage && (
              <Link
                href={`/societies/${id}/manage`}
                className="flex items-center gap-1 text-xs font-medium text-accent"
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden /> Manage
              </Link>
            )}
          </div>
          <div className="space-y-2">
            {officers.map((o) => (
              <OfficerRow key={o.user_id} officer={o} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Users className="h-4 w-4" aria-hidden /> Followers
          </h2>
          {(profs ?? []).length === 0 ? (
            <p className="rounded-[14px] bg-card px-4 py-6 text-center text-sm text-fg-muted">
              No followers yet.
            </p>
          ) : (
            <div className="space-y-2">
              {(profs ?? []).map((p) => {
                const name = p.full_name ?? p.username ?? "Member";
                return (
                  <Link
                    key={p.id}
                    href={`/profile/${p.id}`}
                    className="flex items-center gap-3 rounded-[14px] bg-card p-3"
                  >
                    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold text-fg-muted">
                      {p.avatar_url ? (
                        <AppImage src={p.avatar_url} alt="" sizes="36px" />
                      ) : (
                        name.charAt(0).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg">
                        {name}
                      </span>
                      {p.username && (
                        <span className="block truncate text-xs text-fg-muted">
                          @{p.username}
                        </span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </SocietyShell>
  );
}
