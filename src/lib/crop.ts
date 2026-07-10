/**
 * Geometry + canvas export for the image cropper (UAT-008).
 *
 * The cropper models the image as a "cover" fit inside a fixed frame: at
 * zoom = 1 the image is exactly large enough that no gap can appear on either
 * axis, and zooming in only ever crops further. That invariant is what lets the
 * pan clamp be a simple interval, and guarantees the exported crop is always
 * fully covered by real pixels.
 */

export type Size = { width: number; height: number };
export type Offset = { x: number; y: number };

/** Largest edge of the exported image; keeps uploads light on mobile data. */
export const MAX_EXPORT_EDGE = 1440;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Scale at which `natural` exactly covers `frame` (no letterboxing). */
export function coverScale(natural: Size, frame: Size): number {
  if (!natural.width || !natural.height) return 1;
  return Math.max(frame.width / natural.width, frame.height / natural.height);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp a pan offset so the frame stays entirely inside the scaled image.
 *
 * Offsets are the image's top-left corner relative to the frame's, so they run
 * from `frame - displayed` (image pushed left/up as far as it goes) to 0. When
 * the scaled image exactly matches the frame on an axis, the only legal offset
 * is 0 and the interval collapses — hence the Math.min guard, without which a
 * sub-pixel rounding error would invert the interval and NaN the clamp.
 */
export function clampOffset(
  offset: Offset,
  natural: Size,
  frame: Size,
  scale: number
): Offset {
  const displayedWidth = natural.width * scale;
  const displayedHeight = natural.height * scale;
  const minX = Math.min(frame.width - displayedWidth, 0);
  const minY = Math.min(frame.height - displayedHeight, 0);
  return {
    x: clamp(offset.x, minX, 0),
    y: clamp(offset.y, minY, 0),
  };
}

/** The source rectangle, in the image's own pixel space, currently framed. */
export function sourceRect(
  offset: Offset,
  frame: Size,
  scale: number
): { sx: number; sy: number; sw: number; sh: number } {
  return {
    sx: -offset.x / scale,
    sy: -offset.y / scale,
    sw: frame.width / scale,
    sh: frame.height / scale,
  };
}

/** Export dimensions for a crop of `sw`x`sh`, capped at MAX_EXPORT_EDGE. */
export function exportSize(sw: number, sh: number): Size {
  const factor = Math.min(1, MAX_EXPORT_EDGE / Math.max(sw, sh));
  return {
    width: Math.max(1, Math.round(sw * factor)),
    height: Math.max(1, Math.round(sh * factor)),
  };
}

/**
 * Draw the framed region to a canvas and encode it. PNG sources with alpha are
 * kept as PNG; everything else becomes JPEG, which is dramatically smaller for
 * photographs.
 */
export async function renderCrop(
  image: CanvasImageSource,
  offset: Offset,
  frame: Size,
  scale: number,
  mimeType: string
): Promise<Blob> {
  const { sx, sy, sw, sh } = sourceRect(offset, frame, scale);
  const out = exportSize(sw, sh);

  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, out.width, out.height);

  const type = mimeType === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, 0.9)
  );
  if (!blob) throw new Error("Could not process the image.");
  return blob;
}

/** File extension matching what renderCrop() will emit for `mimeType`. */
export function croppedExtension(mimeType: string): string {
  return mimeType === "image/png" ? "png" : "jpg";
}
