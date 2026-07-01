import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { LEADERBOARD_TITLES } from "@/lib/leaderboard/titles";

type Row = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  department: string | null;
  weekly_aura: number;
  rank: number;
};

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_weekly_leaderboard", {
    p_limit: 50,
  });
  const rows = (data as Row[]) ?? [];
  const top3 = rows.filter((r) => r.rank <= 3);
  const rest = rows.filter((r) => r.rank > 3);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-1 flex items-center gap-3">
        <Link
          href="/profile"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
      </div>
      <p className="mb-5 ml-12 text-sm text-fg-muted">
        This week · resets Monday 00:00 PKT
      </p>

      {rows.length === 0 ? (
        <GlassCard className="p-6 text-center">
          <p className="text-sm text-fg-muted">
            No Aura earned yet this week. Match, post, and attend events to climb.
          </p>
        </GlassCard>
      ) : (
        <>
          {/* Top 3 featured cards */}
          <div className="space-y-3">
            {top3.map((r) => {
              const t = LEADERBOARD_TITLES[r.rank];
              return (
                <GlassCard
                  key={r.user_id}
                  strong
                  radius="lg"
                  className="flex items-center gap-4 p-4"
                  style={{
                    borderColor: t ? `${t.tint}66` : undefined,
                    boxShadow: t ? `0 6px 28px ${t.tint}22` : undefined,
                  }}
                >
                  <span className="text-2xl">{t?.emoji}</span>
                  <div
                    className="glass h-14 w-14 shrink-0 overflow-hidden rounded-full"
                    style={{ boxShadow: t ? `0 0 0 2px ${t.tint}88` : undefined }}
                  >
                    {r.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.avatar_url}
                        alt={r.full_name ?? ""}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">
                      {r.full_name ?? "Student"}
                    </p>
                    <p
                      className="text-xs font-medium"
                      style={{ color: t?.tint }}
                    >
                      {t?.title}
                    </p>
                    {r.department && (
                      <p className="truncate text-xs text-fg-muted">
                        {r.department}
                      </p>
                    )}
                  </div>
                  <span className="text-lg font-bold text-aura">
                    {r.weekly_aura}
                  </span>
                </GlassCard>
              );
            })}
          </div>

          {/* Remainder as compact list */}
          {rest.length > 0 && (
            <div className="mt-4 space-y-2">
              {rest.map((r) => (
                <GlassCard
                  key={r.user_id}
                  className="flex items-center gap-3 p-3"
                >
                  <span className="w-6 text-center text-sm font-semibold text-fg-muted">
                    {r.rank}
                  </span>
                  <div className="glass h-10 w-10 shrink-0 overflow-hidden rounded-full">
                    {r.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.avatar_url}
                        alt={r.full_name ?? ""}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {r.full_name ?? "Student"}
                    </p>
                    {r.department && (
                      <p className="truncate text-xs text-fg-muted">
                        {r.department}
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-aura">
                    {r.weekly_aura}
                  </span>
                </GlassCard>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
