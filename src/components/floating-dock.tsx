"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, activeNavHref } from "@/lib/nav";
import { AppImage } from "@/components/ui/app-image";
import {
  HouseOutline,
  HouseSolid,
  PaperPlaneOutline,
  PaperPlaneSolid,
  TrophySolid,
} from "@/components/dock-glyphs";
import { useChatBadge } from "@/lib/chat/badge-store";
import { useCommunityBadge } from "@/lib/community/badge-store";
import { markDockTap, reportDockNavigation } from "@/lib/nav-perf";
import { cn } from "@/lib/utils";

/**
 * How each dock glyph becomes solid when its tab is active.
 *
 * lucide is an outline-only family — there is no `HouseSolid` to import — so
 * the solid state is produced from the SAME icon by filling its paths, which
 * keeps the silhouette identical between states instead of swapping in a
 * second, subtly different drawing from another icon set.
 *
 * There are three ways a tab goes solid, and which one an icon gets depends on
 * how lucide happens to have drawn it. All three were settled by rendering the
 * result, not by reading path data.
 *
 *   `fill`   Users is a single closed silhouette, so plain `fill-current` on
 *            the whole SVG is exactly right.
 *
 *            Compass is the same trick with a child selector: filling
 *            everything turns it into a white DISC, which is not a compass, so
 *            `circle` stays a stroked ring and only the needle `path` fills.
 *            The active state reads as "the needle lit up".
 *
 *   `solid`  House, Trophy and Send cannot be filled at all. House draws its
 *            door as a SEPARATE path from its body, so filling the SVG paints
 *            the door the same colour as the wall behind it and the doorway
 *            vanishes. Trophy is six paths of which only the cup is closed —
 *            the handles, the two stem legs and the base rule are all open
 *            curves, and an open path fills by closing itself implicitly,
 *            which turned the whole glyph into a mushroom. Send's fold is an
 *            open LINE, which has no area to fill and whose stroke then
 *            matches the body it lies on, so the filled plane came out as a
 *            featureless white triangle.
 *
 *            All three are hand-authored in `dock-glyphs.tsx` instead: same
 *            24x24 grid, same lucide path data, same caps and joins — the
 *            doorway becomes an evenodd hole, the stand becomes one closed
 *            shape walked down lucide's left leg and back up its right, and
 *            the plane's fold becomes a mask that cuts the line back out of
 *            the fill. The inactive state still uses the real lucide icon, so
 *            the silhouettes match.
 *
 * Sizes and stroke weights are per-icon on purpose. A solid shape carries far
 * more ink than its outline at the same bounding box, so the filled glyphs sit
 * a pixel under the 22px the outlines use and take a THINNER stroke — the
 * stroke rides the path centre, so leaving it at 1.8 grows a solid shape by
 * most of a pixel in every direction. The active tab has to read as STRONGER,
 * not BIGGER. Users is the widest silhouette of the six and comes down
 * furthest.
 */
type Glyph = React.ComponentType<{
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
}>;

const ACTIVE_GLYPH: Record<
  string,
  {
    /** Class that fills the lucide icon in place. */
    fill?: string;
    /** Hand-authored solid, used instead of the lucide icon when active. */
    solid?: Glyph;
    /** Hand-authored outline, used instead of the lucide icon when INACTIVE. */
    outline?: Glyph;
    size: number;
    /**
     * Box for the INACTIVE glyph, where 22 is not right for it. Only the
     * paper plane needs this: its silhouette is a triangle, so it covers
     * barely half of the box it is given, and at the shared 22 it read a
     * couple of pixels smaller than the five glyphs around it even though
     * the boxes matched. Both of its states take 24 so the correction is
     * the same on each side of a tab switch.
     */
    outlineSize?: number;
    stroke: number;
  }
> = {
  // Home is the one tab that overrides BOTH states. lucide's House runs its
  // floor straight across the doorway, so the outline version has a line under
  // the door while the solid version has a hole — tapping the tab looked like
  // the door swinging open. Both are drawn here instead, from the same
  // coordinates, so the doorway is the same doorway in both states.
  "/home": { solid: HouseSolid, outline: HouseOutline, size: 21, stroke: 1.5 },
  "/discover": { fill: "[&>path]:fill-current", size: 22, stroke: 2 },
  "/leaderboard": { solid: TrophySolid, size: 21, stroke: 1.8 },
  "/communities": { fill: "fill-current", size: 20, stroke: 1.5 },
  "/chat": {
    solid: PaperPlaneSolid,
    outline: PaperPlaneOutline,
    size: 24,
    outlineSize: 24,
    stroke: 1.5,
  },
};

