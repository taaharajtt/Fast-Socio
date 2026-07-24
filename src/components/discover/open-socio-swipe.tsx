import Link from "next/link";
import { Heart } from "lucide-react";

/**
 * Secondary entry to the founder's original SOCIO swipe deck. Discover's
 * primary surface is now the unified feed, but SOCIO is not demoted out of
 * existence — one tap here opens the full deck, unchanged.
 */
export function OpenSocioSwipe({ className }: { className?: string }) {
  return (
    <Link
      href="/discover/socio"
      className={`glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold ${className ?? ""}`}
    >
      <Heart className="h-4 w-4 text-accent" aria-hidden />
      Swipe
      <span className="sr-only"> — open SOCIO swipe</span>
    </Link>
  );
}
