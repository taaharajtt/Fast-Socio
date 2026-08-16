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
 * Which browser is running on iOS.
 *
 * Every iOS browser is Safari's engine underneath and every one of them CAN add
 * to the home screen — but they do not put the Share action in the same place,
 * and until this existed the app told all of them to "tap Share in Safari's
 * toolbar". Chrome and Edge on iOS have no such toolbar button (it is behind
 * the ... menu) and Firefox has its own, so a third of iOS users were following
 * instructions that did not match their screen.
 *
 * The UA tokens are Apple-mandated for these browsers and unambiguous:
 * CriOS = Chrome, EdgiOS = Edge, FxiOS = Firefox, OPiOS/OPT = Opera.
 */
export type IOSBrowser = "safari" | "chrome" | "edge" | "firefox" | "opera" | "other";

export function getIOSBrowser(): IOSBrowser {
  if (typeof window === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/CriOS/i.test(ua)) return "chrome";
  if (/EdgiOS/i.test(ua)) return "edge";
  if (/FxiOS/i.test(ua)) return "firefox";
  if (/OPiOS|OPT\//i.test(ua)) return "opera";
  // Safari last: every browser above also carries "Safari" in its UA, so a
  // positive Safari result has to mean "none of the others matched".
  if (/Safari/i.test(ua)) return "safari";
  return "other";
}

/** True on Android (and not an iPadOS device masquerading as something else). */
export function isAndroid(): boolean {
  if (typeof window === "undefined") return false;
  return /Android/i.test(navigator.userAgent) && !isIOS();
}

/**
 * The embedded webviews social apps open links in.
 *
 * These matter more than any other platform check in this file, because they
 * are how most people first arrive: a link tapped in Instagram does NOT open
 * Chrome or Safari, it opens Instagram's own webview. That webview can neither
 * fire `beforeinstallprompt` (Android) nor offer Share -> Add to Home Screen
 * (iOS), so there is no install path from inside one on EITHER platform. The
 * only thing worth doing is handing the user off to a real browser first.
 *
 * The UA list is deliberately narrow — each token identifies a specific app's
 * webview and none of them appear in ordinary Chrome/Safari/Firefox strings:
 *
 *   FBAN / FBAV / FB_IAB / FBIOS  Facebook + Messenger (all platforms)
 *   Instagram                     Instagram, Android and iOS alike
 *   Line/                         LINE
 *   Twitter                       Twitter/X
 *   MicroMessenger                WeChat
 *   TikTok / musical_ly           TikTok
 *   Snapchat                      Snapchat
 *   LinkedInApp                   LinkedIn
 *
 * False negatives are the safe failure mode: an unrecognised webview simply
 * gets the normal (event-driven or iOS-instruction) path, which is what it
 * would have got anyway.
 */
export function isInAppBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|Twitter|MicroMessenger|TikTok|musical_ly|Snapchat|LinkedInApp/i.test(
    navigator.userAgent
  );
}

/**
 * True in a browser that can actually add to the home screen on iOS.
 * Chrome/Firefox/Edge on iOS are Safari under the skin and CAN add to the home
 * screen via the share sheet, so we deliberately do not narrow to Safari — but
 * in-app webviews (Instagram, Facebook) cannot, and showing steps there would
 * send users down a dead end.
 *
 * Kept as its own name because the iOS instruction path reads better for it;
 * the webview list itself is shared with Android via `isInAppBrowser`.
 */
export function isIOSInAppBrowser(): boolean {
  return isInAppBrowser();
}

/**
 * Browsers that will NEVER fire `beforeinstallprompt`, identified positively.
 *
 * The install CTA is event-driven, which leaves a silent dead end: a browser
 * that can install but has no event (Firefox on Android puts "Install" in its
 * own menu; Safari on macOS has File -> Add to Dock) shows the user nothing at
 * all, forever. Filling that gap needs care, because the obvious rule — "no
 * event yet, so show instructions" — is wrong in two common cases:
 *
 *   1. Chrome/Edge/Samsung on Android DO fire the event, just not always in the
 *      first few hundred milliseconds. Guessing early would replace a working
 *      one-tap install with a lecture about menus.
 *   2. Chromium does not fire it when the app is ALREADY installed, and a
 *      browser tab of an installed PWA is not `display-mode: standalone`. So
 *      "no event" also describes the user who already did what we asked.
 *
 * Both failure modes come from inferring the browser's capability from silence.
 * This function refuses to: it returns a value only for engines that are known
 * never to implement the API, and null — meaning "wait, do not guess" —
 * for everything else. A Chromium user therefore never sees menu instructions;
 * they see the real Install button when the event lands, or nothing.
 */
export type NoPromptBrowser = "firefox-android" | "safari-desktop";

export function noPromptBrowser(): NoPromptBrowser | null {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent;
  // iOS is a separate, richer path (share sheet) — never answer for it here.
  if (isIOS()) return null;
  // Gecko has never shipped beforeinstallprompt and has said it will not.
  if (/Firefox\//i.test(ua) && isAndroid()) return "firefox-android";
  // Desktop Safari: no install API, but 17+ can pin via File -> Add to Dock.
  // "Safari" appears in every WebKit UA, so Chrome/Edge must be excluded.
  if (
    /Macintosh/.test(ua) &&
    /Safari\//i.test(ua) &&
    !/Chrome|Chromium|Edg\//i.test(ua)
  ) {
    return "safari-desktop";
  }
  return null;
}

/**
 * Our canonical public origin, from the same env var the server uses
 * (`src/lib/site-url.ts`). NEXT_PUBLIC_ so it is inlined into the client bundle
 * at build time.
 *
 * Deliberately NOT derived from `window.location`: this value is used to build
 * an Android `intent://` URL, and an origin taken from the current URL (or from
 * any query parameter) would turn that into an open-redirect primitive capable
 * of launching an arbitrary site out of the webview. A build-time constant
 * cannot be steered by anything the user or a link author controls.
 */
function publicOrigin(): URL | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    // An intent:// handoff only makes sense for the real https origin.
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * An Android intent URL that reopens FAST SOCIO in Chrome.
 *
 * This is a real, documented Android navigation — following it leaves the
 * webview and hands the URL to Chrome, which is the only way out of an in-app
 * browser that does not depend on the user finding a menu item. It always
 * targets the ORIGIN ROOT: no path, no query, nothing derived from the current
 * URL, and above all no session material (tokens in a URL would be logged,
 * shared and cached). Continuity after the handoff comes from the magic link
 * or the password, both of which work in any browser.
 *
 * Returns null when there is no https origin configured, in which case the
 * caller falls back to written instructions.
 */
export function androidBrowserHandoffUrl(): string | null {
  const origin = publicOrigin();
  if (!origin) return null;
  const fallback = encodeURIComponent(`${origin.origin}/`);
  return (
    `intent://${origin.host}/#Intent;scheme=https;` +
    `package=com.android.chrome;S.browser_fallback_url=${fallback};end`
  );
}

/** The origin root as a plain https URL, for "copy this link" affordances. */
export function publicOriginUrl(): string | null {
  const origin = publicOrigin();
  return origin ? `${origin.origin}/` : null;
}
