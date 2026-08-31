"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { reportRealtimeIssue, reportRealtimeEvent } from "@/lib/realtime/telemetry";
import { pollDelayMs, shouldPoll } from "@/lib/realtime/poll-backoff";

/**
 * The one place this app subscribes to Supabase Realtime.
 *
 * Every screen used to hand-roll the same effect, and every copy shared the
 * same four defects:
 *
 * 1. CLEANUP RACE. The pattern was
 *
 *      (async () => { await getSession(); channelRef.current = supabase.channel(...) })()
 *      return () => { if (channelRef.current) supabase.removeChannel(...) }
 *
 *    Unmounting while `getSession()` was in flight — a fast tap from /chat into
 *    a thread does exactly that — left the cleanup looking at `null`, and the
 *    async body then created a channel nobody would ever remove. Here the
 *    channel handle lives in the effect's own closure, and a `cancelled` flag
 *    stops the async body creating one after teardown, so the leak is not
 *    expressible.
 *
 * 2. NO CATCH-UP. `postgres_changes` does not replay: whatever was published
 *    while the socket was down is gone. supabase-js rejoins on its own, but
 *    nothing told the app to go looking for what it missed. `onCatchUp` runs on
 *    the first SUBSCRIBED and on every resubscribe — the only moments we know
 *    the gap has closed — and on visibility/focus/online, which are the moments
 *    a socket may have died without ever reporting an error.
 *
 * 3. NO FALLBACK. When the channel simply cannot be established (a proxy that
 *    eats WebSockets, an outage), the screen froze until a manual reload. It
 *    now polls `onCatchUp` on a bounded backoff, and stops the instant realtime
 *    returns. See poll-backoff.ts for why the schedule widens.
 *
 * 4. RESUBSCRIBE STORMS. `build`/`onCatchUp` are inline closures at every call
 *    site, so an effect keyed on them tore the socket down and rebuilt it on
 *    every parent re-render — a fresh window for missed events on every
 *    keystroke. They are held in refs; the effect is keyed on `name` alone.
 *
 * AUTH IS DELIBERATELY ABSENT. The old code called
 * `supabase.realtime.setAuth(session.access_token)` before every subscribe.
 * That is not just redundant on @supabase/supabase-js 2.110 — it is
 * counterproductive. `SupabaseClient` passes an `accessToken` CALLBACK into
 * `RealtimeClient` (dist/index.mjs), which is invoked on connect and again on
 * reconnect, and it forwards TOKEN_REFRESHED/SIGNED_IN to `realtime.setAuth`
 * automatically. Meanwhile `RealtimeClient.setAuth(token)` with an explicit
 * argument sets `_manuallySetToken`, and its docstring is explicit that the
 * callback "will not be invoked until setAuth() is called without arguments" —
 * i.e. the manual call PINS a token and opts out of the client's own refresh
 * path. So this hook sets no token at all and lets the client do its job.
 */

export type RealtimeChannelOptions = {
  /** Channel name, scoping id included, so two screens never collide. */
  name: string;
  /** Attach `.on(...)` handlers. Must return the channel, so the call site can
   *  be written as a fluent chain. Called once per subscribe. */
  build: (channel: RealtimeChannel) => RealtimeChannel;
  /**
   * Re-read whatever this screen shows, authoritatively. Called on first
   * subscribe, on every resubscribe, on visibility/focus resume, on `online`,
   * and from the polling fallback. Because it is the missed-event safety net it
   * must be a full read against the server — never a delta applied to state
   * that may itself be stale.
   */
  onCatchUp?: () => void;
  /** Minimum gap between focus/visibility-driven catch-ups. */
  focusThrottleMs?: number;
  /** Set false to keep the channel torn down (e.g. no user id yet). */
  enabled?: boolean;
  /** Static, id-free label for telemetry. NEVER interpolate an id into this. */
  label?: string;
  /** Passed to `supabase.channel(name, options)` — e.g. the chat thread's
   *  `{ config: { broadcast: { self: false } } }`. */
  channelOptions?: Parameters<ReturnType<typeof createClient>["channel"]>[1];
  /** Fallback polling while the channel is not subscribed. On by default; pass
   *  false for channels where a missed event costs nothing. */
  poll?: boolean;
};

const DEFAULT_FOCUS_THROTTLE_MS = 5_000;

/**
 * @returns a ref holding the live channel, for call sites that need to `.send()`
 * a broadcast (the typing indicator). Null before subscribe and after teardown.
 */
