import { cn } from "@/lib/utils";

/**
 * The one definition of what "liked" looks like.
 *
 * Post likes and comment likes had independently landed on a red heart, which
 * collided with the two other things red means in this app: destructive actions
 * (delete, report) and the Matches counter on the profile. A like is neither —
 * it is the most ordinary positive interaction in the product, and it is where
 * FAST SOCIO's own colour belongs.
 *
 * Liked is a FILLED PURPLE heart, unliked is a grey outline. The count travels
 * with the icon so the pair reads as one control rather than a glyph beside an
 * unrelated number.
 *
 * Matches on the profile keeps its red heart on purpose — that is a separate
 * product concept (mutual interest), not an accumulation of taps, and giving it
 * the like colour would imply the two numbers are the same kind of thing.
 */

/** Colour for the like control as a whole (icon + count). */
export function likeToneClass(liked: boolean, idle = "hover:text-fg") {
  return liked ? "text-accent" : idle;
}

/** Applied to the heart glyph itself; fills it when liked. */
export function likeGlyphClass(liked: boolean, size = "h-5 w-5") {
  return cn(size, liked && "fill-current");
}
