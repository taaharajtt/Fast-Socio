"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-screen photo viewer (fix-057).
 *
 * One viewer for every surface: DM images, and the community / chat-room /
 * Discover-room images added in fix-052. Full-bleed image on a dark backdrop,
 * pinch or scroll to zoom, drag to pan, and tap / swipe-down / Esc to close.
 *
 * Deliberately NO download and NO share button — that was the stated default.
 * The image is already on the viewer's screen; adding an explicit save affordance
 * to someone else's photo is a product decision, not a viewer feature.
 */

const MAX_SCALE = 4;
const MIN_SCALE = 1;
/** Drag this far down at rest and the viewer closes. */
const SWIPE_CLOSE_PX = 110;
/** Below this, a pointer sequence counts as a tap rather than a drag. */
const TAP_SLOP_PX = 8;

type Pt = { x: number; y: number };

export function PhotoViewer({
  open,
  onClose,
  src,
  alt = "",
  senderName,
  timestamp,
}: {
  open: boolean;
  onClose: () => void;
  src: string | null;
  alt?: string;
  /** Shown in the overlay, with the timestamp. */
  senderName?: string | null;
  /** Anything `Date` can parse, or a preformatted string. */
  timestamp?: string | null;
}) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  /** Vertical offset while swiping down to dismiss (only when not zoomed). */
  const [dismissY, setDismissY] = useState(0);
  /** True while a finger/pointer is down, so we don't animate mid-gesture. */
  const [dragging, setDragging] = useState(false);

  const pointers = useRef<Map<number, Pt>>(new Map());
  const start = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const moved = useRef(0);

  // Reset zoom/pan whenever a different image is opened, so the previous photo's
  // transform doesn't carry over. Adjusting state during render (rather than in
  // an effect) is React's documented pattern for deriving state from props, and
  // avoids the extra commit an effect would cause.
  const openKey = open && src ? src : null;
  const [seenKey, setSeenKey] = useState<string | null>(null);
  if (openKey !== seenKey) {
    setSeenKey(openKey);
    setScale(1);
    setTx(0);
    setTy(0);
    setDismissY(0);
    setDragging(false);
  }

  // Esc to close, and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // No `mounted` flag needed: the portal target only has to exist at the moment
  // we actually render, and this only opens from a user interaction.
  if (!open || !src || typeof document === "undefined") return null;

  const zoomed = scale > MIN_SCALE + 0.01;

  function clampScale(s: number) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    setDragging(true);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      start.current = null;
    } else {
      start.current = { x: e.clientX, y: e.clientY, tx, ty };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers: pinch to zoom.
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(clampScale((dist / pinchStart.current.dist) * pinchStart.current.scale));
      return;
    }

    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    moved.current = Math.max(moved.current, Math.hypot(dx, dy));

    if (zoomed) {
      // Zoomed in: drag pans the image.
      setTx(start.current.tx + dx);
      setTy(start.current.ty + dy);
    } else if (dy > 0) {
      // At rest: dragging down dismisses.
      setDismissY(dy);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) setDragging(false);

    if (!zoomed) {
      if (dismissY > SWIPE_CLOSE_PX) {
        onClose();
        return;
      }
      setDismissY(0);
      // A tap (rather than a drag) anywhere closes the viewer.
      if (moved.current < TAP_SLOP_PX) onClose();
    }
    start.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    // Scroll (and trackpad pinch, which arrives as ctrl+wheel) zooms.
    const next = clampScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    setScale(next);
    if (next <= MIN_SCALE + 0.01) {
      setTx(0);
      setTy(0);
    }
  }

  function onDoubleClick() {
    if (zoomed) {
      setScale(1);
      setTx(0);
      setTy(0);
    } else {
      setScale(2);
    }
  }

  const when = (() => {
    if (!timestamp) return null;
    const d = new Date(timestamp);
    return Number.isNaN(d.getTime())
      ? timestamp
      : d.toLocaleString(undefined, {
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        });
  })();

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={senderName ? `Photo from ${senderName}` : "Photo"}
      className="fixed inset-0 z-[100] touch-none select-none overscroll-none bg-black"
      style={{
        // Fade the backdrop out as the image is swiped away.
        opacity: zoomed ? 1 : Math.max(0.3, 1 - dismissY / (SWIPE_CLOSE_PX * 2.5)),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
    >
      {/* Close affordance, for people who won't guess at tap-to-dismiss. */}
      <button
        type="button"
        aria-label="Close photo"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>

      <div className="flex h-full w-full items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed, already-sized
            storage URL; next/image would re-proxy it and fight the zoom transform. */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={cn(
            "max-h-full max-w-full object-contain",
            // Only animate when settling, never while a finger is down.
            !dragging && "transition-transform duration-150",
            "motion-reduce:transition-none"
          )}
          style={{
            transform: `translate3d(${tx}px, ${ty + dismissY}px, 0) scale(${scale})`,
            cursor: zoomed ? "grab" : "zoom-in",
          }}
        />
      </div>

      {(senderName || when) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10">
          {senderName && (
            <p className="text-sm font-semibold text-white">{senderName}</p>
          )}
          {when && <p className="text-xs text-white/70">{when}</p>}
        </div>
      )}
    </div>,
    document.body
  );
}
