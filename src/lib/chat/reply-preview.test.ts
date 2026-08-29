import { describe, expect, it } from "vitest";
import { replyPreviewText } from "@/lib/chat/reply-preview";

const base = {
  body: null,
  attachment_type: null,
  shared_post_id: null,
  deleted_at: null,
} as const;

describe("replyPreviewText", () => {
  it("says so when the original could not be loaded", () => {
    expect(replyPreviewText(null)).toBe("Original message unavailable");
    expect(replyPreviewText(undefined)).toBe("Original message unavailable");
  });

  it("prefers the deleted notice over any surviving content", () => {
    expect(
      replyPreviewText({ ...base, body: "hi", deleted_at: "2026-01-01" })
    ).toBe("This message was deleted");
  });

  it("uses the trimmed body when there is one", () => {
    expect(replyPreviewText({ ...base, body: "  hello  " })).toBe("hello");
  });

  it("labels attachments that carry no text", () => {
    expect(replyPreviewText({ ...base, attachment_type: "image" })).toBe("📷 Photo");
    expect(replyPreviewText({ ...base, attachment_type: "voice" })).toBe(
      "🎤 Voice message"
    );
    expect(replyPreviewText({ ...base, shared_post_id: "p1" })).toBe("🔗 Shared post");
  });

  it("falls back to a generic label for a whitespace-only body", () => {
    expect(replyPreviewText({ ...base, body: "   " })).toBe("Message");
  });
});
