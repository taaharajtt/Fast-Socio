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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Discover</h1>
        <p className="text-sm text-fg-muted">
          Swipe, or use ← pass · → like · M message
        </p>
      </header>
      <SwipeDeck initial={candidates} />
    </main>
  );
}
