import Link from "next/link";
import { PageHeader, SectionLabel, ctrl } from "@/components/admin/kit";
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

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-bg px-3 py-3">
      <p className="font-mono text-lg font-semibold tabular-nums text-fg">
        {typeof value === "number" ? nf.format(value) : value}
      </p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
        {label}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-fg-muted/70">{sub}</p>}
    </div>
  );
}

/** Hairline-separated metric grid (gap-px over the border colour). */
function MetricGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 overflow-hidden rounded-[4px] border border-glass-border">
      <div className="grid grid-cols-2 gap-px bg-glass-border md:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

export default async function AdminHome() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_overview");
  const o = (data ?? null) as Overview | null;

  const backlog = (o?.reports_pending ?? 0) + (o?.reports_reviewing ?? 0);

  return (
    <>
      <PageHeader title="Overview" sub="Platform health · recomputed on each load." />

      {error || !o ? (
        <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
          Could not load analytics.{error ? ` (${error.message})` : ""}
        </p>
      ) : (
        <div className="space-y-6">
          {/* Moderation backlog — the number an admin acts on first. */}
          <section>
            <SectionLabel>Moderation</SectionLabel>
            <div className="mt-2 flex items-center justify-between rounded-[4px] border border-glass-border px-4 py-3">
              <div>
                <p
                  className={`font-mono text-xl font-semibold tabular-nums ${
                    backlog > 0 ? "text-warning" : "text-fg"
                  }`}
                >
                  {nf.format(backlog)}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  in queue · {nf.format(o.reports_pending)} pending,{" "}
                  {nf.format(o.reports_reviewing)} reviewing ·{" "}
                  {nf.format(o.mod_actions_7d)} actions (7d)
                </p>
              </div>
              <Link href="/admin/reports?type=profile" className={ctrl}>
                Open queue →
              </Link>
            </div>
          </section>

          <section>
            <SectionLabel>Engagement</SectionLabel>
            <MetricGrid>
              <Metric label="DAU" value={o.dau} />
              <Metric label="WAU" value={o.wau} />
              <Metric
                label="Students"
                value={o.students_total}
                sub={`${nf.format(o.students_banned)} banned`}
              />
              <Metric
                label="Signups 7d"
                value={o.signups_7d}
                sub={`${nf.format(o.signups_24h)} in 24h`}
              />
            </MetricGrid>
          </section>

          <section>
            <SectionLabel>Matching</SectionLabel>
            <MetricGrid>
              <Metric
                label="Matches"
                value={o.matches_total}
                sub={`${nf.format(o.matches_7d)} this week`}
              />
              <Metric
                label="Match rate"
                value={`${o.match_rate_pct}%`}
                sub="right-swipes reciprocated"
              />
              <Metric label="Right-swipes" value={o.right_swipes} />
              <Metric label="Messages 7d" value={o.messages_7d} />
            </MetricGrid>
          </section>

          <section>
            <SectionLabel>Content</SectionLabel>
            <MetricGrid>
              <Metric
                label="Posts"
                value={o.posts_total}
                sub={`${nf.format(o.posts_7d)} this week`}
              />
              <Metric label="Communities" value={o.communities_total} />
              <Metric label="Events" value={o.events_total} />
              <Metric label="Mod actions 7d" value={o.mod_actions_7d} />
            </MetricGrid>
          </section>

          <Link
            href="/admin/audit"
            className="inline-block text-xs text-fg-muted hover:text-fg hover:underline"
          >
            View moderation audit log →
          </Link>
        </div>
      )}
    </>
  );
}
