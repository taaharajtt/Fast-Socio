/**
 * "Not now" state for the install funnel.
 *
 * A snooze rather than a permanent kill: someone who declines on day one is
 * often the same person who, a week later, is using the app daily from a
 * browser tab and would take the icon if offered. A dismissal that lasts
 * forever quietly writes those users off.
 *
 * Deliberately localStorage and not a cookie: this is a per-device
 * presentation choice with no server-side meaning, and installs are per-device
 * too. It never leaves the browser.
 */
const SNOOZE_KEY = "pwa-install-snoozed-at";
const SNOOZE_DAYS = 7;

/** True while a recent "not now" is still in effect. */
export function isInstallSnoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    if (!at) return false;
    return Date.now() - at < SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    // Private mode / storage disabled. Treat as not snoozed: showing the ask
    // once per visit is a smaller cost than throwing on a read.
    return false;
  }
}

/** Record a dismissal (or a completed install, which also stops the asking). */
export function snoozeInstall(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now()));
  } catch {
    /* nothing to do — the ask simply reappears next visit */
  }
}

/**
 * Session-scoped dismissal of the in-app-browser handoff. Session rather than
 * 7 days on purpose: the advice ("open this in a real browser") is true for as
 * long as the user is inside the webview and stops being relevant the moment
 * they leave, so tying it to the tab is the honest lifetime.
 */
const HANDOFF_KEY = "pwa-handoff-dismissed";

export function isHandoffDismissed(): boolean {
  try {
    return sessionStorage.getItem(HANDOFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissHandoff(): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, "1");
  } catch {
    /* ignored — it reappears on the next load, which is acceptable */
  }
}
