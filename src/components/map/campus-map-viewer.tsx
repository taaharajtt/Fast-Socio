"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PLACE_TYPE_META,
  DEFAULT_PLACE_ICON,
  type CampusPlace,
} from "@/lib/map/places";

/** Keep a number within [min, max]. */
const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max);

const ZOOM_STEP = 1.4;
/** How far past the fit scale a user may zoom in (relative to fit). */
const MAX_ZOOM_FACTOR = 5;
/** Zoom applied (relative to fit) when focusing a selected place. */
const FOCUS_ZOOM_FACTOR = 1.9;
const EPS = 0.001;

type Size = { w: number; h: number };
type Point = { x: number; y: number };

/**
 * Campus Map viewer (v2) — a CSS-transform image inspector (deliberately not a
 * GIS/map library). It renders `public/map.png` at its **natural pixel size**
 * via a plain <img> so zooming reveals real detail instead of an upscaled,
 * already-compressed render. Scaling is done purely with a CSS transform.
 *
 * Fit model: the initial view is a *cover* fit — the larger of the width- and
 * height-fit ratios — so the map fills the viewer with no letterboxing. That
 * fit scale is also the **minimum** zoom; you can zoom in and pan the overflow
 * but never below fit. Reset and Fit both return to it.
 *
 * v2 adds place pins: they live INSIDE the transformed layer (positioned by the
 * dataset's x/y percentages) so they stay glued to the map, and each pin
 * counter-scales by 1/scale so its marker stays a constant, readable size at
 * any zoom. Selecting a place (from a pin or the search list) centers + zooms
 * to it.
 */
