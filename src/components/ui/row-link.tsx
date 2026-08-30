"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

type RowLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

/**
 * A link for a row in a LIST, which prefetches only once the reader shows
 * intent (hover, touch, or keyboard focus) rather than the moment it scrolls
 * into view.
 *
 * Why (perf audit Phase 3): `<Link>` prefetches every link in the viewport by
 * default. That is exactly right for the dock — seven fixed destinations, all
 * of them likely — and exactly wrong for a list, where a screenful of
 * notifications or leaderboard rows fires a dozen RSC requests for pages nobody
 * asked for. RSC/navigation traffic was 50.7% of all requests over 24h, and
 * this is the half of it that nothing was waiting on.
 *
 * `prefetch={null}` (not `undefined`, not `true`) is what restores Next's
 * DEFAULT behaviour once warm — for a dynamic route that means a partial
 * prefetch to the nearest `loading.tsx`, which is what every one of these rows
 * navigates to. `true` would ask for the full route and data, which is more
 * than the default and more than we want.
 *
 * ON MOBILE, honestly: there is no hover, so `onTouchStart` is the trigger and
 * it fires only tens of milliseconds before the tap completes. The prefetch
 * will usually not have landed by the time the navigation starts, so in
 * practice this behaves close to `prefetch={false}` on a phone — which is
 * already the shipped behaviour for the app's busiest lists (the chat inbox,
 * feed post cards, help cards all pass `prefetch={false}` explicitly). Those
 * routes all have a `loading.tsx`, so a tap paints a skeleton immediately
 * rather than hanging. The real win here is removing the viewport-triggered
 * storm; the hover path is a bonus that pays off on the admin console and on
 * desktop, and it is strictly never worse than `prefetch={false}`.
 *
 * NOT for primary navigation. The dock, `PageHeader`'s back button, `RouteTabs`
 * and the admin sidebar are a small, fixed set of highly-likely destinations
 * and must keep prefetching on sight — that is what makes a tab switch feel
 * instant, and Phase 3 deliberately does not touch them.
 */
export function RowLink({
  onMouseEnter,
  onTouchStart,
  onFocus,
  ...rest
}: RowLinkProps) {
  const [warm, setWarm] = useState(false);
  // React bails out of a re-render when the state is unchanged, so the repeated
  // calls a hover produces are free; the guard is for readers, not the runtime.
  const warmUp = () => {
    if (!warm) setWarm(true);
  };

  return (
    <Link
      {...rest}
      prefetch={warm ? null : false}
      // Each handler still forwards to whatever the call site passed, so this
      // stays a drop-in replacement for <Link> on rows that already had their
      // own pointer handling (e.g. the Discover card's drag guard).
      onMouseEnter={(e) => {
        warmUp();
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        warmUp();
        onTouchStart?.(e);
      }}
      // Keyboard users get the same treatment as a hover: tabbing onto a row is
      // intent. Without this, keyboard navigation would be the only input mode
      // that never prefetched at all.
      onFocus={(e) => {
        warmUp();
        onFocus?.(e);
      }}
    />
  );
}
