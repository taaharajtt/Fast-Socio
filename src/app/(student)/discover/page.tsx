import Link from "next/link";
import { SwipeDeck } from "@/components/discover/swipe-deck";
import { AppImage } from "@/components/ui/app-image";
import { createClient } from "@/lib/supabase/server";
import type { DiscoverProfile } from "@/lib/profile/types";

export default async function DiscoverPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data }, { data: me }] = await Promise.all([
    supabase.rpc("get_discover_candidates", { p_limit: 20 }),
    supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user!.id)
      .single(),
  ]);
  const candidates = (data as DiscoverProfile[]) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-4">
      {/* Top bar (Figma): own avatar · centered title · spacer for symmetry. */}
      <header className="mb-3 flex items-center justify-between">
        <Link
          href="/profile"
          aria-label="Your profile"
          className="relative h-9 w-9 overflow-hidden rounded-full border-2 border-accent/50"
        >
          {me?.avatar_url ? (
            <AppImage src={me.avatar_url} alt="" sizes="36px" />
          ) : (
            <span className="glass block h-full w-full" />
          )}
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight">Discover</h1>
        <span className="h-9 w-9" aria-hidden />
      </header>
      <SwipeDeck initial={candidates} />
    </main>
  );
}
