"use client";

import { useEffect } from "react";
import { isPushSupported, subscribeToPush } from "@/lib/push/client";
import { savePushSubscription } from "@/app/(student)/settings/push-actions";

/**
 * Enables push notifications by default for signed-in students. Renders nothing.
 *
 * - If permission is already granted, it silently (re)creates and stores the
 *   subscription — no prompt.
 * - If permission is still undecided ("default"), it prompts once per browser
 *   (guarded by a localStorage flag) so users aren't nagged on every load. The
 *   Settings toggle remains the explicit control and can override this.
 * - If permission was denied, or push isn't supported (e.g. iOS Safari before
 *   the PWA is installed to the home screen), it does nothing.
 */
const ATTEMPT_FLAG = "push-auto-attempted";

export function PushAutoEnable() {
  useEffect(() => {
    if (!isPushSupported()) return;

    const granted = Notification.permission === "granted";
    const undecided = Notification.permission === "default";
    // Only auto-prompt once; always (re)ensure a stored subscription if granted.
    if (!granted && !undecided) return;
    if (undecided && localStorage.getItem(ATTEMPT_FLAG)) return;

    let cancelled = false;
    (async () => {
      if (undecided) localStorage.setItem(ATTEMPT_FLAG, "1");
      const sub = await subscribeToPush(); // requests permission if undecided
      if (cancelled || !sub) return;
      const json = sub.toJSON();
      await savePushSubscription({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
