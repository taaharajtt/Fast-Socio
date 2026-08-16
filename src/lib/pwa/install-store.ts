import type { BeforeInstallPromptEvent } from "./install";

/**
 * Global, pre-hydration capture of Chromium's `beforeinstallprompt`.
 *
 * WHY THIS EXISTS AT ALL — the audit's P0-1.
 *
 * `beforeinstallprompt` fires ONCE per page load and cannot be replayed. There
 * is no API to ask the browser for it again. Chrome dispatches it as soon as it
 * has evaluated the manifest and the service worker, which on a real phone is
 * routinely BEFORE a React bundle this size has hydrated. Registering the
 * listener from a `useEffect` therefore loses the event on exactly the loads
 * that matter most: a cold arrival on a slow connection, and the full document
 * navigation `/login -> /home` does after sign-in.
 *
 * Worse, the handler calls `preventDefault()` to suppress Chrome's own
 * mini-infobar so that ours is the only ask. When the listener attaches in time
 * that is correct. When it does not, the user gets neither our banner nor the
 * browser's hint — strictly worse than shipping no install code at all.
 *
 * So the listener is installed by an inline `<head>` script that the browser
 * executes synchronously while parsing the document, long before any JavaScript
 * bundle has downloaded. The event is banked on `window.__fsInstall` and React
 * reads it whenever it gets around to mounting. The race is not won faster —
 * it is removed.
 *
 * The same script watches `appinstalled`, so an install that happens through
 * the browser's own menu (rather than our button) also silences the CTA.
 *
 * This is the documented Next.js pattern for state that must be correct before
 * hydration (see `node_modules/next/dist/docs/01-app/02-guides/
 * preventing-flash-before-hydration.md`), and it is how the appearance
 * preferences in `src/lib/appearance.ts` already work.
 */

/** Name of the DOM event the inline script fires when the state changes. */
const CHANGE_EVENT = "fs:install-change";

/** The global the inline script writes to. `e` = banked event, `i` = installed. */
interface InstallGlobal {
  e: BeforeInstallPromptEvent | null;
  i: boolean;
}

/**
 * The inline script, as a string, for `<head>`.
 *
 * Kept tiny and dependency-free on purpose: it runs on the critical path of
 * every single page load, including the signed-out ones. Everything it does is
 * wrapped in try/catch — a browser that throws here (no `beforeinstallprompt`
 * at all, a locked-down webview) must not take the document down with it.
 *
 * NOTE ON CSP: this is an inline script, so it depends on `script-src` keeping
 * `'unsafe-inline'` — see the long comment in `next.config.ts` explaining why
 * that concession is currently made. If nonces or hash-based CSP ever land,
 * this script needs to be covered by them.
 */
export const INSTALL_CAPTURE_SCRIPT = `
(function(){try{
var w=window,s=w.__fsInstall={e:null,i:false},
n=function(){try{w.dispatchEvent(new Event('${CHANGE_EVENT}'))}catch(e){}};
w.addEventListener('beforeinstallprompt',function(ev){ev.preventDefault();s.e=ev;n()});
w.addEventListener('appinstalled',function(){s.e=null;s.i=true;n()});
}catch(e){}})();
`;

function state(): InstallGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __fsInstall?: InstallGlobal }).__fsInstall;
}

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subscribe to install-state changes. For `useSyncExternalStore`. */
export function subscribeInstallState(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/**
 * The banked event, or null. Returns the same object reference for as long as
 * the event is held, which is what makes it a valid `useSyncExternalStore`
 * snapshot (a fresh object each call would re-render forever).
 */
export function getInstallEvent(): BeforeInstallPromptEvent | null {
  return state()?.e ?? null;
}

/** True once `appinstalled` has fired in this document. */
export function getJustInstalled(): boolean {
  return state()?.i ?? false;
}

/** Server snapshot — nothing is knowable about install state during SSR. */
export const noInstallEvent = null;
export const notInstalled = false;

/**
 * Open the native install dialog. MUST be called from a user gesture — Chrome
 * rejects `prompt()` outside one, which is why this is only ever wired to an
 * onClick and never to an effect.
 *
 * The banked event is dropped BEFORE awaiting, so a double tap cannot call
 * `prompt()` twice on the same single-use event (which throws). Chrome re-fires
 * `beforeinstallprompt` on a later visit if the user declined, and the inline
 * script will bank that one too.
 */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const s = state();
  const event = s?.e;
  if (!s || !event) return "unavailable";
  s.e = null;
  notify();
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    // A stale or already-used event. Treated as a dismissal so the caller
    // snoozes rather than leaving a dead button on screen.
    return "dismissed";
  }
}
