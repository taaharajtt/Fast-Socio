"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { supabaseLoader } from "@/lib/image-loader";

/**
 * Progressive image (audit C2). Fills its (positioned, sized) parent, streams a
 * WebP/AVIF render via the Supabase loader, and fades in over a tinted
 * placeholder so there is no flash or layout shift — the Instagram-style
 * blur-up. The parent must be `relative` and give the box its dimensions.
 */
export function AppImage({
  src,
  alt,
  sizes,
  className,
  priority,
  draggable,
}: {
  src: string;
  alt: string;
  /** Responsive hint, e.g. "40px" or "(max-width:448px) 100vw, 448px". */
  sizes: string;
  className?: string;
  priority?: boolean;
  draggable?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 bg-bg-elevated transition-opacity duration-500",
          loaded ? "opacity-0" : "animate-pulse opacity-100"
        )}
      />
      <Image
        loader={supabaseLoader}
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        draggable={draggable}
        onLoad={() => setLoaded(true)}
        className={cn(
          "object-cover transition-opacity duration-500",
          loaded ? "opacity-100" : "opacity-0",
          className
        )}
      />
    </>
  );
}
