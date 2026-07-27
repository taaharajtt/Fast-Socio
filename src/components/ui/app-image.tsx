"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { supabaseLoader } from "@/lib/image-loader";

/** Once a src has finished loading in this tab, treat it as warm: skip the
 *  placeholder + fade entirely on any later mount of the same URL (revisited
 *  page, an avatar repeated in a list, swapping tabs) instead of replaying the
 *  same reveal every time for an image the browser already has cached. */
const warmSrcs = new Set<string>();

/** Dev-only: warn about a slow-loading image so regressions are visible
 *  without opening the network tab. Never logs a full signed URL — those
 *  carry a bearer token — only its shape and expiry. */
function logSlowLoad(src: string, sizes: string, durationMs: number) {
  if (process.env.NODE_ENV !== "development" || durationMs < 700) return;
  const isSigned = src.includes("/object/sign/");
  const kind = isSigned
    ? "signed"
    : src.includes("/storage/v1/object/public/")
      ? "public-storage"
      : /^https?:\/\//.test(src)
        ? "external"
        : "local";
  console.warn(
    `[AppImage] slow load (${Math.round(durationMs)}ms)`,
    { kind, sizes, src: isSigned ? src.split("?")[0] : src }
  );
}

/**
 * Progressive image (audit C2, perf pass). Fills its (positioned, sized)
 * parent and streams a WebP/AVIF render via the Supabase loader. A tinted
 * placeholder covers the load, but only until the FIRST time a given src
 * finishes loading — after that (or if the browser serves it from cache fast
 * enough to already be warm) it appears immediately instead of replaying a
 * fade on every mount. The parent must be `relative` and give the box its
 * dimensions.
 */
export function AppImage({
  src,
  alt,
  sizes,
  className,
  priority,
  fetchPriority,
  draggable,
  onNaturalSize,
}: {
  src: string;
  alt: string;
  /** Responsive hint, e.g. "40px" or "(max-width:448px) 100vw, 448px". */
  sizes: string;
  className?: string;
  /** Above-the-fold hero/cover/avatar images: eager-loads and preloads. */
  priority?: boolean;
  /** Overrides the browser's fetch priority hint; defaults to "high" when
   *  `priority` is set, otherwise left to the browser. */
  fetchPriority?: "high" | "low" | "auto";
  draggable?: boolean;
  /** Fires once, with the underlying <img>'s real pixel size, as it loads. */
  onNaturalSize?: (size: { width: number; height: number }) => void;
}) {
  const [loaded, setLoaded] = useState(() => warmSrcs.has(src));
  // Captured in an effect (not during render): performance.now() is an impure
  // call, and this only needs to be "close enough to mount" for a dev-only
  // slow-load warning, not a precise render-time measurement.
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    startedAt.current = performance.now();
  }, [src]);

  return (
    <>
      {!loaded && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-bg-elevated"
        />
      )}
      <Image
        loader={supabaseLoader}
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        fetchPriority={fetchPriority ?? (priority ? "high" : undefined)}
        draggable={draggable}
        onLoad={(e) => {
          if (startedAt.current != null) {
            logSlowLoad(src, sizes, performance.now() - startedAt.current);
          }
          warmSrcs.add(src);
          setLoaded(true);
          const { naturalWidth, naturalHeight } = e.currentTarget;
          if (onNaturalSize && naturalWidth > 0 && naturalHeight > 0) {
            onNaturalSize({ width: naturalWidth, height: naturalHeight });
          }
        }}
        className={cn(
          "object-cover transition-opacity",
          loaded ? "duration-0 opacity-100" : "duration-150 opacity-0",
          className
        )}
      />
    </>
  );
}
