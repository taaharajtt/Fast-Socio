/**
 * PWA install detection.
 *
 * The two platforms could not be more different:
 *
 * - Android/Chromium fires `beforeinstallprompt` when the app is installable
 *   and NOT yet installed. That event is both the signal and the trigger — we
 *   stash it and call prompt() to open the native install dialog.
 * - iOS Safari has no install API at all and never fires the event. The only
 *   route is the user manually tapping Share -> Add to Home Screen, so all we
 *   can do is detect iOS + not-installed and show instructions.
 *
 * Installing matters beyond polish on iOS: web push requires an installed PWA
 * (16.4+), so a browser-tab user cannot receive notifications at all.
 */

/** The non-standard Chromium event. Not in lib.dom, so we type it ourselves. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

/** True when running as an installed app rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's legacy flag — it does not implement display-mode.
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

/** True on iPhone/iPad, including iPadOS 13+ which masquerades as a Mac. */
export function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports a Macintosh UA; a touch-capable "Mac" is really an iPad.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * True in a browser that can actually add to the home screen on iOS.
 * Chrome/Firefox/Edge on iOS are Safari under the skin and CAN add to the home
 * screen via the share sheet, so we deliberately do not narrow to Safari — but
 * in-app webviews (Instagram, Facebook) cannot, and showing steps there would
 * send users down a dead end.
 */
export function isIOSInAppBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return /FBAN|FBAV|Instagram|Line\/|Twitter/i.test(navigator.userAgent);
}