export function useRealtimeChannel({
  name,
  build,
  onCatchUp,
  focusThrottleMs = DEFAULT_FOCUS_THROTTLE_MS,
  enabled = true,
  label = "realtime channel",
  channelOptions,
  poll = true,
}: RealtimeChannelOptions) {
  const buildRef = useRef(build);
  const catchUpRef = useRef(onCatchUp);
  const optionsRef = useRef(channelOptions);
  const lastCatchUpAt = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Written in an effect rather than during render: the React Compiler (enabled
  // in this repo) rejects a render-phase ref write, and every reader of these
  // refs — the subscribe callback, the event handlers, the timers — runs after
  // commit anyway.
  useEffect(() => {
    buildRef.current = build;
    catchUpRef.current = onCatchUp;
    optionsRef.current = channelOptions;
  });

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let cancelled = false;
    // In the effect closure, not a ref: the cleanup below closes over this
    // exact binding, so whatever the async body assigns is always visible to it.
    let channel: RealtimeChannel | null = null;
    let subscribed = false;
    /** Set once the channel has failed, so the next SUBSCRIBED is a RECOVERY
     *  and must catch up regardless of the focus throttle. */
    let recovering = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollAttempt = 0;

    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const runCatchUp = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastCatchUpAt.current < focusThrottleMs) return;
      lastCatchUpAt.current = now;
      catchUpRef.current?.();
    };

    const stopPolling = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      pollAttempt = 0;
    };

    /**
     * Fallback polling. The conditions are re-evaluated on every tick rather
     * than only at start, so a tab hidden mid-outage stops polling on its own
     * and a recovered channel cancels the schedule at the next boundary as well
     * as immediately, via `stopPolling` in the SUBSCRIBED branch.
     */
    const schedulePoll = () => {
      if (!poll || cancelled) return;
      if (pollTimer) return;
      if (!shouldPoll({ subscribed, visible: isVisible(), enabled })) return;
      pollTimer = setTimeout(() => {
        pollTimer = null;
        if (cancelled) return;
        if (!shouldPoll({ subscribed, visible: isVisible(), enabled })) {
          pollAttempt = 0;
          return;
        }
        pollAttempt += 1;
        // The fallback engaging at all means realtime is not working for this
        // client right now. Reported on the FIRST attempt only: a long outage
        // would otherwise emit on every backoff tick and drown the signal in
        // repeats of the same fact.
        if (pollAttempt === 1) reportRealtimeEvent(label, "poll-engaged");
        // A poll IS the catch-up: the same authoritative read, driven by a timer
        // instead of an event. Forced past the throttle, which exists to damp
        // user gestures rather than to skip scheduled recovery.
        runCatchUp(true);
        schedulePoll();
      }, pollDelayMs(pollAttempt));
    };

    (async () => {
      if (cancelled) return;
      const built = buildRef.current(
        optionsRef.current
          ? supabase.channel(name, optionsRef.current)
          : supabase.channel(name)
      );
      // Re-checked after the synchronous build: `subscribe` is what actually
      // opens the join, so bailing here still leaves nothing to clean up.
      if (cancelled) return;
      channel = built.subscribe((status, err) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          subscribed = true;
          stopPolling();
          // A resubscribe after a failure is the socket recovering. Counting
          // the RATE of these is the field health signal for realtime — a step
          // change means sockets have started dying, which otherwise only ever
          // surfaces as "chat feels broken sometimes" (perf audit Phase 7).
          if (recovering) reportRealtimeEvent(label, "recovered");
          // First subscribe or a recovery: either way this is the moment the
          // stream is live, and anything published before it is recoverable
          // only by re-reading. A recovery forces past the throttle.
          runCatchUp(recovering);
          recovering = false;
          return;
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED" ||
          err
        ) {
          subscribed = false;
          recovering = true;
          reportRealtimeIssue({ label, status });
          schedulePoll();
        }
      });
      channelRef.current = channel;
      // If the join never completes there is no callback to start polling, so
      // arm the schedule now; `shouldPoll` no-ops it once SUBSCRIBED lands.
      schedulePoll();
    })();

    const onResume = () => {
      if (!isVisible()) return;
      runCatchUp(false);
      schedulePoll();
    };
    /** Regaining the network is the strongest evidence there is a gap to close,
     *  so it bypasses the throttle. */
    const onOnline = () => {
      runCatchUp(true);
      schedulePoll();
    };

    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onOnline);
      channelRef.current = null;
      // The exact channel this effect created — never `channelRef.current`,
      // which a later effect may already have replaced.
      if (channel) supabase.removeChannel(channel);
    };
    // `build`/`onCatchUp`/`channelOptions` are held in refs above and are
    // intentionally not dependencies: they are inline closures at every call
    // site, and depending on them would rebuild the socket on every render.
  }, [name, enabled, focusThrottleMs, label, poll]);

  return channelRef;
}

/**
 * Focus/visibility/online refresh WITHOUT a channel, for screens where a
 * subscription would be the wrong shape, and as a companion to the hook above
 * for resumes that do NOT resubscribe (the socket survived being hidden, so no
 * SUBSCRIBED fires, but messages may still have arrived while we were away).
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

    // Mounting IS a resume here: Next 16's Client Cache reuses page segments on
    // browser back/forward (01-app/04-glossary.md, "Client Cache"), so "we just
    // rendered" is not evidence that the data on screen is current.
    if (onMount) run(true);

    const onResume = () => {
      if (document.visibilityState === "visible") run(false);
    };
    const onOnline = () => run(true);
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onOnline);
    };
  }, [throttleMs, onMount, enabled]);
}
