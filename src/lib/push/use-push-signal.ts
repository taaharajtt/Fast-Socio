"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `onPush` when the service worker reports an incoming Web Push
 * (`{ type: "PUSH_RECEIVED" }`, sent by public/push-sw.js).
 *
 * This is the recovery path for the case realtime cannot cover: a backgrounded
 * PWA — and on iOS, any PWA that is not in the foreground — has no realtime
 * socket at all, so the events that would have refreshed the inbox and the
 * Activity bell are never delivered. The push that the OS *does* deliver is
 * therefore the only evidence the app gets that something changed, and it must
 * translate into an in-app re-read rather than only a tray notification.
 *
 * The message deliberately carries no counts or rows: callers re-read through
 * their normal RLS-scoped queries. A service-worker message is still just a
 * signal, not a source of truth.
 */
export function usePushSignal(onPush: () => void) {
  const handler = useRef(onPush);
  // Written in an effect, not during render — React Compiler (enabled here)
  // rejects a render-phase ref write.
  useEffect(() => {
    handler.current = onPush;
  });

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_RECEIVED") handler.current();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);
}
