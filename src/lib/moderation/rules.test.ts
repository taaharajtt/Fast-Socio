import { describe, expect, it } from "vitest";
import { scoreContent } from "./rules";

describe("scoreContent", () => {
  it("passes clean content", () => {
    const r = scoreContent("Anyone up for lunch at the cafeteria at 1pm?");
    expect(r.action).toBe("allow");
    expect(r.score).toBeLessThanOrEqual(20);
  });

  it("blocks severe language", () => {
    const r = scoreContent("kys you loser");
    expect(r.score).toBeGreaterThanOrEqual(71);
    expect(r.action).toBe("block");
    expect(r.rules).toContain("severe_language");
  });

  it("flags link spam with shorteners", () => {
    const r = scoreContent(
      "check this http://bit.ly/x and http://tinyurl.com/y and http://t.co/z"
    );
    expect(r.rules).toContain("many_links");
    expect(r.rules).toContain("shortener_link");
    expect(r.score).toBeGreaterThanOrEqual(41);
  });

  it("escalates on duplicate/flood context", () => {
    const base = scoreContent("buy now");
    const dup = scoreContent("buy now", { isDuplicate: true, isFlooding: true });
    expect(dup.score).toBeGreaterThan(base.score);
    expect(dup.rules).toContain("duplicate");
    expect(dup.rules).toContain("flood");
  });

  it("catches excessive mentions", () => {
    const r = scoreContent("@a @b @c @d @e @f @g @h come here");
    expect(r.rules).toContain("excessive_mentions");
  });

  it("clamps score to 0–100", () => {
    const r = scoreContent(
      "kys fuck shit bitch http://bit.ly/a http://bit.ly/b http://bit.ly/c",
      { isDuplicate: true, isFlooding: true }
    );
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});
