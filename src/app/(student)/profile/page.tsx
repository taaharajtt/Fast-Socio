import Link from "next/link";
import { Settings, Pencil } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, department, semester, bio, avatar_url, aura_score, interests"
    )
    .eq("id", user!.id)
    .single();

  const interests: string[] = profile?.interests ?? [];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="flex items-start justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/profile/edit"
            aria-label="Edit profile"
            className="glass flex h-10 w-10 items-center justify-center rounded-full text-fg-muted hover:text-fg"
          >
            <Pencil className="h-5 w-5" aria-hidden />
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            className="glass flex h-10 w-10 items-center justify-center rounded-full text-fg-muted hover:text-fg"
          >
            <Settings className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </div>

      <GlassCard radius="card" className="mt-6 overflow-hidden p-6">
        <div className="flex items-center gap-4">
          <div className="glass h-20 w-20 shrink-0 overflow-hidden rounded-full">
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt={profile.full_name ?? "Avatar"}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-bold">
              {profile?.full_name ?? "—"}
            </h2>
            <p className="truncate text-fg-muted">
              {profile?.department ?? "—"}
              {profile?.semester ? ` · Semester ${profile.semester}` : ""}
            </p>
            <div className="mt-2">
              <Link href="/profile/aura">
                <GlassChip tone="aura">
                  ★ {profile?.aura_score ?? 0} Aura
                </GlassChip>
              </Link>
            </div>
          </div>
        </div>

        {profile?.bio && (
          <p className="mt-4 text-[15px] text-fg/90">{profile.bio}</p>
        )}
      </GlassCard>

      {interests.length > 0 && (
        <section className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-fg-muted">Interests</h3>
          <div className="flex flex-wrap gap-2">
            {interests.map((tag) => (
              <GlassChip key={tag}>{tag}</GlassChip>
            ))}
          </div>
        </section>
      )}

      <Link href="/leaderboard" className="mt-4 block">
        <GlassCard className="flex items-center justify-between p-4">
          <span className="font-medium">🏆 Leaderboard</span>
          <span className="text-sm text-fg-muted">This week ›</span>
        </GlassCard>
      </Link>

      <GlassCard className="mt-4 p-5">
        <p className="text-sm text-fg-muted">
          Communities, Events Attended, and Posts strips arrive with their
          respective phases.
        </p>
      </GlassCard>
    </main>
  );
}
