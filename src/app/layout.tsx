import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance";
import { MigrationWelcome } from "@/components/pwa/migration-welcome";
import { InstallFunnel } from "@/components/pwa/install-funnel";
import { INSTALL_CAPTURE_SCRIPT } from "@/lib/pwa/install-store";
import { AppleSplashScreens } from "./apple-splash-screens";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const APP_NAME = "FAST SOCIO";
const APP_DESCRIPTION =
  "The university-exclusive social platform for FAST NUCES students.";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: "%s · FAST SOCIO",
  },
  description: APP_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0B10",
  width: "device-width",
  initialScale: 1,
  // Do NOT cap maximumScale / disable user scaling — users must be able to
  // pinch-zoom (WCAG 2.1 AA §1.4.4 Resize Text). P6-03.
  viewportFit: "cover",
  // Android Chrome 108+: the virtual keyboard only resizes the VISUAL viewport
  // by default, so 100dvh does not shrink and fixed/sticky composers stay
  // hidden behind the keyboard. resizes-content restores the resizing layout
  // viewport. iOS ignores this (keyboard overlays) — handled separately via
  // the visualViewport --kb inset (see use-keyboard-inset.ts).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased dark`}
      style={{ colorScheme: "dark" }}
      suppressHydrationWarning
    >
      <head>
        {/* Apply saved appearance (font size / density / motion) before first
            paint to avoid a flash. Theme is handled separately by next-themes. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
        {/* Bank Chromium's `beforeinstallprompt` the instant it fires.
            It arrives once per load, cannot be replayed, and routinely beats
            hydration on a phone — so the listener CANNOT live in a useEffect
            or the install CTA silently never appears. See install-store.ts. */}
        <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }} />
        {/* iOS PWA launch (splash) screens — Android uses the manifest. */}
        <AppleSplashScreens />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {/* Outermost route boundary. Every nested layout adds a closer one,
              so this only ever catches the handful of standalone pages that sit
              directly under the root (the landing redirect, /banned,
              /maintenance, the auth callbacks) — it exists so none of them can
              hold the document back with a blank screen. */}
          <Suspense>{children}</Suspense>
          {/* One-time hello for arrivals from the previous address. Mounted at
              the root (not the student layout) because they land on /login as
              often as /home, and it must render before they sign in. */}
          <MigrationWelcome />
          {/* The install funnel. Mounted HERE, not in the student layout, so it
              exists before an account does — on /login, /signup and the
              onboarding wizard, which is where an Instagram arrival decides
              whether to stay. It picks the right ask (or none) per route and
              platform; see install-funnel.tsx.

              The Suspense boundary is NOT optional. The funnel reads
              usePathname(), which on a dynamic route (/profile/[id],
              /societies/[id], /admin/users/[id]) is request-scoped data. Read
              from the root layout without a boundary it is "uncached data
              outside <Suspense>", and under Cache Components that collapses the
              prerendered static shell of EVERY route — the exact regression the
              student layout is carefully written to avoid. Behind a boundary it
              is a null-rendering hole that streams in and costs nothing: this
              component renders nothing on the server in any case. */}
          <Suspense>
            <InstallFunnel />
          </Suspense>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
