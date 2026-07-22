"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clamp,
  clampOffset,
  coverScale,
  croppedExtension,
  reconcileView,
  renderCrop,
  type Offset,
  type Size,
} from "@/lib/crop";

export type CropResult = { blob: Blob; extension: string; mimeType: string };

/**
 * Full-screen crop dialog (UAT-008). Drag to reposition, pinch / scroll /
 * slider to zoom. The image is always "cover"-fitted to the frame, so the
 * exported crop can never contain empty space.
 *
 * Cropping happens before upload: storage only ever receives the final image,
 * which also caps what a full-resolution phone photo costs to store and serve.
 */
export function ImageCropper({
  file,
  aspect,
  title = "Crop photo",
  round = false,
  onCancel,
  onCropped,
}: {
  file: File;
  /** Frame width ÷ height. 1 = square, 16/9 = cover banner, 4/5 = portrait post. */
  aspect: number;
  title?: string;
  /** Draw the frame as a circle (avatars). The export is still the square crop. */
  round?: boolean;
  onCancel: () => void;
  onCropped: (result: CropResult) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [natural, setNatural] = useState<Size | null>(null);
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // Live pointer positions, keyed by pointerId, so one finger pans and two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; zoom: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; offset: Offset } | null>(null);

  // Create the preview URL *inside* the effect and revoke it in the SAME
  // cleanup, so its lifetime is bound to the effect (UAT-003). The previous
  // lazy-useState URL was revoked by an unrelated cleanup before the <img>
  // could load it — under React Strict Mode's setup→cleanup→setup in dev, and
  // under remount/PWA-resume races in prod — leaving the cropper pointed at a
  // dead blob (naturalWidth 0, Done permanently disabled). Here the strict-mode
  // teardown revokes the first URL and immediately mints a live replacement.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing an external Object URL resource to state; must run after commit
    setSrc(url);
    setLoadFailed(false);
    setNatural(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The frame fills the available width at the requested aspect, but never grows
  // past the viewport height it has to share with the header and controls.
  useEffect(() => {
    function measure() {
      const maxWidth = Math.min(window.innerWidth - 32, 420);
      const maxHeight = window.innerHeight - 240;
      let width = maxWidth;
      let height = width / aspect;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspect;
      }
      setFrame({ width: Math.round(width), height: Math.round(height) });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [aspect]);

  const base = natural && frame.width ? coverScale(natural, frame) : 1;
  const scale = base * zoom;

  const recentre = useCallback(() => {
    if (!natural || !frame.width) return;
    const s = coverScale(natural, frame) * MIN_ZOOM;
    setZoom(MIN_ZOOM);
    setOffset({
      x: (frame.width - natural.width * s) / 2,
      y: (frame.height - natural.height * s) / 2,
    });
  }, [natural, frame]);

  // Auto-centre ONCE per image, keyed on the image itself — never on the frame.
  // Mobile browsers change window.innerHeight (and therefore the frame) as their
  // dynamic toolbar shows/hides during a drag; keying the recentre on the frame
  // meant that jitter silently reset the user's zoom and pan mid-gesture, so the
  // exported crop came back as the default centred "cover" view instead of what
  // they adjusted. Centre when the image (and a measured frame) first appear;
  // afterwards, a frame change keeps the user's zoom and only re-clamps the pan.
  // This is the "adjust state during render" pattern rather than an effect: an
  // effect would paint one frame with a stale, off-centre crop.
  const imageKey = src && natural ? src : "";
  const [centeredKey, setCenteredKey] = useState("");
  const [lastFrame, setLastFrame] = useState<Size>({ width: 0, height: 0 });
  if (natural) {
    const next = reconcileView({
      imageKey,
      centeredKey,
      natural,
      frame,
      lastFrame,
      zoom,
      offset,
    });
    if (next) {
      setCenteredKey(next.centeredKey);
      setLastFrame(next.lastFrame);
      setZoom(next.zoom);
      setOffset(next.offset);
    }
  }

  /** Zoom about the frame's centre so the subject stays put. */
  const applyZoom = useCallback(
    (nextZoom: number) => {
      if (!natural || !frame.width) return;
      const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      setZoom((prev) => {
        setOffset((current) => {
          const ratio = z / prev;
          const cx = frame.width / 2;
          const cy = frame.height / 2;
          return clampOffset(
            { x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio },
            natural,
            frame,
            base * z
          );
        });
        return z;
      });
    },
    [natural, frame, base]
  );

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY, offset };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      panStart.current = null;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !natural) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.distance > 0) {
        applyZoom(gesture.current.zoom * (distance / gesture.current.distance));
      }
      return;
    }

    const start = panStart.current;
    if (!start) return;
    setOffset(
      clampOffset(
        {
          x: start.offset.x + (e.clientX - start.x),
          y: start.offset.y + (e.clientY - start.y),
        },
        natural,
        frame,
        scale
      )
    );
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 1) {
      const [only] = [...pointers.current.values()];
      panStart.current = { x: only.x, y: only.y, offset };
    } else if (pointers.current.size === 0) {
      panStart.current = null;
    }
  }

  function onWheel(e: React.WheelEvent) {
    applyZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }

  async function confirm() {
    const image = imgRef.current;
    if (!image || !natural) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await renderCrop(image, offset, frame, scale, file.type);
      onCropped({
        blob,
        extension: croppedExtension(file.type),
        mimeType: blob.type,
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex flex-col bg-black"
    >
      <header className="flex shrink-0 items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full px-3 py-2 text-sm font-medium text-white/70 disabled:opacity-40"
        >
          Cancel
        </button>
        <p className="text-sm font-semibold text-white">{title}</p>
        <button
          type="button"
          onClick={confirm}
          disabled={busy || !natural}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold text-accent disabled:opacity-40"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {busy ? "Saving…" : "Done"}
        </button>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          style={{ width: frame.width, height: frame.height }}
          className={`relative touch-none overflow-hidden bg-neutral-900 ${
            round ? "rounded-full" : "rounded-[10px]"
          }`}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const w = e.currentTarget.naturalWidth;
                const h = e.currentTarget.naturalHeight;
                if (w > 0 && h > 0) setNatural({ width: w, height: h });
                else setLoadFailed(true);
              }}
              onError={() => setLoadFailed(true)}
              style={{
                width: natural ? natural.width * scale : undefined,
                height: natural ? natural.height * scale : undefined,
                transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
              }}
              className="max-w-none origin-top-left select-none"
            />
          )}
          {loadFailed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium text-white">
                Couldn&rsquo;t load that image.
              </p>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white"
              >
                Pick another
              </button>
            </div>
          )}
          {/* Rule-of-thirds guides, drawn over the image and never exported. */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/20" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/20" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/20" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/20" />
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        {error && (
          <p role="alert" className="mb-3 text-center text-sm text-error">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => applyZoom(zoom - 0.25)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-accent"
          />
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => applyZoom(zoom + 0.25)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Reset"
            onClick={recentre}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-white/40">
          Drag to reposition · pinch or scroll to zoom
        </p>
      </div>
    </div>,
    document.body
  );
}
