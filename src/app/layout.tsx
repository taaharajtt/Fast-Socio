import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance";
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
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply saved appearance (font size / density / motion) before first
            paint to avoid a flash. Theme is handled separately by next-themes. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
        {/* iOS PWA launch (splash) screens — Android uses the manifest. */}
        <AppleSplashScreens />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
