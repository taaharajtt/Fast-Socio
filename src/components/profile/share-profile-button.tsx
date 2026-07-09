"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

/**
 * Share-profile pill (UISpec V3 Screen 14 action row). Uses the Web Share sheet
 * on supporting devices, falling back to copying the profile link.
 */
export function ShareProfileButton({ profileId }: { profileId: string }) {
  const [copied, setCopied] = useState(false);

  async function onShare() {
    const url = `${window.location.origin}/profile/${profileId}`;
    const data = { title: "FAST SOCIO", text: "Check out this profile", url };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {
        // user dismissed the share sheet — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing else to do */
    }
  }

  return (
    <button
      type="button"
      onClick={onShare}
      className="flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-bg-elevated"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4" aria-hidden />
          Copied
        </>
      ) : (
        <>
          <Share2 className="h-4 w-4" aria-hidden />
          Share
        </>
      )}
    </button>
  );
}
