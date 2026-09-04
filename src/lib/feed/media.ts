/**
 * The one typed representation of post media, shared by the composer, the feed
 * carousel, the server action and the tests.
 *
 * A media post carries 1–5 images. Every stored image has been normalized by
 * the client cropper to exactly one of three aspect ratios, and the ratio plus
 * the pixel size are persisted alongside the URL — so a feed card knows its
 * layout BEFORE the first byte of an image arrives. Nothing here ever measures
 * a decoded image to decide a container size; that is what causes the layout
 * shift this module exists to prevent.
 *
 * Pure module on purpose: no React, no Supabase, no DOM. Both the browser and
 * the server action import it, and the server re-validates everything the
 * client claims (a server action is a public POST endpoint).
 */

/** The only aspect ratios a post image may be stored as. */
export const MEDIA_ASPECTS = ["1:1", "16:9", "9:16"] as const;
export type MediaAspect = (typeof MEDIA_ASPECTS)[number];

/** Hard ceiling on images per post — enforced in the composer, in the server
 *  action AND in the database (position < 5 plus unique(post_id, position)). */
export const MAX_POST_MEDIA = 5;

/** Post-level carousel layout. `uniform` is the default for every new post. */
export const CAROUSEL_LAYOUTS = ["uniform", "mixed"] as const;
export type CarouselLayout = (typeof CAROUSEL_LAYOUTS)[number];
export const DEFAULT_CAROUSEL_LAYOUT: CarouselLayout = "uniform";

/** Numeric width ÷ height for each stored ratio. */
export const ASPECT_VALUE: Record<MediaAspect, number> = {
  "1:1": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

/** The ratio picker offered by the cropper for post media, in display order. */
export const MEDIA_ASPECT_OPTIONS: { label: MediaAspect; value: number }[] =
  MEDIA_ASPECTS.map((label) => ({ label, value: ASPECT_VALUE[label] }));

/** One stored image on a post, in `position` order. */
export type PostMedia = {
  url: string;
  aspect: MediaAspect;
  width: number;
  height: number;
};

export function isMediaAspect(value: unknown): value is MediaAspect {
  return (
    typeof value === "string" &&
    (MEDIA_ASPECTS as readonly string[]).includes(value)
  );
}

export function isCarouselLayout(value: unknown): value is CarouselLayout {
  return (
    typeof value === "string" &&
    (CAROUSEL_LAYOUTS as readonly string[]).includes(value)
  );
}

/**
 * Snap an arbitrary width/height ratio to the closest supported ratio.
 *
 * Compared on a LOG scale, not a linear one: 9:16 (0.5625) sits 0.44 below 1:1
 * while 16:9 (1.78) sits 0.78 above it, so a linear metric would drag genuinely
 * portrait images towards square. On a log scale the two neighbours are
 * symmetric about 1:1, which is what "closest ratio" should mean.
 */
export function nearestMediaAspect(ratio: number): MediaAspect {
  if (!Number.isFinite(ratio) || ratio <= 0) return "1:1";
  let best: MediaAspect = "1:1";
  let bestDistance = Infinity;
  for (const aspect of MEDIA_ASPECTS) {
    const distance = Math.abs(Math.log(ratio / ASPECT_VALUE[aspect]));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = aspect;
    }
  }
  return best;
}

/**
 * True when a source image is already (within a hair of) a supported ratio.
 *
 * Anything else — 4:3, 3:2, 21:9, a screenshot — is a "non-standard" source, and
 * the cropper says so before the user confirms, because cropping it into a
 * supported ratio discards real pixels and that should be a decision rather
 * than a surprise.
 */
export function isStandardSourceRatio(ratio: number, tolerance = 0.02): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  return MEDIA_ASPECTS.some(
    (aspect) => Math.abs(Math.log(ratio / ASPECT_VALUE[aspect])) <= tolerance
  );
}

/** 2+ images is a carousel; exactly 1 is an ordinary single-image post. */
export function isCarousel(media: readonly PostMedia[]): boolean {
  return media.length >= 2;
}

/**
 * The immutable viewport ratio for a post's media viewport.
 *
 * `uniform`: slide 1 decides it for the whole post, so swiping can never change
 * the card's height. `mixed`: always a square canvas, with every slide
 * contained inside it.
 */
export function viewportAspect(
  media: readonly PostMedia[],
  layout: CarouselLayout
): number {
  if (layout === "mixed") return ASPECT_VALUE["1:1"];
  const first = media[0];
  return first ? ASPECT_VALUE[first.aspect] : ASPECT_VALUE["1:1"];
}

