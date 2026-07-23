import { SwipeDeck } from "@/components/discover/swipe-deck";
import { DiscoverModeTabs } from "@/components/discover/discover-mode-tabs";
import { SmartMatchBoard } from "@/components/discover/smart-match-board";
import { createClient } from "@/lib/supabase/server";
import type { DiscoverProfile } from "@/lib/profile/types";
import {
  DEFAULT_DISCOVER_MODE,
  isDiscoverMode,
  isPostMode,
  type DiscoverMode,
  type PostMode,
} from "@/lib/smart-match/modes";
import { getDiscoverModeData } from "@/app/(student)/discover/smart-match-actions";

/**
 * Discover — a multi-mode surface. SOCIO (the founder's date/social swipe deck)
 * is the default and is UNCHANGED. The five focused modes (Project Partner, FYP
 * Teammate, Hackathon Team, Sports, Recruitment) render the post/opportunity
 * board where students browse requests and apply. Mode is a shareable ?mode=.
 */
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode: rawMode } = await searchParams;
  const mode: DiscoverMode = isDiscoverMode(rawMode) ? rawMode : DEFAULT_DISCOVER_MODE;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3">
      <header className="mb-3 flex items-center justify-center">
        <h1 className="text-lg font-bold tracking-tight">Discover</h1>
      </header>

      <DiscoverModeTabs current={mode}>
        {mode === "socio" ? <SocioDeck /> : <PostModeSection mode={mode as PostMode} />}
      </DiscoverModeTabs>
    </main>
  );
}

/** The original date/social deck — behavior unchanged (relabeled SOCIO). */
async function SocioDeck() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_discover_candidates", { p_limit: 20 });
  const candidates = (data as DiscoverProfile[]) ?? [];
  return <SwipeDeck initial={candidates} />;
}

/** A focused post mode: viewer facts + eligible open posts + my activity. */
async function PostModeSection({ mode }: { mode: PostMode }) {
  if (!isPostMode(mode)) return null;
  const data = await getDiscoverModeData(mode);
  if (!data) {
    return (
      <p className="rounded-[18px] bg-card px-5 py-8 text-center text-sm text-fg-muted">
        Sign in to use Smart Matching.
      </p>
    );
  }
  return <SmartMatchBoard mode={mode} data={data} />;
}
