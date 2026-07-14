import Link from "next/link";
import Image from "next/image";
import type { EarnedBadge } from "@/lib/badges";

/**
 * Earned-badges row on the profile header. Sits in the band to the right of the
 * overlapping avatar (below the cover, above the name) and doubles as the
 * spacer that clears the avatar overhang, so it always renders — empty or not.
 * Wraps onto extra lines on narrow screens instead of overflowing.
 */
export function BadgeStrip({
  badges,
  href,
}: {
  badges: EarnedBadge[];
  /** When set (own profile), the strip links to the badges screen. */
  href?: string;
}) {
  const row = (
    <div className="ml-[96px] flex min-h-10 flex-wrap items-center gap-1.5 pt-2">
      {badges.map((b) =>
        b.image_url ? (
          <Image
            key={b.code}
            src={b.image_url}
            alt={b.title}
            title={b.title}
            width={64}
            height={64}
            className="h-8 w-8 drop-shadow-md"
          />
        ) : (
          <span key={b.code} title={b.title} className="text-xl" aria-hidden>
            🏅
          </span>
        )
      )}
    </div>
  );

  if (!href || badges.length === 0) return row;
  return (
    <Link href={href} aria-label="Your badges" className="block">
      {row}
    </Link>
  );
}