/**
 * How a slide fills the viewport. `uniform` centre-crops anything that isn't
 * slide 1's ratio (object-fit: cover); `mixed` letterboxes / pillarboxes so the
 * whole normalized image stays visible (object-fit: contain). The padding is
 * the container's own background — it is never baked into an uploaded file.
 */
export function slideFit(layout: CarouselLayout): "cover" | "contain" {
  return layout === "mixed" ? "contain" : "cover";
}

/**
 * The post's cover image: ALWAYS slide 1, never a later slide, and never the
 * mixed-mode letterboxed presentation. Falls back to a legacy `posts.image_url`
 * for every post created before carousels existed.
 */
export function coverMedia(
  media: readonly PostMedia[],
  legacyImageUrl?: string | null
): string | null {
  return media[0]?.url ?? legacyImageUrl ?? null;
}

/**
 * Coerce the `media` jsonb the feed views return into typed rows.
 *
 * Defensive by design: a row with an unknown ratio or a non-positive dimension
 * is DROPPED rather than rendered, because a bad value here would silently
 * become a wrong container size — i.e. layout shift — on every card.
 */
export function normalizePostMedia(raw: unknown): PostMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: PostMedia[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { url, aspect, width, height } = item as Record<string, unknown>;
    if (typeof url !== "string" || url.length === 0) continue;
    if (!isMediaAspect(aspect)) continue;
    if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) continue;
    if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) continue;
    out.push({ url, aspect, width, height });
    if (out.length === MAX_POST_MEDIA) break;
  }
  return out;
}

/**
 * A media item as the composer sends it to the server action. Positions are
 * implied by array order — the client never names one, so it cannot invent a
 * duplicate, a gap or a negative position.
 */
export type PostMediaInput = {
  url: string;
  aspect: string;
  width: number;
  height: number;
};

export type MediaValidation =
  | { ok: true; media: PostMedia[]; layout: CarouselLayout }
  | { ok: false; error: string };

/**
 * The server-side gate on a create-post payload's media.
 *
 * Every rule here restates something the composer already enforces, on purpose:
 * a server action is reachable by a direct POST, so the client's copy of these
 * rules is a courtesy and this one is the guarantee. `isAllowedUrl` is injected
 * so the function stays pure and testable (the real caller passes
 * `isAppStorageUrl`).
 */
export function validatePostMedia(input: {
  media: unknown;
  layout: unknown;
  hasPoll: boolean;
  isAllowedUrl: (url: string) => boolean;
}): MediaValidation {
  const { media, layout, hasPoll, isAllowedUrl } = input;

  const rawLayout = layout ?? DEFAULT_CAROUSEL_LAYOUT;
  if (!isCarouselLayout(rawLayout))
    return { ok: false, error: "Unsupported photo layout." };

  const items = media == null ? [] : media;
  if (!Array.isArray(items)) return { ok: false, error: "Invalid photos." };

  if (items.length === 0) return { ok: true, media: [], layout: rawLayout };

  if (hasPoll) return { ok: false, error: "A poll can't also carry photos." };
  if (items.length > MAX_POST_MEDIA)
    return {
      ok: false,
      error: `A post can have at most ${MAX_POST_MEDIA} photos.`,
    };

  const out: PostMedia[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object")
      return { ok: false, error: "Invalid photos." };
    const { url, aspect, width, height } = item as Record<string, unknown>;
    // Only images we host: the URL is client-supplied (P2-04).
    if (typeof url !== "string" || !isAllowedUrl(url))
      return { ok: false, error: "Invalid image." };
    if (seen.has(url))
      return { ok: false, error: "That photo is already in this post." };
    seen.add(url);
    if (!isMediaAspect(aspect))
      return { ok: false, error: "Unsupported photo shape." };
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    )
      return { ok: false, error: "Invalid photo size." };
    out.push({ url, aspect, width, height });
  }

  return { ok: true, media: out, layout: rawLayout };
}

/** Accessible name for a slide, e.g. "Image 2 of 5". */
export function slideLabel(index: number, total: number): string {
  return `Image ${index + 1} of ${total}`;
}

/**
 * Clamp a slide index into range. Every navigation path (arrows, arrow keys,
 * scroll snap, a resize that lands between slides) goes through this, so they
 * cannot disagree about where the ends are.
 */
export function clampSlideIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}
