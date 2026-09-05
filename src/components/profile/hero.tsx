import Link from "next/link";
import { Heart } from "lucide-react";
import { AuraIcon } from "@/components/ui/aura-icon";
import { cn } from "@/lib/utils";

/**
 * The pieces the two profile screens — your own (/profile) and someone else's
 * (/profile/[id]) — draw identically.
 *
 * They were copy-pasted between the two routes and had already drifted (the
 * public page kept a boxed stat pair after the owner page moved on, and only
 * one of them showed a verified tick). Sharing them is the only way the two
 * screens stay the same screen (apple.md §16 — consistency).
 */

/**
 * Shown when an account has no cover photo.
 *
 * This started as a full-bleed brand gradient — a 200px slab of saturated
 * purple above every un-customised profile — then became a fainter purple wash.
 * It is now a neutral tonal field. The banner's job is to give the avatar
 * something to sit against and to signal "no cover photo yet"; a brand colour
 * up here competed with the name directly below it for the role of the
 * screen's anchor, on the one screen that should unambiguously be about a
 * person. Where a real cover photo exists, that photo supplies the colour —
 * which is the whole idea.
 */
export function CoverFallback() {
  return (
    <div
      className="h-full w-full"
      style={{
        backgroundImage:
          "linear-gradient(180deg, var(--surface-active) 0%, var(--card) 55%, var(--bg) 100%)",
      }}
    />
  );
}

/**
 * The verified check on the avatar's bottom-right corner.
 *
 * It used to render as a loose 20px disc above the name, anchored to nothing,
 * which read as an unexplained bullet point. On the corner of the face it is
 * obvious what is being certified (apple.md §16 — proximity implies
 * relationship). Must be a SIBLING of the clipped avatar circle, never a child,
 * or `overflow-hidden` cuts it off.
 *
 * Blue, not purple: verification is a trust signal, and blue is already what
 * this app means by verified everywhere else (see `VerifiedBadge`). Two
 * different colours for one concept was the drift; purple was the wrong half.
 */
export function ProfileVerifiedTick() {
  return (
    <span
      aria-label="Verified"
      className="absolute bottom-0.5 right-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-bg bg-verified text-white"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden>
        <path
          d="M5 13l4 4L19 7"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * Aura and Matches, side by side.
 *
 * Two boxed cards for two numbers was three surfaces doing one job. The numbers
 * ARE the content, so they lose the boxes, gain ~50% in size, and are separated
 * by a hairline instead of a gap between two fills.
 *
 * `auraHref` makes the Aura half a link on your own profile (where it opens the
 * breakdown) and inert on someone else's. `matchesHref` does the same for the
 * Matches half — the whole half, heart and number and label, because a stat
 * that leads somewhere should be tappable everywhere it looks tappable.
 * `showAura` honours the viewer's privacy setting; when it is off, Matches
 * takes the full width and the divider is dropped rather than left dangling.
 *
 * Neither href is a permission. The pages behind them re-derive the caller's
 * right to the data (`get_matches_of` fails closed), so an absent link is the
 * affordance being withheld, not the authorisation.
 */
export function ProfileStats({
  aura,
  matches,
  auraHref,
  matchesHref,
  showAura = true,
  className,
}: {
  aura: number;
  matches: number;
  auraHref?: string;
  /** Present only when this viewer may open this profile's matches list. */
  matchesHref?: string;
  showAura?: boolean;
  className?: string;
}) {
  const auraBody = (
    <>
      <span className="flex items-center gap-2">
        <AuraIcon className="h-6 w-6" />
        <span className="text-[30px] font-bold leading-none">{aura}</span>
      </span>
      <span className="type-callout mt-2 text-fg-muted">Aura</span>
    </>
  );

  const matchesBody = (
    <>
      <span className="flex items-center gap-2">
        <Heart className="h-6 w-6 fill-error text-error" aria-hidden />
        <span className="text-[30px] font-bold leading-none">{matches}</span>
      </span>
      <span className="type-callout mt-2 text-fg-muted">Matches</span>
    </>
  );

  return (
    <div className={cn("flex items-stretch", className)}>
      {showAura ? (
        auraHref ? (
          <Link
            href={auraHref}
            className="pressable-subtle focus-ring flex flex-1 flex-col items-center justify-center rounded-xl py-1"
          >
            {auraBody}
          </Link>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center py-1">
            {auraBody}
          </div>
        )
      ) : null}
      {showAura ? (
        <div aria-hidden className="my-1 w-px shrink-0 bg-hairline" />
      ) : null}
      {matchesHref ? (
        <Link
          href={matchesHref}
          aria-label={`Matches: ${matches}`}
          className="pressable-subtle focus-ring flex flex-1 flex-col items-center justify-center rounded-xl py-1"
        >
          {matchesBody}
        </Link>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center py-1">
          {matchesBody}
        </div>
      )}
    </div>
  );
}
