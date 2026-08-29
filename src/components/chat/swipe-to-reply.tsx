"use client";

import { useRef, useState } from "react";
import { Reply } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How far the FINGER must travel, in the row's own direction, before the reply
 * is armed.
 *
 * Measured on the raw pointer delta, not on the damped offset the row is drawn
 * at. Those are not the same distance, and the difference is what made an
 * OUTGOING message feel impossible to reply to: an own bubble sits against the
 * right edge, so the finger has only the bubble's own width of room before it
 * runs out of screen — and arming off the damped offset silently demanded
 * 1/0.7 = ~80px of real travel to get there.
 */
const TRIGGER_PX = 48;
/** Horizontal travel that turns a press into a drag rather than a scroll. */
const START_PX = 8;
/** The row never slides further than this, however far the finger goes. */
const MAX_PX = 84;

/**
 * WhatsApp/Instagram swipe-to-reply.
 *
 * Wraps one message row. A press that then travels in the row's own direction
 * drags it with the finger; past `TRIGGER_PX` the reply indicator locks in, and
 * releasing there sets the message as the composer's reply target. Anything
 * that reads as a vertical scroll (|dy| >= |dx|) hands the gesture back to the
 * list, and a press that never moves is left alone entirely — the thread's own
 * long-press still opens the message action sheet.
 *
 * THE DIRECTION MIRRORS THE BUBBLE. An incoming message is swiped RIGHT, away
 * from the left edge it hangs off; an outgoing one is swiped LEFT, away from
 * the right edge. Each bubble is therefore dragged into the empty half of the
 * row rather than into the wall it is already against, which is both where the
 * room is and the direction the hand expects for that side.
 *
 * Pointer events, not touch events: the same code path drives a finger and a
 * mouse, so the gesture is exercisable with a pointer in tests and on desktop.
 */
export function SwipeToReply({
  onReply,
  direction = "right",
  disabled = false,
  className,
  children,
}: {
  onReply: () => void;
  /** Which way this row is dragged: "right" for incoming, "left" for own. */
  direction?: "left" | "right";
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  /** Raw finger travel, which is what the trigger is measured against. */
  const [travel, setTravel] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  // Set once the gesture is committed to being horizontal, so a drag that began
  // as a scroll cannot be re-interpreted halfway through.
  const claimed = useRef(false);

  function reset() {
    start.current = null;
    claimed.current = false;
    setDragging(false);
    setOffset(0);
    setTravel(0);
  }

  if (disabled) return <>{children}</>;

  // +1 drags right, -1 drags left. `travel` is always the POSITIVE distance
  // along that axis, so every threshold below reads the same for both sides.
  const sign = direction === "left" ? -1 : 1;
  const armed = travel >= TRIGGER_PX;

  return (
    <div
      className={cn("relative", className)}
      // pan-y: the browser keeps vertical scrolling; horizontal is ours.
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || e.pointerId !== s.id) return;
        // Signed so that "forwards" always means this row's own direction.
        const dx = (e.clientX - s.x) * sign;
        const dy = e.clientY - s.y;
        if (!claimed.current) {
          if (Math.abs(dx) < START_PX) return;
          // Backwards along this row's axis, or mostly vertical: that is a
          // scroll (or the other side's gesture), not a reply.
          if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
            start.current = null;
            return;
          }
          claimed.current = true;
          setDragging(true);
          // Capture keeps the drag alive if the finger leaves the row. It is
          // not load-bearing — it throws for a pointer the element never
          // captured — so a failure must not abort the gesture.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Ignore: the drag still tracks through the element's own events.
          }
        }
        // Rubber-banded: the row keeps responding past the trigger without
        // sliding the whole bubble off its own column. The DRAWN offset is
        // damped; the ARMING distance above is not.
        setTravel(dx);
        setOffset(sign * Math.min(MAX_PX, dx * 0.7));
      }}
      onPointerUp={() => {
        const fired = claimed.current && travel >= TRIGGER_PX;
        reset();
        if (fired) onReply();
      }}
      onPointerCancel={reset}
    >
      {/* The affordance sits behind the row, on the edge the bubble is being
          dragged away from, and is revealed by the drag. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 flex items-center transition-opacity",
          direction === "left" ? "right-0" : "left-0",
          travel > 0 ? "opacity-100" : "opacity-0"
        )}
      >
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
            armed ? "bg-accent text-white" : "bg-fill text-fg-muted"
          )}
          style={{ transform: `scale(${Math.min(1, travel / TRIGGER_PX)})` }}
        >
          {/* Mirrored on the outgoing side so the arrow points the way the
              bubble is travelling. */}
          <Reply
            className={cn("h-4 w-4", direction === "left" && "-scale-x-100")}
          />
        </span>
      </span>

      <div
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        className={dragging ? undefined : "transition-transform duration-200"}
      >
        {children}
      </div>
    </div>
  );
}
