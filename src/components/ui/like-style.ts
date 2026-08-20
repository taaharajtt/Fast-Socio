import { cn } from "@/lib/utils";

/**
 * The one definition of what "liked" looks like.
 *
 * Liked is a FILLED RED heart, unliked is a grey outline — the universal
 * convention (Instagram, Twitter/X, most of the web), and what this app used
 * before the neutral-chrome pass briefly moved it to purple. The count
 * travels with the icon so the pair reads as one control rather than a glyph
 * beside an unrelated number.
 *
 * Matches on the profile is also red, and that is fine: both are "someone
 * cared about this," just at different scales (a tap vs. a mutual match), so
 * sharing the hue is consistent rather than confusing.
 */

/** Colour for the like control as a whole (icon + count). */
export function likeToneClass(liked: boolean, idle = "hover:text-fg") {
  return liked ? "text-error" : idle;
}

/** Applied to the heart glyph itself; fills it when liked. */
export function likeGlyphClass(liked: boolean, size = "h-5 w-5") {
  return cn(size, liked && "fill-current");
}
