"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { GlassButton, GlassCard, GlassSheet } from "@/components/ui";
import {
  isIOS,
  isIOSInAppBrowser,
  isStandalone,
  type BeforeInstallPromptEvent,
} from "@/lib/pwa/install";

/**
 * Invites browser-tab users to install FAST SOCIO to their home screen.
 *
 * Android/Chromium: `beforeinstallprompt` is the gate AND the trigger. It only
 * fires when the app is installable and not already installed, so its arrival
 * is the most reliable "this user can install" signal there is — we show the
 * banner only once it lands, and tapping Install opens the native dialog.
 *
 * iOS: Safari exposes no install API and never fires that event, so we detect
 * iOS + not-standalone and show the manual Share -> Add to Home Screen steps.
 *
 * Dismissal is snoozed (not permanent) so we re-ask later without nagging, and
 * an install (or an already-installed launch) silences it for good.
 */
const SNOOZE_KEY = "pwa-install-snoozed-at";
const SNOOZE_DAYS = 7;

function isSnoozed(): boolean {
  const at = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
  if (!at) return false;
  return Date.now() - at < SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Whether this device can only install via the iOS share sheet. It is a static
 * property of the device — not an event — so it is read through
 * useSyncExternalStore (never changes, hence the no-op subscribe) rather than
 * assigned via setState in an effect. The server snapshot is false so SSR and
 * the first client render agree, and the banner appears on hydration.
 */
const noopSubscribe = () => () => {};

function useIOSInstallable(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => isIOS() && !isIOSInAppBrowser() && !isStandalone() && !isSnoozed(),
    () => false
  );
}

export function InstallPrompt() {
  // The stashed Chromium event — present only when Android can install.
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [dismissed, setDismissed] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);

  const showIOS = useIOSInstallable() && !dismissed;

  useEffect(() => {
    // Already installed, or recently told us to go away → never listen.
    if (isStandalone() || isSnoozed()) return;
    // iOS never fires the event; that path is handled by useIOSInstallable.
    if (isIOS()) return;

    // Android/desktop Chromium: wait for the browser to tell us it's installable.
    function onBeforeInstallPrompt(e: Event) {
      // Stop Chrome's own mini-infobar so ours is the only ask.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    // Installed mid-session (or from the browser menu) → tear the banner down.
    function onInstalled() {
      setDeferred(null);
      setDismissed(true);
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const snooze = useCallback(() => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    setDeferred(null);
    setDismissed(true);
    setStepsOpen(false);
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use — Chrome will re-fire it on a later visit if the
    // user declined, so just drop our reference either way.
    setDeferred(null);
    if (outcome === "dismissed") {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    }
  }, [deferred]);

  if (!deferred && !showIOS) return null;

  return (
    <>
      {/* Sits above the floating dock (fixed, bottom-0, ~5rem tall) and below
          the modal layer (z-50) so sheets cover it. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 px-4">
        <GlassCard
          strong
          radius="lg"
          className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 p-3"
        >
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-[12px]"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Install FAST SOCIO</p>
            <p className="text-xs text-fg-muted">
              {showIOS
                ? "Add to your Home Screen for notifications and a full-screen app."
                : "Get the full-screen app and notifications."}
            </p>
          </div>
          <GlassButton
            size="sm"
            onClick={showIOS ? () => setStepsOpen(true) : install}
          >
            {showIOS ? "How" : "Install"}
          </GlassButton>
          <GlassButton
            size="sm"
            variant="ghost"
            aria-label="Not now"
            onClick={snooze}
            className="px-2"
          >
            ✕
          </GlassButton>
        </GlassCard>
      </div>

      {/* iOS has no install API — the only route is the share sheet, so spell it
          out rather than pretending we can trigger it. */}
      <GlassSheet
        open={stepsOpen}
        onClose={() => setStepsOpen(false)}
        label="Install FAST SOCIO"
      >
        <h2 className="text-lg font-bold">Add to Home Screen</h2>
        <p className="mt-1 text-sm text-fg-muted">
          iPhone and iPad can only install from the share menu — it takes two
          taps.
        </p>
        <ol className="mt-5 space-y-4">
          <Step n={1}>
            Tap the <strong>Share</strong> button in Safari&rsquo;s toolbar (the
            square with an arrow pointing up).
          </Step>
          <Step n={2}>
            Scroll down and choose <strong>Add to Home Screen</strong>.
          </Step>
          <Step n={3}>
            Tap <strong>Add</strong> — FAST SOCIO now opens full-screen and can
            send you notifications.
          </Step>
        </ol>
        <GlassButton
          className="mt-6 w-full"
          variant="glass"
          onClick={() => setStepsOpen(false)}
        >
          Got it
        </GlassButton>
      </GlassSheet>
    </>
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
