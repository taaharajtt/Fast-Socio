"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ensureRealtimeAuth } from "@/lib/realtime/auth";

/**
 * One place for the four things every realtime screen in this app was getting
 * subtly wrong.
 *
 * 1. AUTH. Each channel read the session and called `realtime.setAuth` once, at
 *    subscribe time, and never again — so a socket outlived its JWT and went
 *    deaf. `ensureRealtimeAuth` now keeps the token current for the whole tab.
 *
 * 2. CLEANUP RACE. The old pattern was
 *
 *      (async () => { await getSession(); channelRef.current = supabase.channel(...) })()
 *      return () => { if (channelRef.current) supabase.removeChannel(...) }
 *
 *    If the component unmounted while `getSession()` was still in flight — a
 *    fast tap from /chat into a thread does exactly that — the cleanup found
 *    `null`, returned, and the async body then created a channel nobody would
 *    ever remove. Here the channel handle lives in the effect's own closure and
 *    a `cancelled` flag stops the async body from ever creating one after
 *    teardown, so a leak is not expressible.
 *
 * 3. RECONNECT. `postgres_changes` has no replay: anything that happened while
 *    the socket was down is simply gone. supabase-js rejoins automatically, but
 *    nothing told the app to go and find what it missed. `onCatchUp` is called
 *    on every (re)subscribe, which is the only moment we know the gap has
 *    closed and can safely re-read.
 *
 * 4. FOCUS. A backgrounded PWA loses its socket entirely on iOS. `onCatchUp`
 *    therefore also runs when the tab becomes visible again, throttled so that
 *    a user flicking between apps doesn't hammer the server.
 */

export type RealtimeChannelOptions = {
  /** Channel name. Include the scoping id so two screens never collide. */
  name: string;
  /** Attach `.on(...)` handlers. Called once per subscribe; must return the
   *  channel so the builder can be written as a fluent chain. */
  build: (channel: RealtimeChannel) => RealtimeChannel;
  /**
   * Re-read whatever this screen shows. Called on first subscribe, on every
   * resubscribe after an error, and on focus/visibility resume. This is the
   * missed-event safety net, so it must be a full read, not a delta applied to
   * possibly-stale state.
   */
  onCatchUp?: () => void;
  /** Minimum gap between focus/visibility-driven catch-ups. */
  focusThrottleMs?: number;
  /** Set false to keep the channel torn down (e.g. no user id yet). */
  enabled?: boolean;
  /** Label used in the console when a subscription fails. */
  label?: string;
  /** Passed straight to `supabase.channel(name, options)` — e.g. the chat
   *  thread's `{ config: { broadcast: { self: false } } }`, which stops a typing
   *  broadcast from echoing back to its own sender. */
  channelOptions?: Parameters<ReturnType<typeof createClient>["channel"]>[1];
};

const DEFAULT_FOCUS_THROTTLE_MS = 5_000;

export function useRealtimeChannel({
  name,
  build,
  onCatchUp,
  focusThrottleMs = DEFAULT_FOCUS_THROTTLE_MS,
  enabled = true,
  label = name,
  channelOptions,
}: RealtimeChannelOptions) {
  // The builder and the catch-up callback are almost always inline closures, so
  // they change identity on every render. Holding them in refs keeps the
  // subscribe effect keyed on `name` alone — otherwise the channel would be
  // torn down and rebuilt on every parent re-render, which is both a socket
  // storm and a fresh window for missed events.
  const buildRef = useRef(build);
  const catchUpRef = useRef(onCatchUp);
  const lastCatchUpAt = useRef(0);
  const optionsRef = useRef(channelOptions);

  // Written in an effect rather than during render: React Compiler (enabled in
  // this repo) treats a ref write in the render body as an error, since it is
  // not idempotent under re-render. Running after every commit is soon enough —
  // the only readers are the subscribe callback and the event handlers, all of
  // which fire after mount.
  useEffect(() => {
    buildRef.current = build;
    catchUpRef.current = onCatchUp;
    optionsRef.current = channelOptions;
  });
  /** Exposed so callers can `.send()` broadcasts (the typing indicator). Null
   *  until the channel is subscribed, and nulled again on teardown. */
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const runCatchUp = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastCatchUpAt.current < focusThrottleMs) return;
      lastCatchUpAt.current = now;
      catchUpRef.current?.();
    };

    const supabase = createClient();
    let cancelled = false;
    // Lives in the effect closure, not a ref: the cleanup below closes over
    // this exact binding, so whatever the async body assigns is visible to it.
    let channel: RealtimeChannel | null = null;
    /** True once we've seen an error, so the next SUBSCRIBED means "recovered"
     *  and must force a catch-up regardless of the focus throttle. */
    let recovering = false;

    (async () => {
      await ensureRealtimeAuth(supabase);
      if (cancelled) return;

      channel = buildRef.current(
        optionsRef.current
          ? supabase.channel(name, optionsRef.current)
          : supabase.channel(name)
      ).subscribe(
        (status, err) => {
          if (status === "SUBSCRIBED") {
            // First subscribe or a recovery: either way this is the moment the
            // stream is live again, and anything that happened before it is
            // only recoverable by re-reading.
            runCatchUp(recovering);
            recovering = false;
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || err) {
            recovering = true;
            console.error(`[realtime] ${label} subscription failed`, status, err);
          }
        }
      );
      channelRef.current = channel;
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") runCatchUp(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
    // `build`/`onCatchUp`/`channelOptions` are intentionally excluded — see the refs above.
  }, [name, enabled, focusThrottleMs, label]);

  return channelRef;
}

/**
 * Focus/visibility refresh WITHOUT a realtime channel, for screens where a
 * campus-wide subscription would be the wrong shape (the home feed, community
 * lists). Same throttle semantics as the hook above.
 */
export function useVisibilityRefresh(
  refresh: () => void,
  {
    throttleMs = DEFAULT_FOCUS_THROTTLE_MS,
    onMount = true,
    enabled = true,
  }: { throttleMs?: number; onMount?: boolean; enabled?: boolean } = {}
) {
  const refreshRef = useRef(refresh);
  const lastRunAt = useRef(0);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    if (!enabled) return;

    const run = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastRunAt.current < throttleMs) return;
      lastRunAt.current = now;
      refreshRef.current();
    };

    // Mounting IS a resume for these screens: the Client Cache can replay a
    // page payload from before the user left (Next 16 reuses page segments on
    // back/forward navigation), so "we just rendered" is not evidence that the
    // data is current.
    if (onMount) run(true);

    const onVisible = () => {
      if (document.visibilityState === "visible") run(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [throttleMs, onMount, enabled]);
}
