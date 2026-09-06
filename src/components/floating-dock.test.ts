/**
 * The dock is icon-only (no visible text labels), so the things a label used
 * to guarantee — that you can tell the six destinations apart, and that a
 * screen reader can name them — are now carried entirely by markup. These
 * tests render the real component to static HTML and assert exactly that,
 * plus the Chat tab's paper-plane glyph and its outline → filled switch.
 *
 * Rendering happens through `react-dom/server` because the repo's vitest runs
 * in a node environment with no DOM library; the dock's client hooks
 * (`useSyncExternalStore` with a server snapshot, `useState`, `useEffect`) all
 * behave on the server, so a static render is enough for structural claims.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/home";

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

// next/link and next/image both want a Next runtime; neither adds anything the
// assertions below care about, so they render as the plain tags they become.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown> & { children?: unknown }) =>
    createElement("a", props, children as never),
}));
vi.mock("@/components/ui/app-image", () => ({
  AppImage: (props: { src: string; alt: string }) =>
    createElement("img", { src: props.src, alt: props.alt }),
}));

const { FloatingDock } = await import("./floating-dock");
const { NAV_ITEMS, activeNavHref } = await import("@/lib/nav");

function render(props: Parameters<typeof FloatingDock>[0] = {}) {
  return renderToStaticMarkup(createElement(FloatingDock, props));
}

/** Render at `path`, then put the module-level pathname back. */
function renderAt(path: string, props: Parameters<typeof FloatingDock>[0] = {}) {
  pathname = path;
  try {
    return render(props);
  } finally {
    pathname = "/home";
  }
}

/** The markup for one tab: its anchor through to the start of the next one. */
function tab(html: string, href: string) {
  const start = html.indexOf('href="' + href + '"');
  if (start === -1) return "";
  const from = html.lastIndexOf("<a", start);
  const next = html.indexOf("<a ", start + 1);
  return html.slice(from, next === -1 ? undefined : next);
}

/** Text nodes left after every tag is stripped — i.e. what a sighted user reads. */
function visibleText(html: string) {
  return html.replace(/<[^>]*>/g, "").trim();
}

