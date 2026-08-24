import { describe, expect, it } from "vitest";
import {
  mentionsToPlainText,
  parseMentions,
  serializeMentions,
} from "@/lib/mentions";

/**
 * Editing a post that already contains tags: the draft shows readable
 * "@username" text, and saving must re-tokenise the handles the post already
 * had — otherwise every edit would silently demote its tags to plain text.
 * This is the exact sequence post-card runs.
 */
function editRoundTrip(storedBody: string, draftEdit: (plain: string) => string) {
  const plain = mentionsToPlainText(storedBody);
  const known: Record<string, string> = {};
  for (const part of parseMentions(storedBody)) {
    if (part.type === "mention") known[part.username.toLowerCase()] = part.id;
  }
  return serializeMentions(draftEdit(plain).trim(), known);
}

const UID = "3f6b1c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const UID2 = "11111111-2222-4333-8444-555555555555";

describe("post edit preserves mentions", () => {
  it("keeps a tag intact when the surrounding text changes", () => {
    const stored = `great work @[i240733](${UID}) today`;
    const out = editRoundTrip(stored, (p) => p.replace("today", "tonight"));
    expect(out).toBe(`great work @[i240733](${UID}) tonight`);
  });

  it("is a no-op when nothing is edited", () => {
    const stored = `hi @[i240733](${UID})`;
    expect(editRoundTrip(stored, (p) => p)).toBe(stored);
  });

  it("keeps multiple tags", () => {
    const stored = `@[i240733](${UID}) and @[i245525](${UID2}) ship it`;
    expect(editRoundTrip(stored, (p) => p + "!")).toBe(stored + "!");
  });

  it("drops a tag the author deleted from the text", () => {
    const stored = `bye @[i240733](${UID})`;
    const out = editRoundTrip(stored, (p) => p.replace(" @i240733", ""));
    expect(out).toBe("bye");
  });

  it("does not invent a tag for an unconfirmed handle typed during the edit", () => {
    const stored = `hey @[i240733](${UID})`;
    const out = editRoundTrip(stored, (p) => p + " and @i999999");
    expect(out).toBe(`hey @[i240733](${UID}) and @i999999`);
  });

  it("shows readable text in the draft, never raw markup", () => {
    expect(mentionsToPlainText(`yo @[i240733](${UID})`)).toBe("yo @i240733");
  });
});
