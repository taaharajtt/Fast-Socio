"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  aggregateReactions,
  applyReactionToggle,
  groupReactionsByMessage,
  type MessageReaction,
  type ReactionChip,
} from "@/lib/chat/reactions";

/**
 * Reaction state for one conversation: optimistic on tap, authoritative on
 * refresh.
 *
 * WHY EVERY SURFACE SHARES THIS. The Messages thread already had the shape —
 * predict my own toggle immediately, reconcile from a real read — and each of
 * the other three would otherwise have re-derived it, badly, because the
 * interesting cases are not the happy path:
 *
 *  * A message that had its LAST reaction removed must come back as an empty
 *    list, not a missing key, or the chip never disappears (see
 *    `groupReactionsByMessage`).
 *  * An optimistic bubble has no server row, so it cannot carry a reaction —
 *    tapping one is dropped rather than sent under a `temp-` id.
 *  * A failed toggle must re-read rather than un-apply, because the truth may
 *    have moved for other reasons in the meantime.
 *
 * The table and the RPC differ per surface, so both are injected. Everything
 * else is identical.
 */
export function useReactionMap({
  meId,
  initial = {},
  load,
  toggle,
  onError,
}: {
  meId: string;
  initial?: Record<string, MessageReaction[]>;
  /** Authoritative read for a set of message ids. */
  load: (ids: string[]) => Promise<
    { message_id: string; emoji: string; user_id: string }[]
  >;
  /** The surface's toggle RPC. Resolves false when the server refused. */
  toggle: (messageId: string, emoji: string) => Promise<boolean>;
  onError?: (message: string) => void;
}) {
  const [reactions, setReactions] =
    useState<Record<string, MessageReaction[]>>(initial);

  // Callbacks are inline closures at the call site; holding them in a ref keeps
  // `refresh`/`react` stable so they can be depended on by realtime effects
  // without resubscribing the socket on every render.
  const loadRef = useRef(load);
  const toggleRef = useRef(toggle);
  const errorRef = useRef(onError);
  // Written in an effect, never during render: a render-phase ref write is a
  // Rules-of-React violation and makes the React Compiler bail on this hook.
  useEffect(() => {
    loadRef.current = load;
    toggleRef.current = toggle;
    errorRef.current = onError;
  });

  /** Re-read the reactions for these messages and replace them wholesale. */
  const refresh = useCallback(async (ids: string[]) => {
    const real = ids.filter((id) => !id.startsWith("temp-"));
    if (real.length === 0) return;
    try {
      const rows = await loadRef.current(real);
      const next = groupReactionsByMessage(rows, real);
      setReactions((prev) => ({ ...prev, ...next }));
    } catch {
      // Leave what is on screen; the next event or resume tries again.
    }
  }, []);

  const react = useCallback(async (messageId: string, emoji: string) => {
    // Still sending — there is no server row to attach a reaction to.
    if (messageId.startsWith("temp-")) return;
    setReactions((prev) => ({
      ...prev,
      [messageId]: applyReactionToggle(prev[messageId], meId, emoji),
    }));
    const ok = await toggleRef.current(messageId, emoji);
    if (!ok) {
      errorRef.current?.("Couldn't save that reaction.");
      refresh([messageId]);
    }
  }, [meId, refresh]);

  const chipsFor = useCallback(
    (messageId: string): ReactionChip[] =>
      aggregateReactions(reactions[messageId], meId),
    [reactions, meId]
  );

  return { reactions, setReactions, react, refresh, chipsFor };
}
