import Link from "next/link";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

/** Shape returned by public.get_admin_overview() (migration 0016). */
type Overview = {
  students_total: number;
  students_banned: number;
  signups_24h: number;
  signups_7d: number;
  dau: number;
  wau: number;
  matches_total: number;
  matches_7d: number;
  right_swipes: number;
  match_rate_pct: number;
  posts_total: number;
  posts_7d: number;
  messages_7d: number;
  communities_total: number;
  events_total: number;
  reports_pending: number;
  reports_reviewing: number;
  mod_actions_7d: number;
};

const nf = new Intl.NumberFormat("en-US");

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <GlassCard className="p-4">
      <p className={`text-2xl font-bold ${accent ? "text-aura" : ""}`}>
        {typeof value === "number" ? nf.format(value) : value}
      </p>
      <p className="mt-0.5 text-xs text-fg-muted">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-fg-muted/70">{sub}</p>}
    </GlassCard>
  );
}

export default async function AdminHome() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_overview");
  const o = (data ?? null) as Overview | null;

  const backlog = (o?.reports_pending ?? 0) + (o?.reports_reviewing ?? 0);

  return (
    <main>
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Platform health at a glance · figures update on each load.
      </p>

      {error || !o ? (
        <GlassCard className="mt-5 p-4">
          <p className="text-sm text-fg-muted">
            Could not load analytics.
            {error ? ` (${error.message})` : ""}
          </p>
        </GlassCard>
      ) : (
        <>
          {/* Engagement */}
          <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Engagement
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Active today (DAU)" value={o.dau} accent />
            <Kpi label="Active this week (WAU)" value={o.wau} accent />
            <Kpi
              label="Students"
              value={o.students_total}
              sub={`${nf.format(o.students_banned)} banned`}
            />
            <Kpi
              label="New signups"
              value={o.signups_7d}
              sub={`${nf.format(o.signups_24h)} in last 24h`}
            />
          </div>

          {/* Matching */}
          <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Matching
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              label="Matches"
              value={o.matches_total}
              sub={`${nf.format(o.matches_7d)} this week`}
            />
            <Kpi
              label="Match rate"
              value={`${o.match_rate_pct}%`}
              sub="of right-swipes reciprocated"
              accent
            />
            <Kpi label="Right-swipes" value={o.right_swipes} />
            <Kpi label="Messages (7d)" value={o.messages_7d} />
          </div>

          {/* Content */}
          <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Content
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              label="Posts"
              value={o.posts_total}
              sub={`${nf.format(o.posts_7d)} this week`}
            />
            <Kpi label="Communities" value={o.communities_total} />
            <Kpi label="Events" value={o.events_total} />
            <Kpi label="Mod actions (7d)" value={o.mod_actions_7d} />
          </div>

          {/* Moderation backlog — the number an admin acts on first. */}
          <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Moderation
          </h2>
          <GlassCard className="mt-2 flex items-center justify-between p-4">
            <div>
              <p className="text-2xl font-bold">
                {nf.format(backlog)}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                Reports in backlog · {nf.format(o.reports_pending)} pending,{" "}
                {nf.format(o.reports_reviewing)} reviewing
              </p>
            </div>
            <Link
              href="/admin/reports?type=profile"
              className="rounded-[var(--radius-pill)] bg-aura px-4 py-2 text-sm text-white"
            >
              Review queue
            </Link>
          </GlassCard>

          <div className="mt-4">
            <Link
              href="/admin/audit"
              className="text-sm text-aura hover:underline"
            >
              View moderation audit log →
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
