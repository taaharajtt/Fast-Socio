import "server-only";
import webpush, { type PushSubscription } from "web-push";

/**
 * Web Push server helpers (Task #001f scaffold).
 *
 * In production, dispatch will run from a Supabase Edge Function (Deno) reading
 * subscriptions from `push_subscriptions` and respecting `notification_
 * preferences`. This module configures VAPID and exposes a thin send wrapper so
 * Phase 10 can plug in fan-out and 410/404 cleanup of stale endpoints.
 */

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@fastsocio.app";

  if (!publicKey || !privateKey) {
    throw new Error(
      "VAPID keys are not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY."
    );
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/**
 * Send a single push notification. Returns true on success; false if the
 * endpoint is gone (404/410) so the caller can prune the stored subscription.
 */
export async function sendPush(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<boolean> {
  ensureConfigured();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) return false; // stale endpoint
    throw err;
  }
}
