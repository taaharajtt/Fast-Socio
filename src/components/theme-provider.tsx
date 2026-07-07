"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { MotionConfig } from "framer-motion";

/**
 * App-wide theme provider. Dark is the primary identity (UI Spec §2.1);
 * "system" is offered so device preference is respected, with manual
 * override persisted. Uses the class strategy (html.dark / html.light)
 * that the design tokens in globals.css are built around.
 *
 * MotionConfig reducedMotion="user" (P6-04) makes every framer-motion animation
 * honour the OS "reduce motion" preference — transform/layout animations are
 * reduced for users with vestibular sensitivity (WCAG 2.3.3).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemesProvider>
  );
}
