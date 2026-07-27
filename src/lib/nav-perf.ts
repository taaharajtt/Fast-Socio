"use client";

/**
 * Dev-only measurement of a dock tab switch: tap → route committed.
 *
 * Both functions compile to nothing in production (`process.env.NODE_ENV` is
 * inlined, so the branch folds and the module state is unreachable). Only a
 * route path and a duration are ever recorded — no ids, no tokens, no URLs
 * beyond the app-internal route.
 */
const enabled = process.env.NODE_ENV === "development";

let pending: { href: string; at: number } | null = null;

/** Called from the dock's onClick, before navigation starts. */
export function markDockTap(href: string) {
  if (!enabled) return;
  pending = { href, at: performance.now() };
  performance.mark(`dock-tap:${href}`);
}

/** Called once the router has committed a new pathname. */
export function reportDockNavigation(pathname: string) {
  if (!enabled || !pending) return;
  const { href, at } = pending;
  // Only report the tap we are actually the landing of.
  if (pathname !== href && !pathname.startsWith(`${href}/`)) return;
  pending = null;
  const ms = Math.round(performance.now() - at);
  performance.measure(`dock-nav:${href}`, `dock-tap:${href}`);
  // eslint-disable-next-line no-console
  console.log(`[perf] dock-nav ${href} ${ms}ms`);
}
