import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SwipeDeck } from "@/components/discover/swipe-deck";
import { getSocioSwipeCandidates } from "@/app/(student)/discover/discover-actions";

/**
 * SOCIO Swipe — the founder's original date/social deck, preserved verbatim.
 * It is no longer Discover's primary surface (that's the unified feed), but it
 * is not gone: this is its own route, reachable from Discover's "Swipe" button
 * and from Post Intent → SOCIO intro. Same RPC, same swipe/match/chat flow.
 */
export default async function SocioSwipePage() {
  const candidates = await getSocioSwipeCandidates(20);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-3">
      <header className="mb-3 flex items-center gap-2">
        <Link
          href="/discover"
          aria-label="Back to Discover"
          className="glass flex h-9 w-9 items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <h1 className="text-lg font-bold tracking-tight">SOCIO Swipe</h1>
          <p className="text-xs text-fg-muted">Meet people on campus.</p>
        </div>
      </header>

      <SwipeDeck initial={candidates} />
    </main>
  );
}
