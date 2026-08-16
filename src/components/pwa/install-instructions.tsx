"use client";

import { MoreHorizontal, MoreVertical, PlusSquare, Share } from "lucide-react";
import type { IOSBrowser, NoPromptBrowser } from "@/lib/pwa/install";

/**
 * The manual install steps, worded for the browser the user is actually in.
 *
 * Shared by the banner's sheet, the onboarding step and the Settings row so
 * that the three cannot drift — the old copy lived in one component and said
 * "Safari's toolbar" to every iOS browser, including the ones where the Share
 * action is somewhere else entirely.
 *
 * Every variant below describes a real, reachable menu item. Nothing here
 * claims an action the app can trigger; these are directions, and they are the
 * honest alternative to an Install button that would do nothing.
 */

/** Where each iOS browser keeps the Share action. */
const IOS_SHARE_LOCATION: Record<IOSBrowser, React.ReactNode> = {
  safari: (
    <>
      in the toolbar at the bottom of the screen
    </>
  ),
  chrome: (
    <>
      under <strong>&#8943;</strong> at the top right
    </>
  ),
  edge: (
    <>
      under <strong>&#8943;</strong> at the bottom right
    </>
  ),
  firefox: (
    <>
      under <strong>&#8943;</strong> in the address bar
    </>
  ),
  opera: (
    <>
      under <strong>&#8943;</strong> in the menu
    </>
  ),
  other: (
    <>
      in your browser&rsquo;s toolbar or <strong>&#8943;</strong> menu
    </>
  ),
};

export function IOSInstallSteps({ browser }: { browser: IOSBrowser }) {
  return (
    <ol className="space-y-4">
      <Step n={1}>
        Tap the{" "}
        <Share
          className="mx-0.5 inline-block h-4 w-4 -translate-y-px align-middle text-accent"
          aria-hidden
        />{" "}
        <strong>Share</strong> button — {IOS_SHARE_LOCATION[browser]}.
      </Step>
      <Step n={2}>
        Scroll down and choose{" "}
        <PlusSquare
          className="mx-0.5 inline-block h-4 w-4 -translate-y-px align-middle text-accent"
          aria-hidden
        />{" "}
        <strong>Add to Home Screen</strong>.
      </Step>
      <Step n={3}>
        Tap <strong>Add</strong> — Fast Socio now opens full-screen and can send
        you notifications.
      </Step>
    </ol>
  );
}

/**
 * The line iPhone users deserve to be told BEFORE they install rather than
 * discover afterwards: an installed iOS web app gets its own storage partition,
 * so it does not inherit the Safari session and opens at the login screen. It
 * is always recoverable — every account has a password by construction — but
 * unexplained it reads as "the app I just installed forgot me", which is a
 * uninstall waiting to happen.
 */
export function IOSReloginNote() {
  return (
    <p className="text-xs leading-relaxed text-fg-muted">
      iPhone asks you to sign in once more inside the installed app — that&rsquo;s
      an iOS thing, not us. Same email and password.
    </p>
  );
}

/** Browsers with no install event but a perfectly good menu item. */
export function MenuInstallSteps({ browser }: { browser: NoPromptBrowser }) {
  if (browser === "firefox-android") {
    return (
      <p className="flex items-start gap-2 text-sm leading-relaxed">
        <MoreVertical
          className="mt-0.5 h-5 w-5 shrink-0 text-accent"
          aria-hidden
        />
        <span>
          Tap <strong>&#8942;</strong> at the top right, then{" "}
          <strong>Install</strong> (older versions call it{" "}
          <strong>Add to Home screen</strong>).
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-sm leading-relaxed">
      <MoreHorizontal
        className="mt-0.5 h-5 w-5 shrink-0 text-accent"
        aria-hidden
      />
      <span>
        In Safari&rsquo;s menu bar choose <strong>File</strong> &rarr;{" "}
        <strong>Add to Dock</strong>.
      </span>
    </p>
  );
}

/** Shown when we genuinely cannot assert what this browser can do. */
export function GenericInstallSteps() {
  return (
    <p className="text-sm leading-relaxed">
      Open your browser&rsquo;s menu and look for <strong>Install</strong> or{" "}
      <strong>Add to Home screen</strong>. It&rsquo;s under{" "}
      <strong>&#8942;</strong> on Android and next to the address bar on desktop.
    </p>
  );
}

/** Webviews cannot install at all — say so, and point at the way out. */
export function WebviewInstallNote() {
  return (
    <p className="text-sm leading-relaxed">
      You&rsquo;re in an app&rsquo;s built-in browser, which can&rsquo;t add
      anything to your Home Screen. Open Fast Socio in Chrome or Safari first —
      then it takes two taps.
    </p>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="gradient-brand flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
        {n}
      </span>
      <span className="text-sm leading-relaxed">{children}</span>
    </li>
  );
}
