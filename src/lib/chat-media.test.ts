import { describe, it, expect } from "vitest";
import { chatMediaPath, isChatMediaPathFor } from "./chat-media";

const CONV = "214b92d1-fb16-45de-98cf-8b948215aa51";
const base = "https://skgphoupbwdexfevgcnn.supabase.co";

describe("chatMediaPath (P5-01)", () => {
  it("extracts the path from a legacy public URL", () => {
    expect(
      chatMediaPath(`${base}/storage/v1/object/public/chat-media/${CONV}/a.webm`)
    ).toBe(`${CONV}/a.webm`);
  });
  it("passes through a bare path", () => {
    expect(chatMediaPath(`${CONV}/a.webm`)).toBe(`${CONV}/a.webm`);
    expect(chatMediaPath(`/${CONV}/a.webm`)).toBe(`${CONV}/a.webm`);
  });
  it("returns null for nullish", () => {
    expect(chatMediaPath(null)).toBe(null);
    expect(chatMediaPath(undefined)).toBe(null);
  });
});

describe("isChatMediaPathFor (P5-01)", () => {
  it("accepts a well-formed path inside the conversation", () => {
    expect(isChatMediaPathFor(`${CONV}/a.webm`, CONV)).toBe(true);
  });
  it("rejects paths for a different conversation", () => {
    expect(isChatMediaPathFor(`other-conv/a.webm`, CONV)).toBe(false);
  });
  it("rejects traversal / absolute / malformed", () => {
    expect(isChatMediaPathFor(`${CONV}/../x`, CONV)).toBe(false);
    expect(isChatMediaPathFor(`/${CONV}/a.webm`, CONV)).toBe(false);
    expect(isChatMediaPathFor(`${CONV}/a/b.webm`, CONV)).toBe(false);
    expect(isChatMediaPathFor(`${CONV}/`, CONV)).toBe(false);
    expect(isChatMediaPathFor("", CONV)).toBe(false);
  });
});
