import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
/** Source text with line endings NORMALISED. A Windows checkout converts
 *  LF to CRLF, so an assertion spanning a newline would pass on one
 *  machine and fail on another - which is exactly what happened when this
 *  branch was merged and the files were re-checked-out. */
const read = (rel: string) =>
  readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
/** Code only — these files explain at length what they deliberately do NOT do,
 *  and an assertion that reads the prose passes on the explanation. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const COMPOSER = code("src/components/chat/conversation-composer.tsx");
const CHAT_COMPOSER = code("src/components/chat/chat-composer.tsx");
const DM_COMPOSER = code("src/components/chat/composer-input.tsx");

/** The surfaces the paperclip was removed from. */
const COMMUNITY_SURFACES = [
  "src/components/communities/community-chat.tsx",
  "src/components/events/event-discussion.tsx",
  "src/components/societies/announcement-thread.tsx",
];

/** The Discover team room: the same <CommunityChat/> with anonymity switched
 *  off at the route, which is the only place a Discover group's composer is
 *  rendered — /communities/[id] redirects one here rather than composing it. */
const DISCOVER_ROUTE = "src/app/(student)/chat/c/[id]/page.tsx";

/**
 * WHO GETS THE PAPERCLIP.
 *
 * vitest here runs pure logic with no DOM (see vitest.config.ts), so these
 * cannot mount the composer and look for a button. What they CAN do is fail
 * the build the moment the capability wiring drifts — which is the whole
 * mechanism, because <ConversationComposer/> is the ONLY composer in the app
 * and the surfaces differ by nothing except the capabilities they ask for.
 *
 * The rule: `attach` (the paperclip, available at any draft length) is a
 * private-conversation control. Community chat rooms, event discussions and
 * society/community broadcasts keep the camera — the same picker, from an
 * empty composer — and have no paperclip.
 */
describe("the paperclip belongs to direct messages", () => {
  it("is gated on the `attach` capability, nothing else", () => {
    expect(COMPOSER).toContain("const showAttach = Boolean(capabilities.attach");
    // The old gate keyed off `media`, which every surface passed, and chose the
    // ICON by whether the surface had voice notes. Neither may come back.
    expect(COMPOSER).not.toContain("capabilities.media");
    expect(COMPOSER).not.toContain("showMedia");
    expect(COMPOSER).not.toContain("ImagePlus");
  });

  it("renders the button only under that gate", () => {
    expect(COMPOSER).toContain("{showAttach && (");
    expect(COMPOSER).toContain('aria-label="Attach image"');
  });

  it("is asked for by the DM composer and by nothing else", () => {
    expect(DM_COMPOSER).toContain("attach: true");
    expect(CHAT_COMPOSER).toContain("attach: false");
    for (const rel of COMMUNITY_SURFACES) {
      expect(code(rel)).not.toContain("attach: true");
    }
  });

  it("cannot be reintroduced by a community call site passing it", () => {
    // The wrapper closes it off AFTER the spread, so a stray `attach: true`
    // from a call site is overridden rather than honoured.
    const spread = CHAT_COMPOSER.indexOf("...capabilities");
    const closed = CHAT_COMPOSER.indexOf("attach: false");
    expect(spread).toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(spread);
  });
});

describe("the remaining controls still work on the community surfaces", () => {
  it("keeps the camera, which is the picker those surfaces still need", () => {
    for (const rel of COMMUNITY_SURFACES) {
      const src = code(rel);
      expect(src).toContain("camera: true");
      // ...and the handler that receives what it picks.
      expect(src).toContain("onFilePicked");
    }
    expect(COMPOSER).toContain("const showCamera = Boolean(capabilities.camera");
    expect(COMPOSER).toContain('aria-label="Take photo"');
  });

  it("keeps poll and anonymity where the surface had them", () => {
    const community = code("src/components/communities/community-chat.tsx");
    expect(community).toContain("poll: true");
    expect(community).toContain("anonymous: allowAnonymous");

    const society = code("src/components/societies/announcement-thread.tsx");
    expect(society).toContain("poll: true");
    expect(society).toContain("anonymous: canPostAnonymously");

    // The event discussion deliberately has neither (attendees coordinate
    // openly), so it must not have grown one in the edit.
    const event = code("src/components/events/event-discussion.tsx");
    expect(event).not.toContain("poll: true");
    expect(event).not.toContain("anonymous: true");
  });

  it("keeps the send button and its disabled state", () => {
    expect(COMPOSER).toContain('type="submit"');
    expect(COMPOSER).toContain('aria-label="Send"');
    expect(COMPOSER).toContain("disabled={inert || empty}");
  });
});

