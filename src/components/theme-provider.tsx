"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * App-wide theme provider. Dark is the primary identity (UI Spec §2.1);
 * "system" is offered so device preference is respected, with manual
 * override persisted. Uses the class strategy (html.dark / html.light)
 * that the design tokens in globals.css are built around.
 *
 * NOTE: framer-motion's `MotionConfig reducedMotion="user"` (P6-04, WCAG 2.3.3)
 * used to live here, which pulled framer-motion into the shared every-page
 * bundle — including public/auth pages (/login, /signup) that render no motion
 * at all. It now lives inside each framer component (glass-sheet, swipe-deck,
 * announcement-modal) via <MotionReduced>, so the reduced-motion policy is
 * unchanged wherever framer actually renders, but pages with no motion no longer
 * download it. See src/components/ui/motion-reduced.tsx.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
