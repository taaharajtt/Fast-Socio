import { SwipeDeck } from "@/components/discover/swipe-deck";
import { createClient } from "@/lib/supabase/server";
import type { DiscoverProfile } from "@/lib/profile/types";

export default async function DiscoverPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_discover_candidates", {
    p_limit: 20,
  });
  const candidates = (data as DiscoverProfile[]) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3">
      {/* Header (UISpec V3 Screen 5): centered "Discover" title. */}
      <header className="mb-3 flex items-center justify-center">
        <h1 className="text-lg font-bold tracking-tight">Discover</h1>
      </header>
      <SwipeDeck initial={candidates} />
    </main>
  );
}
