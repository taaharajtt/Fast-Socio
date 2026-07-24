import { UnifiedDiscoverFeed } from "@/components/discover/unified-discover-feed";
import {
  getDiscoverFeedData,
  getSocioSwipeCandidates,
} from "@/app/(student)/discover/discover-actions";

/**
 * Discover — ONE unified campus connection feed.
 *
 * There are no mode tabs any more: project partners, FYP teammates, hackathon
 * teams, sports plans, recruitment calls, open contributors and SOCIO profile
 * cards all live in the same ranked list, narrowed by filter chips. SOCIO's
 * original swipe deck is preserved untouched at /discover/socio and reachable
 * from here via "Swipe".
 */
export default async function DiscoverPage() {
  const [data, socioCandidates] = await Promise.all([
    getDiscoverFeedData(),
    getSocioSwipeCandidates(12),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3">
      <header className="mb-3">
        <h1 className="text-lg font-bold tracking-tight">Discover</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Find people, teams, events, and opportunities on campus.
        </p>
      </header>

      {data ? (
        <UnifiedDiscoverFeed
          data={data}
          socioCandidates={socioCandidates}
          now={data.now}
        />
      ) : (
        <p className="rounded-[18px] bg-card px-5 py-8 text-center text-sm text-fg-muted">
          Sign in to use Discover.
        </p>
      )}
    </main>
  );
}
