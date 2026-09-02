import { describe, expect, it } from "vitest";
import {
  emptyComposerDraft,
  resetComposerDraft,
  resolveAnonymity,
} from "@/lib/feed/composer-state";

/**
 * UAT-13. A post becoming anonymous when nobody asked for it is not a cosmetic
 * bug: anonymity is irreversible for ordinary viewers, so these cases are the
 * guarantee that only an explicit `true` can produce one.
 */
describe("composer anonymity default", () => {
  it("starts explicitly attributed, not merely unset", () => {
    // `false`, not `undefined`. A missing key is what lets a truthiness check
    // downstream flip the meaning.
    expect(emptyComposerDraft().isAnonymous).toBe(false);
    expect(Object.hasOwn(emptyComposerDraft(), "isAnonymous")).toBe(true);
  });

  it("resets to attributed after a post, so the next one does not inherit it", () => {
    expect(resetComposerDraft().isAnonymous).toBe(false);
  });

  it("clears the body and attachments with it", () => {
    const d = resetComposerDraft();
    expect(d.body).toBe("");
    expect(d.imageUrl).toBeNull();
    expect(d.pollOptions).toBeNull();
  });
});

describe("resolveAnonymity", () => {
  it("makes a post anonymous only for a literal true", () => {
    expect(resolveAnonymity(true)).toBe(true);
  });

  it("treats every non-true value as attributed", () => {
    // "false" and "0" are TRUTHY strings — the exact pair a `if (value)` check
    // gets wrong, and the reason this is a function rather than a cast.
    for (const value of [
      false,
      undefined,
      null,
      0,
      1,
      "",
      "false",
      "0",
      "true",
      "on",
      {},
    ]) {
      expect(resolveAnonymity(value), `${String(value)} must not be anonymous`).toBe(
        false
      );
    }
  });

  it("forces attribution for community posts even when true is requested", () => {
    // The composer hides the toggle there, but the flag is client-supplied, so
    // the rule has to hold when the client lies.
    expect(resolveAnonymity(true, "community-1")).toBe(false);
  });

  it("leaves campus-feed posts alone when no community is given", () => {
    expect(resolveAnonymity(true, null)).toBe(true);
    expect(resolveAnonymity(true, undefined)).toBe(true);
  });
});
