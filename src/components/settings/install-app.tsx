"use client";

import { useCallback, useState } from "react";
import { Check, Smartphone } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { promptInstall } from "@/lib/pwa/install-store";
import { recordInstallEvent } from "@/lib/pwa/telemetry";
import { useInstallState } from "@/lib/pwa/use-install-state";
import {
  GenericInstallSteps,
  IOSInstallSteps,
  IOSReloginNote,
  MenuInstallSteps,
  WebviewInstallNote,
} from "@/components/pwa/install-instructions";

/**
 * The permanent way in.
 *
 * Until now the only install ask in the product was a banner that could be
 * dismissed, and once dismissed there was no path back — no Settings row, no
 * profile menu item, nothing. A user who tapped "not now" on day one and wanted
 * the app on day ten had no way to say so. That is the gap this closes, and it
 * is why this row exists even though the banner and the onboarding step already
 * ask.
 *
 * It is also the ONE surface that answers the `waiting` state instead of
 * staying quiet. The banner must not guess, because it speaks uninvited. Here
 * the user has navigated to Settings and is looking for this exact answer, so
 * generic-but-true directions are better than a blank space — and the copy is
 * careful to allow for "you may already have done this", since a Chromium tab
 * of an already-installed app is indistinguishable from one that has simply not
 * fired its event yet.
 */
export function InstallApp() {
  const state = useInstallState();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const install = useCallback(async () => {
    recordInstallEvent("cta_tapped", "settings", { once: false });
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome !== "unavailable") {
      recordInstallEvent(
        outcome === "accepted" ? "outcome_accepted" : "outcome_dismissed",
        "settings",
        { once: false }
      );
    }
  }, []);

  // Deliberately no `cta_shown` here. This row is always present in Settings,
  // so counting it would measure "opened Settings", not "was offered the app" —
  // it would swamp the banner and onboarding impressions with a number that
  // means something entirely different. Taps and outcomes are the honest
  // signals for a surface the user navigated to on purpose.

  if (state.kind === "installed") {
    return (
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Installed</p>
          <p className="text-xs text-fg-muted">
            You&rsquo;re running Fast Socio from your Home Screen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill text-fg-muted">
          <Smartphone className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Install Fast Socio</p>
          <p className="text-xs text-fg-muted">
            Full screen, no address bar, and notifications.
          </p>
        </div>
        {/* A real Install button ONLY where a tap really installs. Every other
            state gets a button that promises directions and delivers them. */}
        {state.kind === "native" ? (
          // The one purple control on an otherwise monochrome Settings screen.
          // Installing is the thing this product most wants you to do, and it
          // is a brand moment rather than a utility action — the toggles and
          // navigation rows around it stay neutral precisely so this one reads.
          <GlassButton size="sm" variant="brand" onClick={install} disabled={busy}>
            {busy ? "Opening…" : "Install"}
          </GlassButton>
        ) : (
          <GlassButton
            size="sm"
            variant="secondary"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide" : "How"}
          </GlassButton>
        )}
      </div>

      {open && state.kind !== "native" && (
        <div className="rounded-[14px] bg-glass p-4">
          {state.kind === "ios" && (
            <>
              <IOSInstallSteps browser={state.browser} />
              <div className="mt-4 border-t border-glass-border pt-3">
                <IOSReloginNote />
              </div>
            </>
          )}
          {state.kind === "menu" && <MenuInstallSteps browser={state.browser} />}
          {state.kind === "webview" && <WebviewInstallNote />}
          {state.kind === "waiting" && (
            <>
              <GenericInstallSteps />
              <p className="mt-3 border-t border-glass-border pt-3 text-xs text-fg-muted">
                If your browser doesn&rsquo;t offer it, Fast Socio may already be
                installed — check your Home Screen or app drawer.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
