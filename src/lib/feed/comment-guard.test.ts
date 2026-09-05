import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  COMMENT_LIMITS,
  isDuplicateComment,
  isFloodingComments,
  normalizeCommentText,
  postCapExceeded,
  userPostCapExceeded,
  commentLimitMessage,
  COMMENT_LIMIT_MESSAGES,
  GENERIC_COMMENT_ERROR,
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

  it("frees a slot once the oldest comment ages out of the ROLLING HOUR", () => {
    const w = createBurstWindow(COMMENT_LIMITS.perPostWindow);
    for (let i = 0; i < 5; i++) w.attempt(i * 1000);
    expect(w.attempt(5_000).status).toBe("limited");
    // An hour after the first attempt, one slot is back (mig 0193 widened the
    // window from 10 minutes to 60 and the database agrees).
    expect(w.attempt(3_600_001).status).toBe("allowed");
    expect(COMMENT_LIMITS.perPostWindow.windowSeconds).toBe(3600);
    expect(COMMENT_LIMITS.perPostWindow.max).toBe(5);
  });

  it("enforces a 30-second cooldown between comments on the same post", () => {
    const c = createBurstWindow(COMMENT_LIMITS.perPostCooldown);
    expect(c.attempt(0).status).toBe("allowed");

    const soon = c.attempt(29_000);
    expect(soon.status).toBe("limited");
    if (soon.status === "limited") expect(soon.retryAfterSeconds).toBe(1);

    expect(c.attempt(30_001).status).toBe("allowed");
    expect(COMMENT_LIMITS.perPostCooldown.windowSeconds).toBe(30);
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
  it("closes a post at 30 comments", () => {
    expect(COMMENT_LIMITS.perPostCap).toBe(30);
    expect(postCapExceeded(29)).toBe(false);
    expect(postCapExceeded(30)).toBe(true);
    expect(postCapExceeded(31)).toBe(true);
  });

  it("treats a post that is ALREADY over the cap as full, not as wrapped", () => {
    // Posts from before migration 0193 may hold more than 30. Nothing deletes
    // them; they simply take no new comments.
    expect(postCapExceeded(120)).toBe(true);
  });

  it("caps one user at 10 existing comments on a post", () => {
    expect(COMMENT_LIMITS.perUserPostCap).toBe(10);
    expect(userPostCapExceeded(9)).toBe(false);
    expect(userPostCapExceeded(10)).toBe(true);
  });

  it("leaves room for other people even when one user is at their cap", () => {
    // The reason a shared cap is safe to switch on: 10 of 30 is the most any
    // single account can consume, so no one person can close a thread.
    expect(COMMENT_LIMITS.perUserPostCap).toBeLessThan(
      COMMENT_LIMITS.perPostCap as number
    );
  });
});

describe("database error mapping", () => {
  const CASES: [string, string][] = [
    ["comment_cooldown", "Please wait 30 seconds before commenting on this post again."],
    ["comment_hourly_limit", "You can only post 5 comments per hour on the same post."],
    ["comment_user_post_limit", "You've reached your limit of 10 comments on this post."],
    ["comment_post_full", "This post has reached its limit of 30 comments."],
  ];

  for (const [token, message] of CASES) {
    it(`maps ${token} to its message`, () => {
      expect(commentLimitMessage(token)).toBe(message);
      // PostgREST wraps the token in a longer sentence; the mapping must still
      // find it rather than falling through to the generic line.
      expect(
        commentLimitMessage(`new row for relation "post_comments": ${token}`)
      ).toBe(message);
    });
  }

  it("never leaks a raw PostgreSQL error", () => {
    const raw =
      'duplicate key value violates unique constraint "post_comments_pkey"';
    expect(commentLimitMessage(raw)).toBe(GENERIC_COMMENT_ERROR);
    expect(commentLimitMessage(raw)).not.toContain("constraint");
    expect(commentLimitMessage(null)).toBe(GENERIC_COMMENT_ERROR);
    expect(commentLimitMessage(undefined)).toBe(GENERIC_COMMENT_ERROR);
  });
});

describe("the app numbers match the database", () => {
  // The migration is authoritative; these assert the mirror has not drifted.
  const MIGRATION = readFileSync(
    join(process.cwd(), "supabase/migrations/0193_comment_spam_limits.sql"),
    "utf8"
  );

  it("uses the same four thresholds", () => {
    expect(MIGRATION).toContain("interval '30 seconds'");
    expect(MIGRATION).toContain("v_hour >= 5");
    expect(MIGRATION).toContain("v_mine >= 10");
    expect(MIGRATION).toContain("v_total >= 30");
  });

  it("raises exactly the tokens the app maps", () => {
    for (const token of Object.keys(COMMENT_LIMIT_MESSAGES)) {
      expect(MIGRATION).toContain(`raise exception '${token}'`);
    }
  });

  it("runs BEFORE INSERT, so nothing downstream fires on a rejection", () => {
    expect(MIGRATION).toContain("before insert on public.post_comments");
  });

  it("serialises on the post", () => {
    expect(MIGRATION).toContain("pg_advisory_xact_lock");
  });
});
