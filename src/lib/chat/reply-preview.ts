/**
 * One line of text standing in for a quoted message, whatever it holds.
 *
 * Pure and outside the component so the fallbacks — a deleted target, an
 * attachment with no body, a message that could not be loaded at all — are
 * testable, since each of them is a case where the quote would otherwise
 * render as an empty strip.
 */
export type QuotablePreview = {
  body: string | null;
  attachment_type: "image" | "voice" | null;
  shared_post_id: string | null;
  deleted_at: string | null;
};

export function replyPreviewText(
  preview: QuotablePreview | null | undefined
): string {
  if (!preview) return "Original message unavailable";
  if (preview.deleted_at) return "This message was deleted";
  if (preview.body?.trim()) return preview.body.trim();
  if (preview.attachment_type === "image") return "📷 Photo";
  if (preview.attachment_type === "voice") return "🎤 Voice message";
  if (preview.shared_post_id) return "🔗 Shared post";
  return "Message";
}
