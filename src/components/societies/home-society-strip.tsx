import Link from "next/link";
import { Building2, Sparkles } from "lucide-react";
import { GlassCard, VerifiedBadge } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { communityIcon } from "@/lib/communities/icon";
import { categoryLabel } from "@/lib/societies/constants";

type Row = {
  id: string;
  name: string;
  member_count: number;
  society_category: string | null;
  is_official: boolean;
  recruitment_open: boolean;
};

/**
 * "Campus societies" discovery rail for the Home feed. Surfaces official and
 * recruiting societies first; renders nothing when there are none.
 */
export async function HomeSocietyStrip() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("communities")
    .select("id, name, member_count, society_category, is_official, recruitment_open")
    .eq("is_society", true)
    .eq("status", "approved")
    .order("is_official", { ascending: false })
    .order("recruitment_open", { ascending: false })
    .order("member_count", { ascending: false })
    .limit(8);

  const societies = (data as Row[]) ?? [];
  if (societies.length === 0) return null;

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg-muted">
          <Building2 className="h-4 w-4" aria-hidden /> Campus societies
        </h2>
        <Link href="/societies" className="text-xs text-aura">
          See all
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {societies.map((s) => (
          <Link key={s.id} href={`/societies/${s.id}`} className="shrink-0">
            <GlassCard className="w-40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl leading-none" aria-hidden>
                  {communityIcon(s.name)}
                </span>
                {s.is_official && <VerifiedBadge size={15} />}
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-semibold">{s.name}</p>
              <p className="mt-1 text-[11px] text-fg-muted">
                {categoryLabel(s.society_category)} · {s.member_count} following
              </p>
              {s.recruitment_open && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-success">
                  <Sparkles className="h-3 w-3" aria-hidden /> Recruiting
                </p>
              )}
            </GlassCard>
          </Link>
        ))}
      </div>
    </section>
  );
}
