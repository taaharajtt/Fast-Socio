/**
 * The dock glyphs lucide cannot draw for us.
 *
 * Most active tabs are the lucide outline with `fill-current` applied, so the
 * solid and outline states are literally the same drawing. Three glyphs cannot
 * be done that way, and rather than accept worse icons they are hand-authored
 * HERE — on lucide's own 24x24 grid, from lucide's own path data, with lucide's
 * round caps and joins. Same family, same silhouette, same optical weight; only
 * the geometry we had to change is ours.
 *
 * House needs BOTH states redrawn, because the fix to one of them has to be
 * mirrored in the other — see `HouseOutline`.
 *
 * Optical size is the thing to be careful about here. A lucide outline icon
 * occupies its bounding box PLUS half a stroke in every direction, so a solid
 * version that only fills sits visibly smaller than the inactive icon beside
 * it and the dock twitches on every tab change. Trophy pays that back by
 * keeping a stroke in the fill colour; House cannot (the stroke seals its
 * doorway) and pays it back with an explicit scale instead. Both land on the
 * same optical box as the outline they replace.
 */

import { useId } from "react";

type GlyphProps = {
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
};

/**
 * Outline house with the doorway open at the floor.
 *
 * lucide's House draws the body and the door as two paths, and the body's
 * bottom edge is one unbroken `H5` that runs straight across the doorway. So
 * the outline house has a line under its door: the door reads as a closed
 * panel standing on the floor rather than as an opening. The solid state cuts
 * a real hole through that edge, which made the mismatch obvious the moment
 * you tapped between tabs — the doorway appeared to open.
 *
 * Redrawn here as ONE continuous stroke that treats the door as an inward
 * notch in the floor. It starts at the right jamb's foot, goes up and over the
 * head, down the left jamb, then continues left along the floor and all the
 * way around the house; the closing segment draws the floor's right-hand run
 * back to where it started. The gap between the jambs is simply never drawn.
 *
 * Every coordinate is lucide's: the body is its path re-entered from a
 * different point, and the door is its door verbatim. The jambs sit at x=9 and
 * x=15 on the centreline, so at 1.8 stroke the visible opening is x 9.9-14.1 —
 * which is exactly the hole `HouseSolid` punches, and why the two states line
 * up.
 */
export function HouseOutline({ className, style, strokeWidth = 1.8 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8H5a2 2 0 0 1-2-2V10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2Z" />
    </svg>
  );
}

/**
 * Solid house with the doorway cut out.
 *
 * lucide draws House as two separate paths — the body and the door — so
 * filling the SVG fills the door in the same colour as the wall behind it and
 * the doorway simply disappears. Here both subpaths live in ONE path with
 * `fillRule="evenodd"`, which is what turns the inner subpath into a hole
 * instead of a second filled shape.
 *
 * This one carries NO stroke, unlike TrophySolid, and the reason is the
 * doorway. A stroke rides the hole's edge as well as the outer silhouette, so
 * the door's foot and the body's bottom edge each grew half a stroke toward
 * each other and sealed the opening shut — the door came out as a slot
 * floating inside the wall instead of a doorway you could walk through.
 *
 * Losing the stroke costs half its width off every edge, which would leave the
 * house visibly smaller than the outline it replaces. The `scale(1.1)` about
 * the shape's own centre pays that back exactly: lucide's stroked House
 * occupies 19.8 x 20.33 units, the bare fill occupies 18 x 18.53, and 1.1 is
 * the ratio between them on both axes.
 *
 * The door is lucide's door measured at its INNER edge (x 9.9-14.1, y 12.9-21)
 * rather than its centreline, so the opening in the solid house is the same
 * size as the opening you see in the outline house — the two states differ in
 * weight, not in what the door looks like. Its foot sits on the body's bottom
 * edge, so the hole opens downward through the wall.
 */
export function HouseSolid({ className, style }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden
    >
      <g transform="translate(12 11.736) scale(1.1) translate(-12 -11.736)">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z
             M14.1 21v-7.2a1 1 0 0 0-1-1h-2.2a1 1 0 0 0-1 1V21z"
        />
      </g>
    </svg>
  );
}

/**
 * Solid trophy — cup AND stand.
 *
 * lucide's Trophy is six paths, and only the cup is a closed shape. The two
 * stem legs, the two handles and the base rule are all OPEN curves, and an
 * open path fills by closing itself implicitly — which is why filling the
 * whole icon produced a mushroom.
 *
 * The stand is rebuilt as one closed shape by walking DOWN lucide's left leg,
 * across the foot, and back UP the right leg with its arc sweeps reversed:
 *
 *   down    M10 14.66 v1.626  a2 2 …  A5 5 … 7 21.978     (lucide path 1, as-is)
 *   across  H17
 *   up      A5 5 … 14.976 17.982  a2 2 …  V14.66  Z       (lucide path 2, reversed)
 *
 * Reversing an elliptical arc means swapping its endpoints and flipping the
 * sweep flag, which is why the return leg reads `0 0 0` / `0 0 1` against the
 * outgoing `0 0 0` / `0 0 1`. The result traces exactly the silhouette the
 * outline draws and fills the goblet between the legs, so the flare at the
 * foot is lucide's flare rather than something redrawn by eye.
 *
 * The stem's head (y=14.66) tucks under the cup's lowest point (y=15), so the
 * two filled shapes merge into one form with no seam.
 *
 * The handles stay open stroked arcs on purpose — they are rings in the
 * original, and a filled ring needs an inner contour the outline simply does
 * not contain. The base stays a stroked rule, which at this weight already
 * reads as the solid bar it is meant to be.
 */
