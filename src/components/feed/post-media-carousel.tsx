"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import {
  clampSlideIndex,
  slideFit,
  slideLabel,
  viewportAspect,
  type CarouselLayout,
  type PostMedia,
} from "@/lib/feed/media";

const SLIDE_SIZES = "(max-width: 448px) 100vw, 448px";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The viewer's motion preference, read as an external store rather than mirrored
 * into state by an effect — the media query IS the source of truth, and
 * subscribing to it avoids a render pass that only exists to copy it.
 * `getServerSnapshot` returns false so the server and the first client render
 * agree; a viewer who prefers reduced motion gets it from the first update.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  );
}

/**
 * A post's images, as one swipeable viewport.
 *
 * Kept out of PostCard deliberately — the card already owns likes, comments,
 * sharing, editing, deletion, reporting and the double-tap gesture, and a
 * carousel is its own interaction model with its own keyboard and scroll
 * behaviour. It is also reused by every surface that shows a post.
 *
 * THE VIEWPORT RATIO IS KNOWN BEFORE PAINT. It comes from the stored ratio of
 * slide 1 (uniform) or is a flat square (mixed) — never from a decoded image's
 * natural size. That is the whole reason the ratio is persisted: a container
 * sized on `onLoad` reflows the entire feed underneath the reader.
 *
 * Native scroll snapping does the swiping. There is no carousel library, no
 * transform track and no cloned slides: the DOM is exactly N images in order,
 * which is also what makes the accessibility story simple.
 */
export function PostMediaCarousel({
  media,
  layout,
  priority = false,
  alt = "Post image",
  className,
}: {
  media: readonly PostMedia[];
  layout: CarouselLayout;
  /** Above-the-fold: eager-loads SLIDE 1 ONLY. Later slides always lazy-load. */
  priority?: boolean;
  alt?: string;
  className?: string;
}) {
  const total = media.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  // Pointer position at press, so a swipe can be told apart from a tap below.
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const scrollFrame = useRef<number | null>(null);

  const isCarousel = total > 1;
  const aspect = viewportAspect(media, layout);
  const fit = slideFit(layout);

  const syncActive = useCallback(() => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    const next = clampSlideIndex(Math.round(el.scrollLeft / el.clientWidth), total);
    setActive((prev) => (prev === next ? prev : next));
  }, [total]);

  /** Coalesce a scroll burst into one measurement per frame. */
  const onScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      syncActive();
    });
  }, [syncActive]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    },
    []
  );

  const goTo = useCallback(
    (index: number) => {
      const el = trackRef.current;
      if (!el) return;
      const next = clampSlideIndex(index, total);
      el.scrollTo({
        left: next * el.clientWidth,
        behavior: reducedMotion ? "auto" : "smooth",
      });
      setActive(next);
    },
    [total, reducedMotion]
  );

  // A rotation change (or any resize) leaves the scroll offset pointing between
  // slides, because the offset is in pixels and the slide width just changed.
  // Re-pin it to the active slide instead of letting the carousel drift.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !isCarousel || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth || el.clientWidth === 0) return;
      lastWidth = el.clientWidth;
      el.scrollLeft = active * el.clientWidth;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, isCarousel]);

  if (total === 0) return null;

  return (
    <div
      className={cn(
        "relative mt-3 w-full overflow-hidden rounded-[14px]",
        // Mixed mode letterboxes/pillarboxes against the app's own background
        // token, so the padding follows the theme instead of a baked-in colour
        // — and nothing padded is ever uploaded.
        layout === "mixed" && "bg-bg",
        className
      )}
      style={{ aspectRatio: aspect }}
    >
      <div
        ref={trackRef}
        onScroll={isCarousel ? onScroll : undefined}
        onPointerDown={(e) => {
          pressAt.current = { x: e.clientX, y: e.clientY };
        }}
        // A swipe ends in a click on the image. Without this, dragging through
        // a carousel would feed taps to the card's double-tap-to-like handler
        // and silently like posts the reader was only browsing.
        onClickCapture={(e) => {
          const start = pressAt.current;
          pressAt.current = null;
          if (!start) return;
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        onKeyDown={
          isCarousel
            ? (e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                e.stopPropagation();
                goTo(active + (e.key === "ArrowRight" ? 1 : -1));
              }
            : undefined
        }
        tabIndex={isCarousel ? 0 : undefined}
        role={isCarousel ? "group" : undefined}
        aria-roledescription={isCarousel ? "carousel" : undefined}
        aria-label={isCarousel ? `Post images, ${total} total` : undefined}
        className={cn(
          "no-scrollbar focus-ring flex h-full w-full",
          // Native snapping, and overscroll contained so reaching the last
          // slide never chains into the page (or a browser back-swipe).
          // Scrolling stays `auto` in CSS: `goTo` passes the behaviour it wants
          // (and honours prefers-reduced-motion), while the resize re-pin below
          // sets scrollLeft directly and must not animate.
          isCarousel && "snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        )}
      >
        {media.map((item, index) => (
          <div
            key={`${item.url}-${index}`}
            role={isCarousel ? "group" : undefined}
            aria-roledescription={isCarousel ? "slide" : undefined}
            aria-label={isCarousel ? slideLabel(index, total) : undefined}
            aria-current={isCarousel ? index === active : undefined}
            className="relative h-full w-full shrink-0 snap-center"
          >
            <AppImage
              src={item.url}
              alt={isCarousel ? `${alt} — ${slideLabel(index, total)}` : alt}
              sizes={SLIDE_SIZES}
              fit={fit}
              draggable={false}
              // Only the very first slide of an above-the-fold post is worth
              // preloading; the rest are one swipe away at best.
              priority={priority && index === 0}
            />
          </div>
        ))}
      </div>

      {isCarousel && (
        <>
          {/* Announced on change; the arrows and dots are labelled separately. */}
          <span aria-live="polite" className="sr-only">
            {slideLabel(active, total)}
          </span>

          <CarouselArrow
            side="left"
            disabled={active === 0}
            onClick={() => goTo(active - 1)}
          />
          <CarouselArrow
            side="right"
            disabled={active === total - 1}
            onClick={() => goTo(active + 1)}
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-full px-2 py-1">
              {media.map((item, index) => (
                <button
                  key={`dot-${item.url}-${index}`}
                  type="button"
                  aria-label={slideLabel(index, total)}
                  aria-current={index === active}
                  onClick={() => goTo(index)}
                  // 20px hit box around a 6px dot: a real touch target without
                  // six visible chips crowding the bottom of the photo.
                  className="flex h-5 w-5 items-center justify-center"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-[6px] w-[6px] rounded-full transition-opacity",
                      index === active
                        ? "bg-white opacity-100"
                        : "bg-white opacity-45"
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Previous / next. Subtle on a touch-first card by design, but a real focusable
 * button so pointer and keyboard users are not left with swiping as the only
 * way through a post.
 */
function CarouselArrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous image" : "Next image"}
      className={cn(
        "focus-ring absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
        "bg-black/25 text-white backdrop-blur-sm transition-opacity",
        // At an end the control stays in the layout but stops being reachable,
        // so the row of dots never jumps sideways as slides change.
        disabled ? "pointer-events-none opacity-0" : "opacity-90",
        side === "left" ? "left-2" : "right-2"
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}
