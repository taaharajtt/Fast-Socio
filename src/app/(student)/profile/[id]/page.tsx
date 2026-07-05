import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { createClient } from "@/lib/supabase/server";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;
  const isSelf = id === me;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, full_name, department, semester, bio, avatar_url, aura_score, interests"
    )
    .eq("id", id)
    .single();
  if (!profile) notFound();

  // Are we matched? Only then do we surface a Message action.
  let matched = false;
  if (!isSelf) {
    const [lo, hi] = [me, id].sort();
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .eq("user_low", lo)
      .eq("user_high", hi)
      .maybeSingle();
    matched = Boolean(match);
  }

  const interests: string[] = profile.interests ?? [];
  const initials =
    (profile.full_name ?? "")
      .trim()
      .split(/\s+/)
      .map((w: string) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/home"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="truncate text-2xl font-bold tracking-tight">
          {isSelf ? "Your profile" : (profile.full_name ?? "Profile")}
        </h1>
      </div>

      <GlassCard radius="card" className="overflow-hidden p-6">
        <div className="flex items-center gap-4">
          <div className="glass flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt={profile.full_name ?? "Avatar"}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-xl font-bold text-fg">{initials}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-bold">
              {profile.full_name ?? "Student"}
            </h2>
            <p className="truncate text-fg-muted">
              {profile.department ?? "—"}
              {profile.semester ? ` · Semester ${profile.semester}` : ""}
            </p>
            <div className="mt-2">
              <GlassChip tone="aura">★ {profile.aura_score ?? 0} Aura</GlassChip>
            </div>
          </div>
        </div>

        {profile.bio && (
          <p className="mt-4 text-[15px] text-fg/90">{profile.bio}</p>
        )}

        <div className="mt-4 flex gap-2">
          {isSelf ? (
            <Link href="/profile/edit" className="flex-1">
              <div className="glass flex items-center justify-center gap-2 rounded-[var(--radius-pill)] py-2.5 text-sm font-medium">
                <Pencil className="h-4 w-4" aria-hidden />
                Edit profile
              </div>
            </Link>
          ) : matched ? (
            <OpenChatButton otherId={profile.id} />
          ) : null}
        </div>
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
    </main>
  );
}
