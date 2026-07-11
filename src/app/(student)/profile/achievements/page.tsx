import Link from "next/link";
import { ChevronLeft, Lock } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

type Achievement = {
  code: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  aura_reward: number;
  sort_order: number;
};

/** Achievements catalog with the viewer's unlock state (Refactor Phase 5). */
export default async function AchievementsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const [{ data: catalog }, { data: mine }] = await Promise.all([
    supabase
      .from("achievements")
      .select("code, title, description, icon, category, aura_reward, sort_order")
      .order("sort_order", { ascending: true }),
    supabase
      .from("user_achievements")
      .select("code, earned_at")
      .eq("user_id", me),
  ]);

  const all = (catalog as Achievement[]) ?? [];
  const earned = new Map<string, string>(
    ((mine as { code: string; earned_at: string }[]) ?? []).map((r) => [
      r.code,
      r.earned_at,
    ])
  );
  const earnedCount = earned.size;

  // Unlocked first, then locked — each group keeps catalog order.
  const ordered = [...all].sort(
    (a, b) =>
      Number(earned.has(b.code)) - Number(earned.has(a.code)) ||
      a.sort_order - b.sort_order
  );

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/profile/aura"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold">Achievements</h1>
      </div>

      {all.length > 0 && (
        <p className="mb-4 text-sm text-fg-muted">
          {earnedCount} of {all.length} unlocked
        </p>
      )}

      {all.length === 0 ? (
        <GlassCard className="p-5">
          <p className="text-sm text-fg-muted">
            Achievements are on the way. Keep posting, matching, and attending
            events to earn them.
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {ordered.map((a) => {
            const at = earned.get(a.code);
            const unlocked = at !== undefined;
            return (
              <GlassCard
                key={a.code}
                radius="card"
                className={
                  unlocked ? "p-4" : "p-4 opacity-60 grayscale"
                }
              >
                <div className="flex items-start justify-between">
                  <span className="text-3xl" aria-hidden>
                    {a.icon}
                  </span>
                  {unlocked ? (
                    a.aura_reward > 0 && (
                      <span className="rounded-full bg-aura/15 px-2 py-0.5 text-[11px] font-semibold text-aura">
                        +{a.aura_reward}
                      </span>
                    )
                  ) : (
                    <Lock className="h-4 w-4 text-fg-disabled" aria-hidden />
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold text-fg">{a.title}</p>
                <p className="mt-0.5 text-xs text-fg-muted">{a.description}</p>
                {unlocked && (
                  <p className="mt-2 text-[11px] font-medium text-aura">
                    Unlocked{" "}
                    {new Date(at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </main>
  );
}
