"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ArrowUpRight, MoreHorizontal } from "lucide-react";
import { GlassCard, glassButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  androidBrowserHandoffUrl,
  isAndroid,
  publicOriginUrl,
} from "@/lib/pwa/install";
import { dismissHandoff } from "@/lib/pwa/snooze";
import { recordInstallEvent } from "@/lib/pwa/telemetry";

/**
 * The Instagram problem, and the only honest answer to it.
 *
 * Most arrivals tap a link inside Instagram, which does NOT open Chrome or
 * Safari — it opens Instagram's own embedded webview. That webview cannot fire
 * `beforeinstallprompt` (so there is no Android install), has no Share -> Add
 * to Home Screen (so there is no iOS install), and keeps its cookies in a jar
 * that no real browser can see. There is no install path from inside one on
 * either platform, and no amount of UI can create one.
 *
 * So this screen does not offer an install. It offers the one thing that can
 * actually be done: leave.
 *
 * ANDROID gets a real button. `intent://…;package=com.android.chrome;end` is a
 * documented Android navigation that hands the URL to Chrome, so a single tap
 * gets the user out. `S.browser_fallback_url` covers a device with no Chrome.
 *
 * IOS gets instructions only, because Apple provides no programmatic escape
 * from a webview — the user has to use Instagram's own "Open in external
 * browser" item. Pretending otherwise with a button that silently does nothing
 * is exactly the false affordance the audit warned against.
 *
 * WHAT ABOUT THEIR SESSION? Cookies do not transfer, but nothing is lost:
 * signup verification uses Supabase's default confirmation link, which
 * completes the IMPLICIT flow (session in the URL hash, no PKCE verifier pinned
 * to the browser that asked for it — see the long note in
 * `src/app/auth/callback/page.tsx`). The emailed link therefore signs the user
 * in wherever it is opened, and every account has a password by construction.
 * The handoff costs a tap, not an account.
 *
 * Dismissible on purpose. The audit sketched this as blocking until actioned;
 * a screen a user cannot get past is a trap when the detection is wrong, and
 * UA matching is never perfectly right. "Continue here" is therefore always
 * available, and the dismissal lasts for the tab session — the advice stops
 * being relevant the moment they leave the webview anyway.
 */
export function OpenInBrowser() {
  const [dismissed, setDismissed] = useState(false);
  const android = isAndroid();
  const intentUrl = android ? androidBrowserHandoffUrl() : null;
  const plainUrl = publicOriginUrl();

  const stay = useCallback(() => {
    recordInstallEvent("ask_snoozed", "handoff", { once: false });
    dismissHandoff();
    setDismissed(true);
  }, []);

  // The counter that matters most in the whole set. Instagram is the primary
  // acquisition channel and it had no install path at all; 'cta_shown' here is
  // how many arrivals are landing in a webview, and 'cta_tapped' is how many
  // actually escape it. The ratio between them is the single number that says
  // whether P0-3 worked.
  useEffect(() => {
    if (!dismissed) recordInstallEvent("cta_shown", "handoff");
  }, [dismissed]);

  if (dismissed) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#0A0B10]/95 px-5 py-10 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-in-browser-title"
    >
      <GlassCard strong radius="lg" className="mx-auto w-full max-w-sm p-6">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={56}
          height={56}
          className="h-14 w-14 rounded-[16px]"
        />
        <h2
          id="open-in-browser-title"
          className="mt-5 text-[22px] font-black leading-tight tracking-tight text-white"
        >
          Open Fast Socio in your browser
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
          You&rsquo;re in Instagram&rsquo;s built-in browser. It can&rsquo;t keep
          you signed in, can&rsquo;t send notifications, and can&rsquo;t add Fast
          Socio to your Home Screen.
        </p>

        {intentUrl ? (
          // A real navigation out of the webview, not a JS trick. Always the
          // origin root — never a path, query or anything derived from the
          // current URL, which would make this an open redirect.
          <a
            href={intentUrl}
            rel="noreferrer"
            // Recorded on the way out: the navigation leaves the webview, so
            // this is the last moment anything of ours runs. Fire-and-forget by
            // design (see telemetry.ts) — the handoff must never wait on it.
            onClick={() =>
              recordInstallEvent("cta_tapped", "handoff", { once: false })
            }
            className={cn(
              glassButton({ variant: "primary", size: "lg" }),
              "mt-6 h-[52px] w-full text-base font-bold"
            )}
          >
            Open in Chrome
            <ArrowUpRight className="h-5 w-5" aria-hidden />
          </a>
        ) : (
          <div className="mt-6 rounded-[var(--radius-lg,16px)] bg-glass p-4">
            <p className="flex items-start gap-2 text-sm leading-relaxed">
              <MoreHorizontal
                className="mt-0.5 h-5 w-5 shrink-0 text-accent"
                aria-hidden
              />
              <span>
                Tap <strong>&#8943;</strong> at the top right, then{" "}
                <strong>Open in external browser</strong>
                {android ? "" : " (or “Open in Safari”)"}.
              </span>
            </p>
            {plainUrl && (
              <p className="mt-3 border-t border-glass-border pt-3 text-xs text-fg-muted">
                Or type <span className="font-medium text-fg">{plainUrl}</span>{" "}
                into Safari yourself.
              </p>
            )}
          </div>
        )}

        <p className="mt-4 text-center text-xs text-fg-disabled">
          Your account comes with you — sign in with the same email.
        </p>

        <button
          type="button"
          onClick={stay}
          className="mt-4 w-full rounded-full py-2 text-[13px] font-semibold text-fg-muted transition-colors hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Continue here anyway
        </button>
      </GlassCard>
    </div>
  );
}