describe("nothing unreachable is left behind", () => {
  it("renders the hidden file input only when something can open it", () => {
    // It used to render on `onFilePicked` alone. A surface that has the
    // handler but neither control would then carry an input nothing can reach.
    expect(COMPOSER).toContain("{(showAttach || showCamera) && (");
    expect(COMPOSER).not.toContain("{onFilePicked && (");
  });

  it("imports no icon it no longer draws", () => {
    const block = /import\s*\{([^}]*)\}\s*from\s*"lucide-react"/.exec(
      read("src/components/chat/conversation-composer.tsx")
    );
    expect(block).not.toBeNull();
    const icons = block![1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(COMPOSER).toContain(`<${icon} `);
  });
});

/**
 * A Discover group is a `communities` row carrying `is_discover_group`, so it
 * renders the community composer — and must come out as exactly four controls:
 * the message field, poll, camera, send. Two separate facts produce that, and
 * both are asserted because either one regressing would put a control back:
 * `attach: false` from <ChatComposer/> (above), and `allowAnonymous={false}`
 * from the route.
 */
describe("the Discover team room composer is the minimal one", () => {
  it("switches anonymity off at the route", () => {
    const route = code(DISCOVER_ROUTE);
    expect(route).toContain("allowAnonymous={!isDiscoverGroup}");
  });

  it("is the only place a Discover group's composer is rendered", () => {
    // The community page redirects rather than rendering a second composer,
    // so there is no other call site that could pass different capabilities.
    const communityPage = code("src/app/(student)/communities/[id]/page.tsx");
    expect(communityPage).toContain("if (community.is_discover_group) redirect(");
  });

  it("leaves exactly message + poll + camera + send", () => {
    // The composer renders one button per capability and nothing else, so the
    // control set follows from the capabilities the surface asks for.
    const community = code("src/components/communities/community-chat.tsx");
    expect(community).toContain("poll: true");
    expect(community).toContain("camera: true");
    // Anonymity is a variable here (true for a normal room, false for
    // Discover) — never a literal that would apply to both.
    expect(community).toContain("anonymous: allowAnonymous");
    expect(community).not.toContain("anonymous: true");
    // `attach:` as a capability key, not the word — this file is full of
    // `attachment_url`, which is the message's stored image and unrelated.
    expect(community).not.toContain("attach:");
  });
});

describe("the composer's layout and behaviour are untouched", () => {
  it("leaves no spacer where the button was — the row is plain flex", () => {
    // The cluster has no fixed width and no placeholder, so a missing
    // capability gives its space back to the flex-1 textarea automatically.
    expect(COMPOSER).toContain('className="flex shrink-0 items-center gap-0.5"');
    expect(COMPOSER).toContain("min-w-0 flex-1 resize-none");
  });

  it("keeps the iOS-zoom guard, the safe area and enter-to-send", () => {
    expect(COMPOSER).toContain("text-base");
    expect(COMPOSER).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
    expect(COMPOSER).toContain('enterKeyHint="send"');
    expect(COMPOSER).toContain('e.key === "Enter" && !e.shiftKey');
  });

  it("keeps voice notes on direct messages only", () => {
    expect(DM_COMPOSER).toContain("voice: true");
    for (const rel of [...COMMUNITY_SURFACES, "src/components/chat/chat-composer.tsx"]) {
      expect(code(rel)).not.toContain("voice: true");
    }
  });
});