export function TrophySolid({ className, style, strokeWidth = 1.8 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      {/* Handles — lucide's arcs, untouched. */}
      <path d="M18 9h1.5a1 1 0 0 0 0-5H18" />
      <path d="M6 9H4.5a1 1 0 0 1 0-5H6" />
      {/* Cup — lucide's one closed path, filled. */}
      <path fill="currentColor" d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />
      {/* Stand — lucide's two legs, closed into a single solid stem. */}
      <path
        fill="currentColor"
        d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978H17A5 5 0 0 0 14.976 17.982a2 2 0 0 1-.976-1.696V14.66Z"
      />
      {/* Base. */}
      <path d="M4 22h16" />
    </svg>
  );
}

/**
 * The paper plane, drawn twice — outline and solid — with the corners rounded.
 *
 * lucide's Send is the right silhouette but the wrong finish: its three corners
 * carry a 0.5-unit radius, which at 22px is a hairline and reads as three sharp
 * points, the tip especially. The reference plane is visibly soft — the corners
 * are arcs you can see, not chamfers.
 *
 * So the shape is rebuilt on lucide's own geometry with a bigger radius. The
 * three corner VERTICES are recovered from Send's path by extending each pair
 * of straight edges to where they actually meet — (22.3, 1.7) at the tip,
 * (1.08, 8.96) at the left, (15.04, 22.94) at the bottom — and the edges are
 * then re-cornered at r=2 instead of r=0.5. Same three vertices, same four
 * edges, same proportions: only the corner treatment changes. The concave notch
 * where the wings meet is already r=2 in lucide and is kept verbatim, so the
 * one curve the eye reads as "folded paper" is untouched.
 *
 * r=2 is the practical ceiling here, not a taste call. A corner arc's chord
 * cannot exceed 2r, and at r=2 the two tightest corners already run 3.71 and
 * 3.75 against a 4.0 limit — anything larger and the arcs stop fitting between
 * the vertices and the path degenerates.
 *
 * `PLANE` is shared by both states, which is the whole point of authoring them
 * together: the silhouette cannot drift between outline and solid, because
 * there is only one silhouette.
 */
const PLANE =
  "M18.442 3.018 L6.122 7.237 A2 2 0 0 0 6.026 10.948 L10.244 12.643 " +
  "A2 2 0 0 1 11.356 13.755 L13.032 17.937 A2 2 0 0 0 16.78 17.84 " +
  "L20.982 5.558 A2 2 0 0 0 18.442 3.018 Z";

/**
 * The fold, running from just inside the blunted tip down INTO the notch.
 *
 * lucide's fold starts at the old sharp tip (21.85, 2.15). With the tip now
 * rounded away, a line starting there would begin outside the paper, so it is
 * pulled back along the same diagonal to where the body actually is.
 *
 * The far end lands on the notch's own vertex (11.04, 12.96) rather than
 * stopping short of it. Ending early left a visible gap between the fold and
 * the V where the wings meet, and the plane read as an outline with a stray
 * diagonal floating inside it instead of a sheet folded down its middle.
 */
const PLANE_FOLD = "M20.04 3.96 11.04 12.96";

/** Outlined paper plane — the inactive Chat tab. */
export function PaperPlaneOutline({ className, style, strokeWidth = 1.8 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d={PLANE} />
      <path d={PLANE_FOLD} />
    </svg>
  );
}

/**
 * Solid paper plane, with the fold cut back OUT of it.
 *
 * Filling the outline the way Chat's old MessageCircle was filled does not
 * work here. The body fills correctly, but the fold is an open LINE: it has no
 * area, so it fills to nothing, and its stroke is then the same white as the
 * body it lies on. The result was a blank white triangle — the plane loses the
 * one line that makes it read as a plane rather than an arrowhead.
 *
 * So the fold is subtracted instead of drawn. The body is filled, and a mask
 * knocks the fold's stroke back out of it, leaving a transparent slot that the
 * dock's own background shows through — which is exactly the dark diagonal in
 * the reference. Because the cut is transparency rather than a painted colour,
 * it needs no knowledge of what is behind the dock and stays correct if that
 * surface ever changes.
 *
 * The outer path keeps a stroke in the fill colour, the way TrophySolid does:
 * a bare fill occupies the bounding box while the inactive outline occupies
 * that box plus half a stroke, and without the payback the plane would sit
 * visibly smaller than the five icons beside it.
 *
 * `useId` gives the mask a document-unique name. The dock renders once, but
 * the id is generated rather than hardcoded so a second instance (the layout's
 * Suspense fallback dock renders alongside the real one for a frame) cannot
 * collide — two elements sharing a mask id is a silent, render-order-dependent
 * bug, and SVG ids are global to the document, not scoped to the SVG.
 */
export function PaperPlaneSolid({ className, style, strokeWidth = 1.5 }: GlyphProps) {
  const maskId = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        {/* White keeps, black cuts. */}
        <rect width="24" height="24" fill="white" />
        <path
          d={PLANE_FOLD}
          stroke="black"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      </mask>
      <path
        mask={`url(#${maskId})`}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        d={PLANE}
      />
    </svg>
  );
}
