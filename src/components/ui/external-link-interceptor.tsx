"use client";

import { useEffect, useState } from "react";
import { GlassButton, GlassSheet } from "@/components/ui";
import { ExternalLink } from "lucide-react";

function isExternalHref(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    return new URL(href, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Global click-delegation guard: any <a> pointing off-origin anywhere in the
 * DOM (posts, comments, chat, help responses, profile bios, …) is intercepted
 * and confirmed before the browser navigates, instead of every link component
 * needing its own opt-in.
 */
export function ExternalLinkInterceptor() {
  const [targetUrl, setTargetUrl] = useState<string | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      if (!anchor) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!isExternalHref(href)) return;

      e.preventDefault();
      setTargetUrl(anchor.href);
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const host = (() => {
    if (!targetUrl) return "";
    try {
      const u = new URL(targetUrl);
      return `${u.host}${u.pathname}${u.search}`;
    } catch {
      return targetUrl;
    }
  })();

  return (
    <GlassSheet
      open={Boolean(targetUrl)}
      onClose={() => setTargetUrl(null)}
      label="Leaving FastSocio"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent">
            <ExternalLink className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="text-[17px] font-semibold text-fg">Leaving FastSocio</h2>
        </div>

        <p className="text-sm text-fg-muted">
          You are about to leave FastSocio and open an external website.
        </p>

        <div className="glass truncate rounded-[var(--radius-sm)] px-3 py-2 font-mono text-xs text-fg">
          {host}
        </div>

        <div className="flex gap-3 pt-1">
          <GlassButton
            type="button"
            variant="glass"
            className="flex-1"
            onClick={() => setTargetUrl(null)}
          >
            Cancel
          </GlassButton>
          <GlassButton
            type="button"
            variant="primary"
            className="flex-1"
            onClick={() => {
              if (targetUrl) window.open(targetUrl, "_blank", "noopener,noreferrer");
              setTargetUrl(null);
            }}
          >
            Proceed
          </GlassButton>
        </div>
      </div>
    </GlassSheet>
  );
}
