import { describe, it, expect } from "vitest";
import {
  COMMENT_LIMITS,
  isDuplicateComment,
  isFloodingComments,
  normalizeCommentText,
  postCapExceeded,
  postScopedAction,
} from "./comment-guard";
import { createBurstWindow } from "@/lib/rate-limit-policy";

const t = (iso: string) => new Date(iso);

describe("per-post comment buckets", () => {
  it("scopes a bucket to one post, so other posts are unaffected", () => {
    const a = postScopedAction(COMMENT_LIMITS.perPostWindow, "post-1");
    const b = postScopedAction(COMMENT_LIMITS.perPostWindow, "post-2");
    expect(a).toBe("commentPost:post-1");
    expect(a).not.toBe(b);
  });

  it("allows 5 comments per 10 minutes on one post, then holds", () => {
    const w = createBurstWindow(COMMENT_LIMITS.perPostWindow);
    let now = 0;
    for (let i = 0; i < 5; i++) {
      expect(w.attempt(now).status).toBe("allowed");
      now += 20_000; // 20s apart — clears the cooldown, still inside 10 min
    }
    const sixth = w.attempt(now);
    expect(sixth.status).toBe("limited");
    if (sixth.status === "limited")
      expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("frees a slot once the oldest comment ages out of the window", () => {
    const w = createBurstWindow(COMMENT_LIMITS.perPostWindow);
    for (let i = 0; i < 5; i++) w.attempt(i * 1000);
    expect(w.attempt(5_000).status).toBe("limited");
    // 10 minutes after the first attempt, one slot is back.
    expect(w.attempt(600_001).status).toBe("allowed");
  });

  it("enforces a 15-second cooldown between comments on the same post", () => {
    const c = createBurstWindow(COMMENT_LIMITS.perPostCooldown);
    expect(c.attempt(0).status).toBe("allowed");

    const soon = c.attempt(14_000);
    expect(soon.status).toBe("limited");
    if (soon.status === "limited") expect(soon.retryAfterSeconds).toBe(1);

    expect(c.attempt(15_001).status).toBe("allowed");
  });
});

describe("duplicate comment text", () => {
  it("normalizes case, punctuation and whitespace", () => {
    expect(normalizeCommentText("  NICE!!!  post  ")).toBe("nice post");
    expect(normalizeCommentText("Nice, post.")).toBe(
      normalizeCommentText("nice post")
    );
  });

  it("rejects the same text again within 24 hours", () => {
    const recent = [{ body: "Nice post!", createdAt: t("2026-09-05T10:00:00Z") }];
    expect(
      isDuplicateComment("nice post", recent, t("2026-09-05T20:00:00Z"))
    ).toBe(true);
  });

  it("allows it again once the 24-hour window has passed", () => {
    const recent = [{ body: "Nice post!", createdAt: t("2026-09-04T09:00:00Z") }];
    expect(
      isDuplicateComment("nice post", recent, t("2026-09-05T10:00:00Z"))
    ).toBe(false);
  });

  it("does not flag genuinely different text", () => {
    const recent = [{ body: "Nice post!", createdAt: t("2026-09-05T10:00:00Z") }];
    expect(
      isDuplicateComment("congrats!", recent, t("2026-09-05T10:01:00Z"))
    ).toBe(false);
  });

  it("ignores an empty candidate rather than matching everything", () => {
    const recent = [{ body: "   ", createdAt: t("2026-09-05T10:00:00Z") }];
    expect(isDuplicateComment("!!!", recent, t("2026-09-05T10:01:00Z"))).toBe(
      false
    );
  });
});

describe("flood signal into the moderation engine", () => {
  it("is off for the first couple of comments and on for a burst", () => {
    expect(isFloodingComments(0)).toBe(false);
    expect(isFloodingComments(2)).toBe(false);
    expect(isFloodingComments(3)).toBe(true);
    expect(isFloodingComments(5)).toBe(true);
  });
});

describe("global per-post cap", () => {
  it("is deliberately not enforced yet", () => {
    expect(COMMENT_LIMITS.perPostCap).toBeNull();
    expect(postCapExceeded(1_000)).toBe(false);
  });
});
