"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  canLoadEarlier,
  oldestServerCursor,
  restoredScrollTop,
  type HistoryStatus,
} from "@/lib/chat/history";
import {
  mergeMessages,
  type MergeableMessage,
  type MessageCursor,
} from "@/lib/chat/message-merge";

/**
 * Paged history for a conversation surface, including the scroll compensation
 * that makes it not feel like a jump.
 *
 * The three community surfaces have identical thread mechanics — the same
 * `listRef`, the same `mergeMessages`, the same auto-scroll rule — so the
 * paging lives here once rather than three times. The surface keeps owning its
 * message state (it has a dozen other reasons to mutate it); this hook only
 * ever prepends.
 *
 * WHAT THE CALLER MUST DO, and there is exactly one thing: pass
 * `suppressAutoScroll` into its auto-scroll effect and bail when it is true.
 * That effect keys on `messages.length`, so a prepend of ten rows wakes it, and
 * a reader sitting at the bottom (which is where they are, since prepending
 * does not move them) would be smooth-scrolled to the newest message — undoing
 * the compensation and landing them exactly where they did not ask to be.
 */

export type UseMessageHistory = {
  /** What the capsule should render. `exhausted` means render nothing. */
  status: HistoryStatus;
  /** Press handler for the capsule. Safe to call repeatedly. */
  loadEarlier: () => void;
  /** True while a prepend is settling — the caller's auto-scroll must stand down. */
  suppressAutoScroll: boolean;
};

export function useMessageHistory<T extends MergeableMessage>({
  messages,
  setMessages,
  listRef,
  hasMore: initialHasMore,
  enabled = true,
  fetchPage,
}: {
  messages: T[];
  setMessages: React.Dispatch<React.SetStateAction<T[]>>;
  /** The scrolling container. Its height is measured across the prepend. */
  listRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the server said older rows exist beyond the first page. */
  hasMore: boolean;
  /**
   * Off for the surfaces this feature deliberately does not apply to —
   * Discover team rooms — which keep their single unpaged load.
   */
  enabled?: boolean;
  fetchPage: (
    cursor: MessageCursor
  ) => Promise<{ messages: T[]; hasMore: boolean }>;
}): UseMessageHistory {
  const [status, setStatus] = useState<HistoryStatus>(() =>
    enabled && initialHasMore ? "idle" : "exhausted"
  );

  /**
   * The in-flight guard.
   *
   * A ref and NOT the `status` state, because that is the whole point: two taps
   * inside one frame both read the state from the render they were dispatched
   * in, so both would see "idle" and both would fetch. A ref is written
   * synchronously and the second tap sees it.
   */
  const inFlight = useRef(false);

  /**
   * Measurements taken in the click handler, applied in the layout effect.
   * `null` when no prepend is settling.
   */
  const pending = useRef<{ scrollTop: number; scrollHeight: number } | null>(
    null
  );
  const [settling, setSettling] = useState(false);

  /**
   * Restore the reader's position, BEFORE the browser paints.
   *
   * useLayoutEffect, not useEffect: the prepended rows are in the DOM and laid
   * out by the time this runs, but nothing has been painted yet, so the reader
   * never sees the intermediate frame where the content grew above them and
   * their message shot down the screen.
   */
  useLayoutEffect(() => {
    const before = pending.current;
    const el = listRef.current;
    if (!before || !el) return;
    pending.current = null;
    el.scrollTop = restoredScrollTop({
      scrollTopBefore: before.scrollTop,
      scrollHeightBefore: before.scrollHeight,
      scrollHeightAfter: el.scrollHeight,
    });
    // Released on a timer rather than here: the auto-scroll effect this is
    // holding off runs in the same commit, and images inside the prepended
    // rows can settle a frame or two later and wake it again.
    const t = setTimeout(() => setSettling(false), 120);
    return () => clearTimeout(t);
  }, [messages, listRef]);

  const loadEarlier = useCallback(() => {
    const cursor = oldestServerCursor(messages);
    if (
      !enabled ||
      !canLoadEarlier({ status, inFlight: inFlight.current, cursor }) ||
      !cursor
    ) {
      return;
    }

    inFlight.current = true;
    setStatus("loading");
    setSettling(true);

    // Measured NOW, before the fetch resolves and React commits new rows.
    const el = listRef.current;
    pending.current = el
      ? { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
      : null;

    void (async () => {
      try {
        const page = await fetchPage(cursor);
        // mergeMessages dedupes by id and re-sorts, so a row that also arrived
        // over the socket while this was in flight lands once and in order.
        setMessages((prev) => mergeMessages(prev, page.messages));
        setStatus(page.hasMore ? "idle" : "exhausted");
      } catch {
        // The reader keeps what they have and the capsule offers a retry —
        // never an empty thread or a silent no-op.
        setStatus("error");
        pending.current = null;
        setSettling(false);
      } finally {
        inFlight.current = false;
      }
    })();
  }, [enabled, status, messages, setMessages, listRef, fetchPage]);

  return { status, loadEarlier, suppressAutoScroll: settling };
}
