import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { SocietyBrowser } from "@/components/societies/society-browser";
import type { SocietyCategory } from "@/lib/societies/logic";
import type { SocietyCardVM } from "@/lib/societies/types";

export const metadata = { title: "Societies · FAST SOCIO" };

type Row = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  member_count: number;
  society_category: string | null;
  is_official: boolean;
  recruitment_open: boolean;
};

export default async function SocietiesPage() {
  const supabase = await createClient();
  const me = (await getAuthUserId())!;

  const { data: rows } = await supabase
    .from("communities")
    .select(
      "id, name, description, avatar_url, cover_url, member_count, society_category, is_official, recruitment_open"
    )
    .eq("is_society", true)
    .eq("status", "approved")
    .order("is_official", { ascending: false })
    .order("member_count", { ascending: false });

  const societies = (rows ?? []) as Row[];
  const ids = societies.map((s) => s.id);

  // Followed set + upcoming-event counts (two light lookups, mirrors the
  // communities directory shape).
  const [{ data: memberRows }, { data: eventRows }] = await Promise.all([
    supabase.from("community_members").select("community_id").eq("user_id", me),
    ids.length
      ? supabase
          .from("events")
          .select("community_id")
          .in("community_id", ids)
          .eq("status", "approved")
          .gt("starts_at", new Date().toISOString())
      : Promise.resolve({ data: [] as { community_id: string }[] }),
  ]);

  const following = new Set((memberRows ?? []).map((m) => m.community_id as string));
  const upcoming = new Map<string, number>();
  for (const e of eventRows ?? []) {
    const cid = e.community_id as string;
    upcoming.set(cid, (upcoming.get(cid) ?? 0) + 1);
  }

  const vms: SocietyCardVM[] = societies.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    avatar_url: s.avatar_url,
    cover_url: s.cover_url,
    member_count: s.member_count,
    category: (s.society_category as SocietyCategory | null) ?? null,
    isOfficial: s.is_official,
    isRecruiting: s.recruitment_open,
    isFollowing: following.has(s.id),
    upcomingEvents: upcoming.get(s.id) ?? 0,
  }));

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className="gradient-brand flex h-10 w-10 items-center justify-center rounded-[14px] shadow-[0_8px_24px_rgba(124,92,255,0.35)]">
            <Building2 className="h-5 w-5 text-white" aria-hidden />
          </span>
          <div>
            <h1 className="text-[22px] font-bold leading-tight tracking-tight">
              Societies
            </h1>
            <p className="text-xs text-fg-muted">
              Discover and follow campus life.
            </p>
          </div>
        </div>
        <Link
          href="/communities/new"
          className="gradient-brand flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(124,92,255,0.35)] active:scale-95"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Start
        </Link>
      </div>

      {vms.length === 0 ? (
        <div className="glass mt-6 rounded-[14px] px-5 py-10 text-center">
          <Building2 className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
          <p className="mt-3 font-semibold text-fg">No societies yet</p>
          <p className="mt-1 text-sm text-fg-muted">
            Run a society? Create a community and register it as a society to get
            a public page, roles, announcements and events.
          </p>
          <Link
            href="/communities/new"
            className="gradient-brand mt-4 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-white active:scale-95"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Start a community
          </Link>
        </div>
      ) : (
        <SocietyBrowser societies={vms} />
      )}
    </main>
  );
}