/**
 * Bottom navigation bar. A translucent blurred material pinned to the screen
 * edge that content scrolls *under*, with a 1px top hairline, 52px of visible
 * height plus the safe-area inset, and six equal ICON-ONLY tabs (Home ·
 * Discover · Ranks · Community · Chat · Me). Under
 * `prefers-reduced-transparency` the material resolves to a solid bar
 * (handled in globals.css, not here).
 *
 * There are no text labels. Each destination names itself to assistive tech
 * through the link's `aria-label` (the former visible label, plus the unread
 * count when there is one) while the glyph itself is `aria-hidden` — so the
 * accessible name survives the labels being removed, and nothing is announced
 * twice. Height came down from 56px to 52px when the label row went away, so
 * the single glyph sits optically centred rather than floating over a gap.
 *
 * Selection is expressed as OUTLINE → SOLID, not as colour: an inactive tab is
 * a thin grey outline glyph, an active tab is the same glyph filled white.
 * Nothing sits behind the active tab — no capsule, no tile, no underline, no
 * glow. The glyph IS the whole selected state, which is why the outline/solid
 * pair below matters more now that no label backs it up.
 *
 * That is also why it works without colour at all: desaturate the bar and the
 * active tab is still obvious, because the silhouette changed, not the hue.
 * Two channels carry the state (shape + contrast), which is what keeps it
 * legible for colour-blind users too.
 *
 * Purple survives here in exactly two places, both of them signals rather than
 * decoration: the unread count badge, and the ring on your own avatar when the
 * Me tab is active.
 *
 * z-40 keeps it below the modal layer (z-50) so sheets cover it. Hidden on the
 * immersive conversation screen (/chat/<id>) so the composer is unobstructed.
 */