export function CampusMapViewer({
  className,
  places,
  selectedId,
  onSelectPlace,
  focusSignal,
  controlsBottomInset = 0,
  activeCounts = {},
}: {
  className?: string;
  places: CampusPlace[];
  selectedId: string | null;
  onSelectPlace: (id: string) => void;
  /** Bump to re-center the current selection even if selectedId is unchanged. */
  focusSignal: number;
  /** Extra px to lift the zoom controls (e.g. to clear the detail card). */
  controlsBottomInset?: number;
  /** Open Sports plan count per place id — shown as a small badge on the pin. */
  activeCounts?: Record<string, number>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<Size>({ w: 0, h: 0 });
  const [natural, setNatural] = useState<Size | null>(null);
  const [scale, setScale] = useState(0); // 0 until fit is known
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // Cover fit: fill the viewer on the tighter axis, overflow (pannable) on the
  // other. Falls back to 1 until both sizes are measured.
  const fitScale = useMemo(() => {
    if (!natural || !container.w || !container.h) return 1;
    return Math.max(container.w / natural.w, container.h / natural.h);
  }, [natural, container]);
  const maxScale = Math.max(1, fitScale * MAX_ZOOM_FACTOR);

  /** Clamp a candidate pan so the image edges can't leave the viewport. */
  const clampPan = useCallback(
    (p: Point, s: number): Point => {
      if (!natural) return { x: 0, y: 0 };
      const maxX = Math.max(0, (natural.w * s - container.w) / 2);
      const maxY = Math.max(0, (natural.h * s - container.h) / 2);
      return { x: clamp(p.x, -maxX, maxX), y: clamp(p.y, -maxY, maxY) };
    },
    [natural, container]
  );

  // Measure the container and keep it live across rotation / dock reflow.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setContainer({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reconcile scale whenever the fit changes (first load, resize, rotation):
  // initialise to fit, otherwise preserve the user's relative zoom but never
  // let it fall below the new fit.
  const prevFit = useRef(0);
  useEffect(() => {
    if (!natural || !container.w) return;
    setScale((prev) => {
      const next =
        prev === 0
          ? fitScale
          : fitScale * Math.max(1, prevFit.current ? prev / prevFit.current : 1);
      return clamp(next, fitScale, maxScale);
    });
    prevFit.current = fitScale;
  }, [fitScale, maxScale, natural, container.w]);

  const zoomTo = useCallback(
    (next: number) => {
      const s = clamp(next, fitScale, maxScale);
      setScale(s);
      setPan((p) => clampPan(p, s));
    },
    [fitScale, maxScale, clampPan]
  );

  const resetToFit = useCallback(() => {
    setScale(fitScale);
    setPan({ x: 0, y: 0 });
  }, [fitScale]);

  // Center + zoom to a place. Screen offset of an image-fraction point from the
  // container center is `pan + scale * (fraction - 0.5) * naturalSize`; solving
  // for pan == 0 gives the pan that puts the point dead center (then clamped).
  const focusOnPlace = useCallback(
    (place: CampusPlace) => {
      if (!natural || !container.w) return;
      const s = clamp(fitScale * FOCUS_ZOOM_FACTOR, fitScale, maxScale);
      const target: Point = {
        x: -s * (place.x / 100 - 0.5) * natural.w,
        y: -s * (place.y / 100 - 0.5) * natural.h,
      };
      setScale(s);
      setPan(clampPan(target, s));
    },
    [natural, container.w, fitScale, maxScale, clampPan]
  );

  // Focus the selected place whenever the selection (or an explicit re-focus
  // signal) changes. This is a deliberate imperative sync — a user gesture
  // (pin/search select) drives an animated recenter — so the state update here
  // is intended, not a render-derived cascade.
  useEffect(() => {
    const place = places.find((p) => p.id === selectedId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- imperative focus on selection change
    if (place) focusOnPlace(place);
  }, [selectedId, focusSignal, places, focusOnPlace]);

  // ── Pointer gestures ──────────────────────────────────────────────────────
  const pointers = useRef<Map<number, Point>>(new Map());
  const lastPinchDist = useRef<number | null>(null);
  const dragStart = useRef<{ pointer: Point; pan: Point } | null>(null);
  // Capture is engaged on the first move (not on down) so a tap on a pin still
  // fires its click instead of being swallowed by pointer capture.
  const capturedPointer = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) {
        dragStart.current = { pointer: { x: e.clientX, y: e.clientY }, pan };
      } else {
        dragStart.current = null; // second finger → pinch, cancel the pan
        lastPinchDist.current = null;
      }
    },
    [pan]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.current.values()];

      if (pts.length >= 2) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (lastPinchDist.current != null) {
          zoomTo(scale * (dist / lastPinchDist.current));
        }
        lastPinchDist.current = dist;
        return;
      }

      if (dragStart.current) {
        const dx = e.clientX - dragStart.current.pointer.x;
        const dy = e.clientY - dragStart.current.pointer.y;
        // Start capturing (and showing the grab cursor) only once the pointer
        // has actually moved, so a stationary tap on a pin still registers.
        if (capturedPointer.current == null && Math.hypot(dx, dy) > 3) {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          capturedPointer.current = e.pointerId;
          setDragging(true);
        }
        if (capturedPointer.current != null) {
          setPan(
            clampPan(
              {
                x: dragStart.current.pan.x + dx,
                y: dragStart.current.pan.y + dy,
              },
              scale
            )
          );
        }
      }
    },
    [clampPan, scale, zoomTo]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (capturedPointer.current === e.pointerId) capturedPointer.current = null;
    if (pointers.current.size < 2) lastPinchDist.current = null;
    if (pointers.current.size === 0) {
      dragStart.current = null;
      setDragging(false);
    }
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      zoomTo(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    [scale, zoomTo]
  );

  const canZoomIn = scale < maxScale - EPS;
  const canZoomOut = scale > fitScale + EPS;

  // Clamp pan for display so a container resize can't leave the map off-screen
  // without needing a setState-in-effect (handlers already store clamped pan).
  const effScale = scale || fitScale;
  const shownPan = clampPan(pan, effScale);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-2xl bg-bg-elevated",
        className
      )}
    >
      {/* Interaction surface. */}
      <div
        role="application"
        aria-label="FAST campus map. Drag to pan, pinch or use the zoom controls to inspect."
        className={cn(
          "absolute inset-0 touch-none select-none",
          canZoomOut ? "cursor-grab" : "cursor-default",
          dragging && "cursor-grabbing"
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() =>
          zoomTo(scale > fitScale + EPS ? fitScale : fitScale * FOCUS_ZOOM_FACTOR)
        }
      >
        {/* Transform layer: natural-sized, holds the image AND the pins so they
            pan/zoom together. */}
        <div
          className={cn(
            "absolute left-1/2 top-1/2 origin-center will-change-transform",
            !dragging && "transition-transform duration-150 ease-out"
          )}
          style={{
            width: natural ? `${natural.w}px` : undefined,
            height: natural ? `${natural.h}px` : undefined,
            transform: `translate(-50%, -50%) translate(${shownPan.x}px, ${shownPan.y}px) scale(${effScale})`,
            visibility: natural ? "visible" : "hidden",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- deliberate:
              the optimizer downscales/compresses this map and softens it; we
              want exact source pixels to scale sharply under the transform. */}
          <img
            src="/map.png"
            alt="FAST campus map"
            draggable={false}
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            style={{ display: "block", width: "100%", height: "100%", maxWidth: "none" }}
          />

          {natural &&
            places.map((place) => (
              <MapPinMarker
                key={place.id}
                place={place}
                selected={place.id === selectedId}
                invScale={1 / effScale}
                onSelect={onSelectPlace}
                activeCount={activeCounts[place.id] ?? 0}
              />
            ))}
        </div>
      </div>

      {/* Zoom controls — icon-first, large tap targets, clear of the bottom dock. */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <div
          className="pointer-events-auto absolute right-4 flex flex-col overflow-hidden rounded-full border border-white/10 bg-card/80 shadow-lg backdrop-blur transition-all"
          style={{ bottom: 16 + controlsBottomInset }}
        >
          <ControlButton
            label="Zoom in"
            onClick={() => zoomTo(scale * ZOOM_STEP)}
            disabled={!canZoomIn}
          >
            <ZoomIn className="h-5 w-5" aria-hidden />
          </ControlButton>
          <div className="h-px w-full bg-white/10" aria-hidden />
          <ControlButton
            label="Zoom out"
            onClick={() => zoomTo(scale / ZOOM_STEP)}
            disabled={!canZoomOut}
          >
            <ZoomOut className="h-5 w-5" aria-hidden />
          </ControlButton>
        </div>

        <div
          className="pointer-events-auto absolute left-4 flex flex-col overflow-hidden rounded-full border border-white/10 bg-card/80 shadow-lg backdrop-blur transition-all"
          style={{ bottom: 16 + controlsBottomInset }}
        >
          <ControlButton label="Fit map to screen" onClick={resetToFit}>
            <Maximize className="h-5 w-5" aria-hidden />
          </ControlButton>
          <div className="h-px w-full bg-white/10" aria-hidden />
          <ControlButton
            label="Reset map"
            onClick={resetToFit}
            disabled={!canZoomOut && pan.x === 0 && pan.y === 0}
          >
            <RotateCcw className="h-5 w-5" aria-hidden />
          </ControlButton>
        </div>
      </div>
    </div>
  );
}

/**
 * A single place marker: a colored dot anchored exactly on the place's
 * coordinate, with a compact label beneath it. Counter-scaled by 1/scale so it
 * stays a constant screen size at any zoom.
 */
function MapPinMarker({
  place,
  selected,
  invScale,
  onSelect,
  activeCount = 0,
}: {
  place: CampusPlace;
  selected: boolean;
  invScale: number;
  onSelect: (id: string) => void;
  /** Open Sports plans tagged to this pin — rendered as a small count badge. */
  activeCount?: number;
}) {
  const meta = PLACE_TYPE_META[place.type];
  const Icon = meta.icon ?? DEFAULT_PLACE_ICON;
  return (
    <button
      type="button"
      aria-label={`Select ${place.name}`}
      aria-pressed={selected}
      onClick={() => onSelect(place.id)}
      style={{
        left: `${place.x}%`,
        top: `${place.y}%`,
        transform: `translate(-50%, -50%) scale(${invScale})`,
        transformOrigin: "center",
        zIndex: selected ? 30 : 20,
      }}
      className="absolute flex flex-col items-center focus:outline-none"
    >
      {/* Dot (anchored on the point). */}
      <span className="relative flex items-center justify-center">
        <span
          className={cn(
            "flex items-center justify-center rounded-full border-2 border-white/90 shadow-md transition-transform",
            selected ? "h-7 w-7 ring-2 ring-white" : "h-5 w-5",
            "hover:scale-110"
          )}
          style={{ backgroundColor: meta.color }}
        >
          <Icon
            className={cn("text-white", selected ? "h-4 w-4" : "h-3 w-3")}
            strokeWidth={2.4}
            aria-hidden
          />
        </span>
        {activeCount > 0 && (
          <span
            aria-label={`${activeCount} active ${activeCount === 1 ? "game" : "games"}`}
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[9px] font-bold text-white ring-1 ring-white/80"
          >
            {activeCount}
          </span>
        )}
      </span>
      {/* Label. */}
      <span
        className={cn(
          "mt-1 max-w-[120px] truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-white shadow-sm",
          selected ? "bg-black/80" : "bg-black/55"
        )}
      >
        {place.shortLabel}
      </span>
    </button>
  );
}

function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-11 items-center justify-center text-fg transition-colors hover:bg-white/10 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {children}
    </button>
  );
}
