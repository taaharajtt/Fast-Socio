"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * App-wide theme provider. Dark is the primary identity (UI Spec §2.1);
 * "system" is offered so device preference is respected, with manual
 * override persisted. Uses the class strategy (html.dark / html.light)
 * that the design tokens in globals.css are built around.
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
