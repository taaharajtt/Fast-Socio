import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, Lock } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Badge } from "@/lib/badges";

/** Badge catalog with the viewer's earned state (replaces Achievements). */
export default async function BadgesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const [{ data: catalog }, { data: mine }] = await Promise.all([
    supabase
      .from("achievements")
      .select(
        "code, title, description, icon, image_url, category, aura_reward, sort_order"
      )
      .order("sort_order", { ascending: true }),
    supabase
      .from("user_achievements")
      .select("code, earned_at")
      .eq("user_id", me),
  ]);

  const all = (catalog as Badge[]) ?? [];
  const earned = new Map<string, string>(
    ((mine as { code: string; earned_at: string }[]) ?? []).map((r) => [
      r.code,
      r.earned_at,
    ])
  );
  const earnedCount = earned.size;

  // Earned first, then locked — each group keeps catalog order.
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
        <h1 className="text-lg font-bold">Badges</h1>
      </div>

      {all.length > 0 && (
        <p className="mb-4 text-sm text-fg-muted">
          {earnedCount} of {all.length} earned
        </p>
      )}

      {all.length === 0 ? (
        <GlassCard className="p-5">
          <p className="text-sm text-fg-muted">
            Badges are on the way. Keep posting, matching, and attending events
            to earn them.
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {ordered.map((b) => {
            const at = earned.get(b.code);
            const unlocked = at !== undefined;
            return (
              <GlassCard
                key={b.code}
                radius="card"
                className={unlocked ? "p-4" : "p-4 opacity-60 grayscale"}
              >
                <div className="flex items-start justify-between">
                  {b.image_url ? (
                    <Image
                      src={b.image_url}
                      alt=""
                      width={96}
                      height={96}
                      className="h-12 w-12 drop-shadow-md"
                      aria-hidden
                    />
                  ) : (
                    <span className="text-3xl" aria-hidden>
                      {b.icon}
                    </span>
                  )}
                  {unlocked ? (
                    b.aura_reward > 0 && (
                      <span className="rounded-full bg-aura/15 px-2 py-0.5 text-[11px] font-semibold text-aura">
                        +{b.aura_reward}
                      </span>
                    )
                  ) : (
                    <Lock className="h-4 w-4 text-fg-disabled" aria-hidden />
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold text-fg">{b.title}</p>
                <p className="mt-0.5 text-xs text-fg-muted">{b.description}</p>
                {unlocked && (
                  <p className="mt-2 text-[11px] font-medium text-aura">
                    Earned{" "}
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
