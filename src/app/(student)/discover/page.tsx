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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3">
      {/* Header (UISpec V3 Screen 5): 32px own avatar · centered "Discover". */}
      <header className="mb-3 flex items-center justify-between">
        <Link
          href="/profile"
          aria-label="Your profile"
          className="relative h-8 w-8 overflow-hidden rounded-full bg-card"
        >
          {me?.avatar_url ? (
            <AppImage src={me.avatar_url} alt="" sizes="32px" />
          ) : (
            <span className="block h-full w-full" />
          )}
        </Link>
        <h1 className="text-lg font-bold tracking-tight">Discover</h1>
        <span className="h-8 w-8" aria-hidden />
      </header>
      <SwipeDeck initial={candidates} />
    </main>
  );
}
