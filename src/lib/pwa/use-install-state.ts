"use client";

import { useSyncExternalStore } from "react";
import {
  getIOSBrowser,
  isIOS,
  isInAppBrowser,
  isStandalone,
  noPromptBrowser,
  type IOSBrowser,
  type NoPromptBrowser,
} from "./install";
import {
  getInstallEvent,
  getJustInstalled,
  notInstalled,
  subscribeInstallState,
} from "./install-store";

/**
 * The one place that decides what this browser can actually do about installing.
 *
 * Three surfaces ask the question — the floating banner, the onboarding step,
 * and the Settings row — and they must never answer it differently. Before this
 * existed the logic was duplicated in two of them and had already diverged.
 *
 * The states are exhaustive and each one maps to exactly one honest UI:
 *
 *   installed  running as an installed app, or `appinstalled` just fired.
 *              Nothing to offer.
 *   native     Chromium banked a `beforeinstallprompt`. A REAL Install button.
 *   ios        iPhone/iPad in a browser that can use the share sheet. Manual
 *              steps, worded for the specific browser (Safari's toolbar and
 *              Chrome's ... menu are not in the same place).
 *   webview    a social app's embedded browser. Cannot install on any platform;
 *              the only move is a handoff to a real browser.
 *   menu       a browser positively identified as never firing the event but
 *              still able to install from its own menu (Firefox Android,
 *              desktop Safari). Named instructions.
 *   waiting    none of the above can be asserted yet — typically Chromium
 *              before the event lands, or Chromium where the app is already
 *              installed so the event will never come.
 *
 * `waiting` is the important one, and the reason this is a six-state machine
 * rather than five. It means "we do not know", and the correct UI for it is
 * NOTHING in any proactive surface. Treating it as "can't install, show
 * instructions" is what produces both a lecture in place of a working Install
 * button, and menu steps shown to someone who already installed the app.
 * Settings may render a softer version of it, because there the user asked.
 */
export type InstallState =
  | { kind: "installed" }
  | { kind: "native" }
  | { kind: "ios"; browser: IOSBrowser }
  | { kind: "webview" }
  | { kind: "menu"; browser: NoPromptBrowser }
  | { kind: "waiting" };

/** Static for the lifetime of a document, hence the no-op subscribe. */
const noopSubscribe = () => () => {};

/**
 * The environment half of the answer, as a plain string so the snapshot is a
 * stable primitive. Combined with the event below into the object the caller
 * sees — building that object inside a snapshot would return a fresh reference
 * every call and re-render forever.
 */
type Environment = "installed" | "webview" | `ios:${IOSBrowser}` | `menu:${NoPromptBrowser}` | "other";

function readEnvironment(): Environment {
  if (isStandalone()) return "installed";
  if (isInAppBrowser()) return "webview";
  if (isIOS()) return `ios:${getIOSBrowser()}`;
  const noPrompt = noPromptBrowser();
  if (noPrompt) return `menu:${noPrompt}`;
  return "other";
}

export function useInstallState(): InstallState {
  const environment = useSyncExternalStore(
    noopSubscribe,
    readEnvironment,
    // Server + the hydration pass: assert nothing. Every surface renders
    // nothing for "waiting", so SSR output is empty and there is no mismatch;
    // the real state lands on the very next render.
    () => "other" as const
  );
  const hasEvent = useSyncExternalStore(
    subscribeInstallState,
    () => getInstallEvent() !== null,
    () => false
  );
  const justInstalled = useSyncExternalStore(
    subscribeInstallState,
    getJustInstalled,
    () => notInstalled
  );

  if (justInstalled || environment === "installed") return { kind: "installed" };
  if (environment === "webview") return { kind: "webview" };
  // A banked event outranks every guess below: it is the browser itself saying
  // it can install right now.
  if (hasEvent) return { kind: "native" };
  if (environment.startsWith("ios:")) {
    return { kind: "ios", browser: environment.slice(4) as IOSBrowser };
  }
  if (environment.startsWith("menu:")) {
    return { kind: "menu", browser: environment.slice(5) as NoPromptBrowser };
  }
  return { kind: "waiting" };
}
