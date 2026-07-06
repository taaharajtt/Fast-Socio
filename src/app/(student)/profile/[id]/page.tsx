import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Zap, Heart, Check } from "lucide-react";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { ProfileTabs, type GridPost, type ProfileCommunity } from "@/components/profile/profile-tabs";
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
    .select("id, full_name, department, semester, bio, avatar_url, aura_score")
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

  const [{ data: postRows }, { count: matchCount }, { data: commRows }] =
    await Promise.all([
      supabase
        .from("feed_posts")
        .select("id, body, image_url")
        .eq("author_id", id)
        .order("created_at", { ascending: false })
        .limit(18),
      supabase
        .from("matches")
        .select("id", { count: "exact", head: true })
        .or(`user_low.eq.${id},user_high.eq.${id}`),
      supabase
        .from("community_members")
        .select("community:communities(id, name, member_count, status)")
        .eq("user_id", id),
    ]);

  const posts = (postRows as GridPost[]) ?? [];
  const communities = ((commRows ?? [])
    .map((r) => r.community as unknown as (ProfileCommunity & { status: string }) | null)
    .filter((c): c is ProfileCommunity & { status: string } =>
      Boolean(c) && c!.status === "approved"
    )) as ProfileCommunity[];

  const initials =
    (profile.full_name ?? "")
      .trim()
      .split(/\s+/)
      .map((w: string) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="relative h-44">
        <div className="h-full w-full gradient-brand opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg to-transparent" />
        <Link
          href="/home"
          aria-label="Back"
          className="glass absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-white"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="absolute -bottom-10 left-5">
          <div className="h-20 w-20 overflow-hidden rounded-full border-[3px] border-bg">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt={profile.full_name ?? "Avatar"}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="glass flex h-full w-full items-center justify-center text-xl font-bold">
                {initials}
              </span>
            )}
          </div>
        </div>
      </div>

      <main className="px-5 pb-28">
        <div className="mb-4 mt-12 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight">
              {profile.full_name ?? "Student"}
            </h1>
            <p className="truncate text-sm text-fg-muted">
              {profile.department ?? "—"}
              {profile.semester ? ` · Semester ${profile.semester}` : ""}
            </p>
          </div>
          {isSelf ? (
            <Link
              href="/profile/edit"
              className="gradient-brand flex items-center gap-1.5 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-semibold text-white"
            >
              Edit
            </Link>
          ) : matched ? (
            <OpenChatButton otherId={profile.id} />
          ) : (
            <span className="glass flex items-center gap-1.5 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium text-fg-muted">
              <Check className="h-4 w-4" aria-hidden />
              Match to chat
            </span>
          )}
        </div>

        <div className="mb-5 flex gap-3">
          <div className="glass flex-1 rounded-[var(--radius-md)] p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Zap className="h-3.5 w-3.5 text-warning" aria-hidden />
              <p className="text-lg font-bold">{profile.aura_score ?? 0}</p>
            </div>
            <p className="text-[11px] text-fg-muted">Aura</p>
          </div>
          <div className="glass flex-1 rounded-[var(--radius-md)] p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Heart className="h-3.5 w-3.5 text-accent" aria-hidden />
              <p className="text-lg font-bold">{matchCount ?? 0}</p>
            </div>
            <p className="text-[11px] text-fg-muted">Matches</p>
          </div>
        </div>

        {profile.bio && (
          <p className="mb-5 text-[15px] leading-relaxed text-fg/90">
            {profile.bio}
          </p>
        )}

        <ProfileTabs posts={posts} communities={communities} />
      </main>
    </div>
  );
}
