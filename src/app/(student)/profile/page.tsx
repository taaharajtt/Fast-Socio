import Link from "next/link";
import { Settings, Pencil, Zap, Heart, Check } from "lucide-react";
import { ProfileTabs, type ProfileCommunity } from "@/components/profile/profile-tabs";
import { createClient } from "@/lib/supabase/server";
import { AppImage } from "@/components/ui/app-image";
import type { FeedPost } from "@/lib/feed/types";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const [{ data: profile }, { data: postRows }, { count: matchCount }, { data: commRows }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, department, semester, bio, avatar_url, aura_score")
        .eq("id", me)
        .single(),
      supabase
        .from("feed_posts")
        .select("*")
        .eq("author_id", me)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("matches")
        .select("id", { count: "exact", head: true })
        .or(`user_low.eq.${me},user_high.eq.${me}`),
      supabase
        .from("community_members")
        .select("community:communities(id, name, member_count, status)")
        .eq("user_id", me),
    ]);

  const posts = (postRows as FeedPost[]) ?? [];
  const communities = ((commRows ?? [])
    .map((r) => r.community as unknown as (ProfileCommunity & { status: string }) | null)
    .filter((c): c is ProfileCommunity & { status: string } =>
      Boolean(c) && c!.status === "approved"
    )) as ProfileCommunity[];

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Cover banner (gradient — no cover image in schema) + overlapping avatar. */}
      <div className="relative h-44">
        <div className="h-full w-full gradient-brand opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg to-transparent" />
        <Link
          href="/settings"
          aria-label="Settings"
          className="glass absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-white"
        >
          <Settings className="h-4 w-4" aria-hidden />
        </Link>
        <div className="absolute -bottom-10 left-5">
          <div className="relative">
            <div className="relative h-20 w-20 overflow-hidden rounded-full border-[3px] border-bg">
              {profile?.avatar_url ? (
                <AppImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? "Avatar"}
                  sizes="80px"
                />
              ) : (
                <span className="glass block h-full w-full" />
              )}
            </div>
            <span className="gradient-brand absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg">
              <Check className="h-3 w-3 text-white" aria-hidden />
            </span>
          </div>
        </div>
      </div>

      <main className="px-5 pb-28">
        <div className="mb-4 mt-12 flex items-end justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight">
              {profile?.full_name ?? "—"}
            </h1>
            <p className="truncate text-sm text-fg-muted">
              {profile?.department ?? "—"}
              {profile?.semester ? ` · Semester ${profile.semester}` : ""}
            </p>
          </div>
          <Link
            href="/profile/edit"
            className="gradient-brand flex items-center gap-1.5 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-semibold text-white"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Edit
          </Link>
        </div>

        {/* Stats */}
        <div className="mb-5 flex gap-3">
          <Link href="/profile/aura" className="glass flex-1 rounded-[var(--radius-md)] p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Zap className="h-3.5 w-3.5 text-warning" aria-hidden />
              <p className="text-lg font-bold">{profile?.aura_score ?? 0}</p>
            </div>
            <p className="text-[11px] text-fg-muted">Aura</p>
          </Link>
          <div className="glass flex-1 rounded-[var(--radius-md)] p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Heart className="h-3.5 w-3.5 text-accent" aria-hidden />
              <p className="text-lg font-bold">{matchCount ?? 0}</p>
            </div>
            <p className="text-[11px] text-fg-muted">Matches</p>
          </div>
        </div>

        {profile?.bio && (
          <p className="mb-5 text-[15px] leading-relaxed text-fg/90">
            {profile.bio}
          </p>
        )}

        <ProfileTabs posts={posts} communities={communities} currentUserId={me} />
      </main>
    </div>
  );
}
