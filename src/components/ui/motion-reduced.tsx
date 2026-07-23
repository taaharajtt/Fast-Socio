"use client";

import { MotionConfig } from "framer-motion";

/**
 * Single source of the app's reduced-motion policy for framer-motion.
 *
 * `reducedMotion="user"` (P6-04, WCAG 2.3.3) makes framer's JS-driven transform
 * animations honour the OS "reduce motion" preference — CSS
 * `prefers-reduced-motion` in globals.css cannot reach these because framer
 * animates via requestAnimationFrame, not CSS transitions.
 *
 * This used to sit in the root ThemeProvider, which forced framer-motion into
 * the shared bundle of EVERY page (incl. public/auth pages that render no
 * motion). Wrapping each framer component with <MotionReduced> instead keeps the
 * policy identical wherever motion renders, while pages with no motion no longer
 * ship framer. Nesting is harmless — the innermost config wins and the value is
 * always the same.
 */
export function MotionReduced({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
