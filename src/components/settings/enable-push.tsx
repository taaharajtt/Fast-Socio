"use client";

import { useEffect, useState } from "react";
import { GlassButton } from "@/components/ui";
import {
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/client";
import {
  savePushSubscription,
  removePushSubscription,
} from "@/app/(student)/settings/push-actions";

type State = "unsupported" | "off" | "on" | "working";

export function EnablePush() {
  const [state, setState] = useState<State>("off");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPushSupported()) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setError(null);
    setState("working");
    const sub = await subscribeToPush();
    if (!sub) {
      setError("Couldn't enable notifications. Check your browser permissions.");
      setState("off");
      return;
    }
    const json = sub.toJSON();
    await savePushSubscription({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      userAgent: navigator.userAgent,
    });
    setState("on");
  }

  async function disable() {
    setState("working");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await removePushSubscription(sub.endpoint);
    await unsubscribeFromPush();
    setState("off");
  }

  if (state === "unsupported") {
    return (
      <p className="text-sm text-fg-muted">
        Push notifications aren&rsquo;t supported here. On iOS, install the app
        to your home screen first.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm">Push notifications</span>
        <GlassButton
          variant={state === "on" ? "glass" : "primary"}
          size="sm"
          disabled={state === "working"}
          onClick={state === "on" ? disable : enable}
        >
          {state === "working"
            ? "…"
            : state === "on"
              ? "Disable"
              : "Enable"}
        </GlassButton>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