export function FloatingDock({
  badges = {},
  avatarUrl,
  viewerId,
  hiddenHrefs = [],
}: {
  /** Unread counts keyed by nav href (e.g. { "/chat": 3 }). */
  badges?: Record<string, number>;
  /** Viewer's avatar — rendered as the "Me" (/profile) tab icon (UAT-005). */
  avatarUrl?: string | null;
  /** Distinguishes your own /profile/<id> from another student's (UAT-011). */
  viewerId?: string;
  /** Nav hrefs to omit when their feature flag is off (Refactor Phase 1). */
  hiddenHrefs?: string[];
}) {
  const pathname = usePathname();
  // The chat count is the one badge that changes while you sit on a screen, so
  // it comes from the realtime store (seeded by, and falling back to, the
  // server-rendered value) rather than waiting for the next navigation.
  const chatBadge = useChatBadge(badges["/chat"] ?? 0);
  // Same treatment for Community (mig 0183): its realtime island publishes an
  // authoritative recount here, so the number moves as updates arrive and as
  // they are read, without a router.refresh() of the whole tree.
  const communityBadge = useCommunityBadge(badges["/communities"] ?? 0);

  // Optimistic active tab. A tab switch still has to reach the server for the
  // new segment, and until it commits `pathname` is the OLD route — so without
  // this the selected state sat on the tab you just left for the whole round
  // trip and the dock read as unresponsive. Tapping moves the highlight on the
  // same frame as the press; the real pathname takes over the moment it lands.
  // Stored WITH the pathname it was tapped from, so it can be cleared during
  // render the moment the route actually changes — no effect, no extra commit.
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(
    null
  );
  if (tapped && tapped.from !== pathname) setTapped(null);

  // Dev-only: time from tapping a tab to the new route being committed. Paired
  // with the server-side [perf] phase logs, this is the number this whole
  // exercise is about. Logs a route path and a duration, nothing else.
  useEffect(() => {
    reportDockNavigation(pathname);
  }, [pathname]);

  // Feature-flagged destinations are dropped from the dock entirely so a
  // disabled feature is neither shown nor reachable via the primary nav.
  const items = NAV_ITEMS.filter((n) => !hiddenHrefs.includes(n.href));

  // Immersive conversation screens hide the dock so the composer is
  // unobstructed — 1:1 threads (/chat/<convId>) and community rooms
  // (/chat/c/<communityId>), which are the same screen with a different subject.
  if (/^\/chat\/.+/.test(pathname)) return null;

  const activeHref =
    (tapped?.from === pathname ? tapped.href : null) ??
    activeNavHref(pathname, viewerId);

  return (
    <nav
      aria-label="Primary"
      // Opaque, not a translucent material: content scrolling underneath a
      // blurred dock read as visual noise behind the tab bar, so this is a
      // flat `--chrome-solid` fill instead of `material-bar`. Other chrome
      // (the profile header button, glass-chip) still uses the translucent
      // material — this is scoped to the dock only.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-chrome-border bg-[var(--chrome-solid)] pb-[var(--safe-bottom)]"
    >
      {/* No scroll-edge fade above the bar: that gradient existed to soften
          content showing through a translucent material, and reads as a
          smudge above a bar that's now fully opaque. The border-t hairline
          is the whole edge. */}
      <div className="mx-auto flex h-[var(--dock-h)] max-w-md items-stretch">
        {items.map(({ href, label, icon: Icon }) => {
          const active = activeHref === href;
          const badge =
            href === "/chat"
              ? chatBadge
              : href === "/communities"
                ? communityBadge
                : (badges[href] ?? 0);
          return (
            <Link
              key={href}
              href={href}
              data-tour={`nav:${href}`}
              onClick={() => {
                setTapped({ href, from: pathname });
                markDockTap(href);
              }}
              aria-label={badge ? `${label}, ${badge} unread` : label}
              aria-current={active ? "page" : undefined}
              // `min-w-0` is what actually makes the six tabs equal. `flex-1`
              // alone honours each item's automatic minimum size, which is now
              // the glyph box rather than a word — but the release is kept so
              // the six stay exactly 1/6 each at every width, including the
              // 320px floor (53.3px per tab, comfortably over the 44px touch
              // minimum in both axes: the tab is the full 52px dock row tall).
              className="pressable focus-ring flex min-w-0 flex-1 items-center justify-center rounded-xl"
            >
              {/* A 28px glyph box, not the old 44px one. The tap target comes
                  from this Link (full dock height x one sixth of the width),
                  so the box only has to be as wide as the glyph — and once it
                  is, the unread badge hangs off the ICON's corner instead of
                  floating 10px away from it in dead space. */}
              <span className="relative flex h-7 w-7 items-center justify-center">
                {/* UAT-005: the "Me" tab shows the user's dp instead of a
                    generic person icon. Falls back to the icon if no avatar. */}
                {href === "/profile" && avatarUrl ? (
                  // The avatar is the icon, so there is no outline-to-solid
                  // move available here; the active signal is a thin purple
                  // ring instead — one of the two purples left in the dock.
                  // The ring is drawn on a 26px box around a 22px photo, so
                  // there is 2px of air between the two and the photo itself
                  // never changes size between states (a resizing avatar
                  // would make every tab switch jiggle).
                  <span
                    className={cn(
                      "flex h-[26px] w-[26px] items-center justify-center rounded-full transition-shadow duration-150",
                      active ? "ring-[1.5px] ring-accent" : "ring-0"
                    )}
                  >
                    <span
                      className={cn(
                        "relative block h-[22px] w-[22px] overflow-hidden rounded-full",
                        // A hairline edge on the inactive avatar, so a dark
                        // profile photo does not dissolve into a dark bar.
                        !active && "ring-1 ring-white/10"
                      )}
                    >
                      <AppImage src={avatarUrl} alt="" sizes="22px" />
                    </span>
                  </span>
                ) : (
                  (() => {
                    const g = ACTIVE_GLYPH[href];
                    // A hand-authored glyph is used only where lucide's own
                    // icon cannot express the state; everything without an
                    // override falls through to the real lucide icon, so the
                    // two states stay the same drawing.
                    const Shape = (active ? g?.solid : g?.outline) || Icon;
                    const size = active
                      ? (g?.size ?? 22)
                      : (g?.outlineSize ?? 22);
                    return (
                      <Shape
                        className={cn(
                          "transition-colors duration-150",
                          active ? cn("text-fg", g?.fill) : "text-fg-muted"
                        )}
                        style={{ width: size, height: size }}
                        strokeWidth={active ? (g?.stroke ?? 1.5) : 1.8}
                        aria-hidden
                      />
                    );
                  })()
                )}
                {badge > 0 && (
                  // The badge hangs off the corner of the ICON box, and which
                  // corner depends on where the glyph actually has ink. Five
                  // of the six are roughly symmetric and take the top-right.
                  // The paper plane does not: its tip reaches into the very
                  // top-right of the 24x24 grid (21.9, 2.1) while its top-LEFT
                  // is empty, so a top-right badge landed on the tip and a
                  // two-glyph count ("9+") buried it. Chat flips to the left,
                  // where even the widest badge clears the silhouette.
                  <span
                    className={cn(
                      "absolute -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white",
                      href === "/chat" ? "-left-1.5" : "-right-1.5"
                    )}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
