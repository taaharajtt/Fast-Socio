import { describe, expect, it } from "vitest";
import { mergeFeedPage, reconcileServerFeed } from "./merge";
import type { FeedPost } from "./types";

const post = (id: string, over: Partial<FeedPost> = {}): FeedPost => ({
  id,
  body: `post ${id}`,
  image_url: null,
  is_anonymous: false,
  like_count: 0,
  comment_count: 0,
  created_at: "2026-08-23T10:00:00.000Z",
  author_id: "a1",
  author_name: "Ali",
  author_avatar: null,
  liked_by_me: false,
  ...over,
});

describe("mergeFeedPage", () => {
  it("prepends unseen posts above what is already on screen", () => {
    const out = mergeFeedPage([post("b"), post("c")], [post("a"), post("b")]);
    expect(out.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("does not duplicate a post the list already has", () => {
    const out = mergeFeedPage([post("a")], [post("a")]);
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });

  it("refreshes counts on posts already on screen", () => {
    // Another student's like was previously invisible until a hard reload: the
    // optimistic path only ever moved the CURRENT user's own count.
    const out = mergeFeedPage(
      [post("a", { like_count: 1 })],
      [post("a", { like_count: 4, comment_count: 2 })]
    );
    expect(out[0].like_count).toBe(4);
    expect(out[0].comment_count).toBe(2);
  });

  it("picks up an edited body", () => {
    const out = mergeFeedPage(
      [post("a", { body: "before" })],
      [post("a", { body: "after", edited_at: "2026-08-23T11:00:00.000Z" })]
    );
    expect(out[0].body).toBe("after");
  });

  it("keeps array identity when nothing changed, so cards don't re-render", () => {
    const existing = [post("a")];
    expect(mergeFeedPage(existing, [post("a")])).toBe(existing);
    expect(mergeFeedPage(existing, [])).toBe(existing);
  });

  it("leaves posts absent from the fresh page untouched", () => {
    // Page 1 does not cover older posts loaded by infinite scroll.
    const older = post("z", { like_count: 7 });
    const out = mergeFeedPage([post("a"), older], [post("a")]);
    expect(out.find((p) => p.id === "z")).toBe(older);
  });
});

describe("reconcileServerFeed", () => {
  it("adopts the server payload when the client has nothing", () => {
    const server = [post("a")];
    expect(reconcileServerFeed([], server)).toBe(server);
  });

  it("folds a newer server render into client state instead of discarding it", () => {
    // <FeedList/> used to copy `initial` into state at mount and ignore the
    // prop forever, so rows from a fresh server render never reached the screen.
    const out = reconcileServerFeed([post("b")], [post("a"), post("b")]);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
