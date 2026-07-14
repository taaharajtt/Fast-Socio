/**
 * iOS PWA launch (splash) screens.
 *
 * Android/Chrome auto-generate a splash from the web manifest (icon + name +
 * theme_color), but iOS Safari only shows a launch image when explicit
 * `apple-touch-startup-image` links are present — one per device resolution,
 * matched by a media query. The images live in /public/splash and are the
 * brand bolt centered on the #0A0B10 background (regenerate via
 * scripts/gen-splash.js). Portrait-only, matching the manifest orientation.
 */
const SPLASH_SCREENS: ReadonlyArray<{ media: string; href: string }> = [
  { media: "(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", href: "/splash/apple-splash-640-1136.png" },
  { media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", href: "/splash/apple-splash-750-1334.png" },
  { media: "(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", href: "/splash/apple-splash-1242-2208.png" },
  { media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", href: "/splash/apple-splash-1125-2436.png" },
  { media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", href: "/splash/apple-splash-828-1792.png" },
  { media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", href: "/splash/apple-splash-1242-2688.png" },
  { media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", href: "/splash/apple-splash-1170-2532.png" },
  { media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", href: "/splash/apple-splash-1284-2778.png" },
  { media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", href: "/splash/apple-splash-1179-2556.png" },
  { media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", href: "/splash/apple-splash-1290-2796.png" },
  { media: "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", href: "/splash/apple-splash-1206-2622.png" },
  { media: "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", href: "/splash/apple-splash-1320-2868.png" },
  { media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", href: "/splash/apple-splash-1536-2048.png" },
  { media: "(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", href: "/splash/apple-splash-1620-2160.png" },
  { media: "(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", href: "/splash/apple-splash-1640-2360.png" },
  { media: "(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", href: "/splash/apple-splash-1668-2224.png" },
  { media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", href: "/splash/apple-splash-1668-2388.png" },
  { media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", href: "/splash/apple-splash-2048-2732.png" },
];

export function AppleSplashScreens() {
  return (
    <>
      {SPLASH_SCREENS.map((s) => (
        <link
          key={s.href}
          rel="apple-touch-startup-image"
          media={s.media}
          href={s.href}
        />
      ))}
    </>
  );
}
