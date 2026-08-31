"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `onPush` when the service worker reports an incoming Web Push
 * (`{ type: "PUSH_RECEIVED" }`, sent by public/push-sw.js).
 *
 * This is the recovery path realtime cannot cover: a backgrounded PWA — and on
 * iOS, any PWA that is not in the foreground — has no realtime socket at all,
 * so the events that would have refreshed the inbox are never delivered. The
 * push the OS *does* deliver is the only evidence the app gets that something
 * changed, and it has to translate into an in-app re-read rather than only a
 * tray notification.
 *
 * The message deliberately carries no counts, ids or message text: callers
 * re-read through their normal RLS-scoped queries. A service-worker message is
 * a signal, never a source of truth.
 */
export function usePushSignal(onPush: () => void) {
  const handler = useRef(onPush);
  // Written in an effect, not during render: a render-phase ref write is a
  // Rules-of-React violation, and would make the React Compiler (enabled via
  // `reactCompiler` in next.config.ts) bail on this hook rather than memoize it.
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
