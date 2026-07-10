import Link from "next/link";
import { PageHeader, SectionLabel, ctrl } from "@/components/admin/kit";
import { createClient } from "@/lib/supabase/server";

type Series = { d: string; signups: number; posts: number; matches: number; messages: number };
type Abuse = { user: string; action: string; count: number };

/** Neutral CSS bar chart (control-centre monochrome — no chart library). */
function MiniBars({ label, values }: { label: string; values: number[] }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-[4px] border border-glass-border p-3">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">{label}</p>
        <p className="font-mono text-xs tabular-nums text-fg">{total}</p>
      </div>
      <div className="mt-2 flex h-10 items-end gap-0.5">
        {values.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-[1px] bg-fg-muted/60"
            style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
            title={`${v}`}
          />
        ))}
      </div>
    </div>
  );
}

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
  const [{ data, error }, { data: analytics }] = await Promise.all([
    supabase.rpc("get_admin_overview"),
    supabase.rpc("admin_analytics"),
  ]);
  const o = (data ?? null) as Overview | null;
  const a = (analytics ?? null) as { series: Series[]; abuse: Abuse[] } | null;
  const series = a?.series ?? [];
  const abuse = a?.abuse ?? [];

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

          {series.length > 0 && (
            <section>
              <SectionLabel>Trends · 14 days</SectionLabel>
              <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MiniBars label="Signups" values={series.map((s) => s.signups)} />
                <MiniBars label="Posts" values={series.map((s) => s.posts)} />
                <MiniBars label="Matches" values={series.map((s) => s.matches)} />
                <MiniBars label="Messages" values={series.map((s) => s.messages)} />
              </div>
            </section>
          )}

          <section>
            <SectionLabel>Rate-limit abuse · 24h</SectionLabel>
            {abuse.length === 0 ? (
              <p className="mt-2 rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
                No abuse detected (no user hit a limit ≥5× in the last 24h).
              </p>
            ) : (
              <div className="mt-2 overflow-hidden rounded-[4px] border border-glass-border">
                <div className="divide-y divide-glass-border">
                  {abuse.map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-fg">{r.user}</p>
                        <p className="font-mono text-[11px] text-fg-muted">{r.action}</p>
                      </div>
                      <span className="font-mono text-sm tabular-nums text-warning">{r.count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
