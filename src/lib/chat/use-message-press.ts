"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The Messages thread's per-message gesture set, extracted so every
 * conversation surface gets the SAME one instead of inventing its own.
 *
 * Three gestures share one pointer stream and they interfere by nature, which
 * is why this is not three independent handlers:
 *
 *  * LONG PRESS (450ms) opens the action sheet — but a press that TRAVELS is a
 *    swipe or a scroll, not a long press, so movement past 8px cancels it.
 *    Without that, the action sheet stole every "hold, then slide" — which is
 *    exactly the gesture swipe-to-reply asks for.
 *  * DOUBLE TAP likes the message. It must beat the single tap, so the single
 *    tap is deferred by 360ms and cancelled when a second tap lands.
 *  * SINGLE TAP reveals that message's exact time, once the double-tap window
 *    has closed — otherwise every like flashes a timestamp on its way through.
 *
 * Right-click maps to the long press, so the action sheet is reachable with a
 * mouse and in tests.
 *
 * Returns `{}` when disabled, so a deleted or still-sending message is inert
 * rather than half-interactive.
 */

/** Travel (px) past which a press is a drag, not a press. */
const MOVE_TOLERANCE_PX = 8;
const LONG_PRESS_MS = 450;
const DOUBLE_TAP_MS = 350;
/** How long a single tap waits to see whether it is really half a double tap. */
const TAP_SETTLE_MS = 360;

export type MessagePressHandlers = {
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerLeave?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
};

export function useMessagePress({
  onLongPress,
  onDoubleTap,
  onTap,
  disabled = false,
}: {
  onLongPress?: (id: string) => void;
  onDoubleTap?: (id: string) => void;
  onTap?: (id: string) => void;
  disabled?: boolean;
}): (id: string) => MessagePressHandlers {
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);

  // Held in refs so a parent re-render (every keystroke, every incoming
  // message) does not hand every row a brand-new handler object.
  const longPressRef = useRef(onLongPress);
  const doubleTapRef = useRef(onDoubleTap);
  const tapRef = useRef(onTap);
  useEffect(() => {
    longPressRef.current = onLongPress;
    doubleTapRef.current = onDoubleTap;
    tapRef.current = onTap;
  });

  useEffect(
    () => () => {
      if (longPress.current) clearTimeout(longPress.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
    },
    []
  );

  return useCallback(
    (id: string): MessagePressHandlers => {
      if (disabled) return {};

      const cancelLongPress = () => {
        if (longPress.current) clearTimeout(longPress.current);
        longPress.current = null;
      };

      return {
        onPointerDown: (e: React.PointerEvent) => {
          pressOrigin.current = { x: e.clientX, y: e.clientY };
          cancelLongPress();
          longPress.current = setTimeout(
            () => longPressRef.current?.(id),
            LONG_PRESS_MS
          );
        },
        onPointerMove: (e: React.PointerEvent) => {
          const o = pressOrigin.current;
          if (!o || !longPress.current) return;
          if (
            Math.abs(e.clientX - o.x) > MOVE_TOLERANCE_PX ||
            Math.abs(e.clientY - o.y) > MOVE_TOLERANCE_PX
          ) {
            cancelLongPress();
          }
        },
        onPointerUp: (e: React.PointerEvent) => {
          const origin = pressOrigin.current;
          pressOrigin.current = null;
          cancelLongPress();
          const moved =
            !origin ||
            Math.abs(e.clientX - origin.x) > MOVE_TOLERANCE_PX ||
            Math.abs(e.clientY - origin.y) > MOVE_TOLERANCE_PX;
          if (moved) {
            lastTap.current = null;
            return;
          }
          const now = Date.now();
          const prev = lastTap.current;
          if (prev && prev.id === id && now - prev.at < DOUBLE_TAP_MS) {
            lastTap.current = null;
            if (tapTimer.current) clearTimeout(tapTimer.current);
            tapTimer.current = null;
            doubleTapRef.current?.(id);
            return;
          }
          lastTap.current = { id, at: now };
          if (tapTimer.current) clearTimeout(tapTimer.current);
          tapTimer.current = setTimeout(() => {
            tapTimer.current = null;
            tapRef.current?.(id);
          }, TAP_SETTLE_MS);
        },
        onPointerLeave: () => {
          pressOrigin.current = null;
          cancelLongPress();
        },
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          longPressRef.current?.(id);
        },
      };
    },
    [disabled]
  );
}
