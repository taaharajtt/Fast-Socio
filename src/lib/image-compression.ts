/**
 * Universal client-side image compression: scales any image blob down to a
 * 1080p-ish longest edge and re-encodes it, so a 10-20MB 4K phone photo never
 * hits Supabase Storage at full size. Runs alongside the cropper (which caps
 * its own exports at MAX_EXPORT_EDGE, see crop.ts) for every OTHER image path
 * — avatars, community/society covers, chat attachments, uncropped uploads.
 */
export async function compressImageTo1080p(
  file: File | Blob,
  maxDimension: number = 1080,
  quality: number = 0.88
): Promise<Blob> {
  const hasAlpha = await sourceHasAlpha(file);
  const bitmap = await loadBitmap(file);

  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file instanceof Blob ? file : new Blob([file]);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const type = hasAlpha ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality)
    );
    return blob ?? file;
  } finally {
    if ("close" in bitmap) bitmap.close();
  }
}

async function loadBitmap(file: File | Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** True if the source is a PNG/WebP/GIF that may carry real transparency. */
async function sourceHasAlpha(file: File | Blob): Promise<boolean> {
  const type = "type" in file ? file.type : "";
  return type === "image/png" || type === "image/webp" || type === "image/gif";
}
