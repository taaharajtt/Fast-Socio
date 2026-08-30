import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * GUARD: every dynamic route renders a request-free shell.
 *
 * WHAT THIS IS FOR. Under Cache Components, a page whose default export awaits
 * `params`/`searchParams` or calls `notFound()` cannot be prerendered at all —
 * the very first thing it does is request-scoped, so there is no shell to
 * stream ahead of the data. Keeping the export synchronous and passing the
 * params promise into an async child behind `<Suspense>` means the header,
 * title and skeleton paint the instant the route is entered, and only the
 * query streams. That is a perceived-performance property and it is why this
 * test exists.
 *
 * WHAT THIS IS *NOT* FOR — and this correction matters, because 15 pages were
 * rewritten on the strength of the claim. This file used to assert that the
 * above shape prevents Next invariant E592:
 *
 *   InvariantError: postponed state should not be provided when fallback
 *   params are provided
 *
 * It does not. The guard that throws is
 * node_modules/next/dist/server/app-render/app-render.js:1591 —
 * `if (typeof renderOpts.postponed === 'string') { if (fallbackRouteParams) throw }`
 * — and neither value is influenced by page code. Production confirmed it:
 * after all 16 routes were given this shape, E592 was still firing 222 times a
 * day, 100% of them on /post/[id], the route the others had been copied FROM.
 *
 * The 15 rewrites were harmless and are worth keeping on streaming grounds.
 * They were not, however, the fix, and this comment should not be allowed to
 * imply otherwise the next time someone reads it.
 *
 * It is deliberately a STATIC test over the source tree: the shape is the thing
 * we control, so the shape is what is asserted.
 */

const APP_DIR = join(process.cwd(), "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

/** Pages whose route path contains a dynamic segment, e.g. [id] / [table]. */
function dynamicRoutePages(): string[] {
  return walk(APP_DIR)
    .filter((p) => /\[[^\]]+\]/.test(p))
    .map((p) => p.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", ""))
    .sort();
}

/** Source of the default export, up to the next top-level function. */
function defaultExportBody(src: string): { isAsync: boolean; body: string } | null {
  const m = /export default (async )?function (\w+)/.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const next = /\n(?:async )?function /.exec(rest);
  return { isAsync: Boolean(m[1]), body: next ? rest.slice(0, next.index) : rest };
}

const pages = dynamicRoutePages();

describe("dynamic route shells", () => {
  it("finds the dynamic routes to check", () => {
    // If this drops to zero the rest of the suite silently passes for the wrong
    // reason, so assert the corpus is real. 16 at the time of writing.
    expect(pages.length).toBeGreaterThanOrEqual(16);
  });

  it.each(pages)("%s renders a request-free shell", (rel) => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    const found = defaultExportBody(src);
    expect(found, `${rel}: no default export found`).not.toBeNull();
    const { isAsync, body } = found!;

    expect(
      isAsync,
      `${rel}: the default export is async, so the route cannot prerender a ` +
        `shell and nothing paints until its query resolves. Keep it ` +
        `synchronous and move the awaits into an async child behind ` +
        `<Suspense>.`
    ).toBe(false);

    expect(
      /await\s+params/.test(body),
      `${rel}: the shell awaits params. Pass the promise down to the body instead.`
    ).toBe(false);

    expect(
      /await\s+searchParams/.test(body),
      `${rel}: the shell awaits searchParams. Pass the promise down to the body instead.`
    ).toBe(false);

    expect(
      /\bnotFound\(\)/.test(body),
      `${rel}: the shell calls notFound(), which is request-scoped and so ` +
        `collapses the shell. Move it into the async body.`
    ).toBe(false);
  });

  it.each(pages)("%s streams its request-scoped work behind Suspense", (rel) => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    // A request-free shell is only useful if something below it actually
    // suspends; otherwise the reads were deleted rather than moved.
    expect(
      /<Suspense/.test(src),
      `${rel}: no <Suspense> boundary. The shell must render a fallback while ` +
        `the async body streams, or the split has no effect.`
    ).toBe(true);
  });

  it("keeps the E592 evidence attached to the route that hit it", () => {
    // The invariant is a framework bug we are working around, not a rule we
    // can re-derive later. If the workaround is ever reverted, the reader
    // needs the measurement that justified it, not just a git blame line.
    const ref = pages.find((p) => p.replace(/\\/g, "/").includes("post/[id]"));
    expect(ref, "the route that documents E592 must still exist").toBeTruthy();
    const src = readFileSync(join(process.cwd(), ref!), "utf8");
    expect(src).toMatch(/postponed state should not be provided/);
    expect(
      src,
      "the opt-out must carry its reason: cite the guard in Next's source"
    ).toMatch(/app-render\.js:1591/);
  });
});
