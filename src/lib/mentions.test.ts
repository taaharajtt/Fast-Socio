import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  mentionsToPlainText,
  mentionToken,
  parseMentions,
  serializeMentions,
} from "./mentions";

const ID = "3f6b1a2c-0000-4000-8000-000000000001";

describe("activeMentionQuery", () => {
  it("detects a mention the caret sits in", () => {
    const text = "hey @usm";
    expect(activeMentionQuery(text, text.length)).toEqual({
      start: 4,
      query: "usm",
    });
  });

  it("detects a bare @ at the start", () => {
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("does not trigger inside an email", () => {
    const text = "mail me at a@b";
    expect(activeMentionQuery(text, text.length)).toBeNull();
  });

  it("ends the query at whitespace", () => {
    const text = "@usm done";
    expect(activeMentionQuery(text, text.length)).toBeNull();
  });
});

describe("serializeMentions", () => {
  it("tokenises only confirmed picks, leaving typed handles as text", () => {
    const out = serializeMentions("hi @i240733 and @random", {
      i240733: ID,
    });
    expect(out).toBe(`hi ${mentionToken("i240733", ID)} and @random`);
  });

  it("is case-insensitive on the handle but stores lowercase", () => {
    expect(serializeMentions("yo @I240733", { i240733: ID })).toBe(
      `yo ${mentionToken("i240733", ID)}`
    );
  });
});

describe("parseMentions", () => {
  it("splits text and tokens in order", () => {
    const body = `hi ${mentionToken("i240733", ID)}!`;
    expect(parseMentions(body)).toEqual([
      { type: "text", value: "hi " },
      { type: "mention", username: "i240733", id: ID },
      { type: "text", value: "!" },
    ]);
  });

  it("returns a lone text part when there are no mentions", () => {
    expect(parseMentions("plain comment")).toEqual([
      { type: "text", value: "plain comment" },
    ]);
  });
});

describe("mentionsToPlainText", () => {
  it("flattens tokens back to @username", () => {
    const body = `ping ${mentionToken("i240733", ID)} now`;
    expect(mentionsToPlainText(body)).toBe("ping @i240733 now");
  });
});