describe("FloatingDock (icon-only)", () => {
  it("renders no visible navigation labels", () => {
    const html = render();
    expect(visibleText(html)).toBe("");
    for (const { label } of NAV_ITEMS) {
      // The words may only survive inside attributes (aria-label), never as text.
      expect(visibleText(html)).not.toContain(label);
    }
  });

  it("keeps all six destinations with their hrefs", () => {
    const html = render();
    const hrefs = [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(NAV_ITEMS.map((n) => n.href));
  });

  it("gives every link its former label as an accessible name", () => {
    const html = render();
    for (const { href, label } of NAV_ITEMS) {
      const anchor = new RegExp(`<a[^>]*href="${href}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(anchor).toContain(`aria-label="${label}"`);
    }
  });

  it("marks icons decorative so the aria-label is the only announced name", () => {
    const html = render();
    // Six tabs, six glyphs — every one hidden from the accessibility tree.
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("sets aria-current=page on the active destination only", () => {
    const html = renderAt("/leaderboard");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const active = /<a[^>]*aria-current="page"[^>]*>/.exec(html)?.[0] ?? "";
    expect(active).toContain('href="/leaderboard"');
  });

  it("keeps focus styling and full-height, equal-width tap targets", () => {
    const html = render();
    const anchors = [...html.matchAll(/<a[^>]*class="([^"]+)"/g)].map((m) => m[1]);
    expect(anchors).toHaveLength(6);
    for (const cls of anchors) {
      expect(cls).toContain("focus-ring");
      // 1/6 of the bar (>=53px at 320px) x the full dock row — over 44x44.
      expect(cls).toContain("flex-1");
      expect(cls).toContain("min-w-0");
    }
    // The row's height, and the safe-area inset paid by the bar itself.
    expect(html).toContain("h-[var(--dock-h)]");
    expect(html).toContain("pb-[var(--safe-bottom)]");
  });

  it("renders Chat and Community badges on their icons, capped at 9+", () => {
    const html = render({ badges: { "/chat": 3, "/communities": 42 } });
    expect(html).toContain(">3<");
    expect(html).toContain(">9+<");
    // The count is folded into the accessible name, not left to the visual.
    expect(html).toContain('aria-label="Chat, 3 unread"');
    expect(html).toContain('aria-label="Community, 42 unread"');
  });

  it("keeps the Chat badge clear of the paper plane's tip", () => {
    // The plane's ink reaches the top-RIGHT of its box, so Chat's badge hangs
    // left while every other tab keeps the shared top-right corner. The cap at
    // "9+" bounds the widest badge this has to clear.
    const chat = tab(render({ badges: { "/chat": 120 } }), "/chat");
    expect(chat).toContain("-left-1.5");
    expect(chat).not.toContain("-right-1.5");
    expect(chat).toContain(">9+<");

    const community = tab(render({ badges: { "/communities": 120 } }), "/communities");
    expect(community).toContain("-right-1.5");
  });

  it("keeps the Me avatar circular", () => {
    const html = render({ avatarUrl: "https://example.test/me.jpg" });
    const meTab = tab(html, "/profile");
    expect(meTab).toContain("rounded-full");
    expect(meTab).toContain("overflow-hidden");
    expect(meTab).toContain("https://example.test/me.jpg");
  });

  describe("Chat's paper-plane glyph", () => {
    // The shared geometry from dock-glyphs: the closed body (lucide Send's
    // vertices, re-cornered at r=2) and the open line that is the fold.
    const BODY = "M18.442 3.018";
    const FOLD = "M20.04 3.96 11.04 12.96";

    it("is a paper plane, not a speech bubble, in both states", () => {
      for (const path of ["/home", "/chat"]) {
        const chat = tab(renderAt(path), "/chat");
        expect(chat).toContain(BODY);
        expect(chat).toContain(FOLD);
        // MessageCircle's arc — the icon this replaced.
        expect(chat).not.toContain("7.9 20A9 9 0");
        // Corners are the rounded r=2 arcs, not lucide Send's 0.5 chamfers.
        expect(chat).toContain("A2 2 0 0 0");
        expect(chat).not.toContain("a.5.5 0 0 0");
      }
    });

    it("draws the inactive plane as a transparent outline", () => {
      const chat = tab(renderAt("/home"), "/chat");
      // lucide's own icon: stroked in currentColor, no fill, muted colour.
      expect(chat).toContain('fill="none"');
      expect(chat).toContain('stroke="currentColor"');
      expect(chat).toContain("text-fg-muted");
      expect(chat).not.toContain("<mask");
    });

    it("switches the active plane to a filled variant with the fold cut out", () => {
      const chat = tab(renderAt("/chat"), "/chat");
      // Filled, in the active (white) colour — not merely a recoloured outline.
      expect(chat).toContain('fill="currentColor"');
      expect(chat).toContain("text-fg");
      expect(chat).not.toContain("text-fg-muted");
      // The fold survives as a mask that subtracts it from the fill, so it
      // reads as a dark diagonal rather than dissolving into the body.
      expect(chat).toContain("<mask");
      expect(chat).toMatch(/mask="url\(#[^)]+\)"/);
      expect(chat).toContain(FOLD);
    });

    it("keeps both states the same size, so neighbours never shift", () => {
      const sizes = ["/home", "/chat"].map(
        (path) => /width:\s*(\d+)px/.exec(tab(renderAt(path), "/chat"))?.[1]
      );
      // 24, not the shared 22: a triangle covers barely half its box, so the
      // plane needs the extra 2px to sit optically level with its neighbours.
      expect(sizes[0]).toBe("24");
      expect(sizes[1]).toBe("24");
      // Same 24x24 grid as every other dock glyph.
      expect(tab(render(), "/chat")).toContain('viewBox="0 0 24 24"');
    });

    it("marks the plane decorative in both states", () => {
      for (const path of ["/home", "/chat"]) {
        const chat = tab(renderAt(path), "/chat");
        expect(/<svg[^>]*aria-hidden="true"/.test(chat)).toBe(true);
      }
    });

    it("still renders the plane, and its badge, while Chat is active", () => {
      const chat = tab(renderAt("/chat", { badges: { "/chat": 4 } }), "/chat");
      expect(chat).toContain(BODY);
      expect(chat).toContain(">4<");
      expect(chat).toContain('aria-label="Chat, 4 unread"');
      expect(chat).toContain('aria-current="page"');
    });
  });

  it("lights Chat on nested and conversation routes", () => {
    // Every route under /chat resolves to the Chat tab, including the two
    // conversation screens (a 1:1 thread and a community room).
    for (const path of ["/chat", "/chat/abc-123", "/chat/c/xyz"]) {
      expect(activeNavHref(path)).toBe("/chat");
    }

    expect(tab(renderAt("/chat"), "/chat")).toContain('aria-current="page"');

    // Those conversation screens are the app's one immersive surface: the tab
    // they belong to is still Chat, there is simply no bar drawn over the
    // composer. Asserted so the glyph swap cannot quietly bring it back.
    for (const path of ["/chat/abc-123", "/chat/c/xyz"]) {
      expect(renderAt(path)).toBe("");
    }
  });
});
