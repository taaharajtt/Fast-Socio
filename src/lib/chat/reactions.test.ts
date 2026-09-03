import { describe, expect, it } from "vitest";
import {
  aggregateReactions,
  applyReactionToggle,
  groupReactionsByMessage,
  hasMyReaction,
} from "@/lib/chat/reactions";

const ME = "me";

describe("aggregateReactions", () => {
  it("returns nothing for an absent or empty list", () => {
    expect(aggregateReactions(undefined, ME)).toEqual([]);
    expect(aggregateReactions([], ME)).toEqual([]);
  });

  it("counts per emoji and flags the caller's own", () => {
    const chips = aggregateReactions(
      [
        { emoji: "❤️", user_id: "a" },
        { emoji: "❤️", user_id: ME },
        { emoji: "🔥", user_id: "b" },
      ],
      ME
    );
    expect(chips).toEqual([
      { emoji: "❤️", count: 2, mine: true },
      { emoji: "🔥", count: 1, mine: false },
    ]);
  });

  it("orders the most-used emoji first", () => {
    const chips = aggregateReactions(
      [
        { emoji: "👍", user_id: "a" },
        { emoji: "😂", user_id: "b" },
        { emoji: "😂", user_id: "c" },
      ],
      ME
    );
    expect(chips.map((c) => c.emoji)).toEqual(["😂", "👍"]);
  });
});

describe("applyReactionToggle", () => {
  it("adds my reaction to an unreacted message", () => {
    expect(applyReactionToggle([], ME, "🔥")).toEqual([
      { emoji: "🔥", user_id: ME },
    ]);
  });

  it("removes my reaction when I tap the same emoji again", () => {
    const list = [
      { emoji: "🔥", user_id: ME },
      { emoji: "🔥", user_id: "other" },
    ];
    expect(applyReactionToggle(list, ME, "🔥")).toEqual([
      { emoji: "🔥", user_id: "other" },
    ]);
  });

  it("REPLACES my reaction rather than adding a second one", () => {
    const list = [{ emoji: "🔥", user_id: ME }];
    expect(applyReactionToggle(list, ME, "❤️")).toEqual([
      { emoji: "❤️", user_id: ME },
    ]);
  });

  it("never disturbs anyone else's reaction", () => {
    const list = [
      { emoji: "😂", user_id: "a" },
      { emoji: "🔥", user_id: ME },
    ];
    const next = applyReactionToggle(list, ME, "👍");
    expect(next).toContainEqual({ emoji: "😂", user_id: "a" });
    expect(next.filter((r) => r.user_id === ME)).toEqual([
      { emoji: "👍", user_id: ME },
    ]);
  });

  it("treats an absent list as empty", () => {
    expect(applyReactionToggle(undefined, ME, "🙏")).toEqual([
      { emoji: "🙏", user_id: ME },
    ]);
  });
});

describe("hasMyReaction", () => {
  it("is true only for my own matching emoji", () => {
    const list = [
      { emoji: "❤️", user_id: "other" },
      { emoji: "🔥", user_id: ME },
    ];
    expect(hasMyReaction(list, ME, "🔥")).toBe(true);
    expect(hasMyReaction(list, ME, "❤️")).toBe(false);
    expect(hasMyReaction(undefined, ME, "🔥")).toBe(false);
  });
});

describe("groupReactionsByMessage", () => {
  it("groups rows by message id", () => {
    const grouped = groupReactionsByMessage([
      { message_id: "m1", emoji: "🔥", user_id: "a" },
      { message_id: "m1", emoji: "❤️", user_id: "b" },
      { message_id: "m2", emoji: "👍", user_id: "a" },
    ]);
    expect(grouped.m1).toHaveLength(2);
    expect(grouped.m2).toEqual([{ emoji: "👍", user_id: "a" }]);
  });

  it("represents an asked-about message with no reactions as an EMPTY list", () => {
    // Otherwise a refresh after the last reaction was removed leaves the stale
    // chip on screen, because the key is simply missing from the update.
    const grouped = groupReactionsByMessage([], ["m1", "m2"]);
    expect(grouped).toEqual({ m1: [], m2: [] });
  });

  it("tolerates a null read", () => {
    expect(groupReactionsByMessage(null, ["m1"])).toEqual({ m1: [] });
  });
});
