import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * REGRESSION GUARD for Next.js invariant E592:
 *
 *   InvariantError: postponed state should not be provided when fallback
 *   params are provided
 *
 * WHAT CAUSES IT. Under Cache Components (`cacheComponents: true`), a dynamic
 * route with no `generateStaticParams` builds a FALLBACK SHELL whose params are
 * unknown at build time. If the page's default export also reads request data —
 * `await params`, `await searchParams`, or `notFound()` — the route turns
 * dynamic while that shell is still being produced, and resuming the shell then
 * throws. It surfaces as a 500 on the page.
 *
 * This is not a hypothesis. `/post/[id]` hit it in production and carries a
 * comment describing the exact failure; the fix there was to make the default
 * export synchronous and move every request-scoped read into an async child
 * behind `<Suspense>`. A later audit found 15 of the other 16 dynamic pages
 * still had the broken shape. This test is what stops that recurring.
 *
 * It is deliberately a STATIC test over the source tree rather than a runtime
 * one: reproducing E592 needs a production build, a populated prerender cache
 * and a resumed fallback shell, which is far past what a unit test can stage.
 * The shape is the thing we actually control, so the shape is what is asserted.
 *
 * WHEN THIS FAILS, the fix is never `await connection()` or disabling PPR —
 * both make the route MORE dynamic, which is the cause. Follow /post/[id]:
 * keep the default export synchronous and move the reads into the body.
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

describe("dynamic route shells (Next.js E592 guard)", () => {
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
      `${rel}: the default export is async. Under Cache Components that makes ` +
        `the route dynamic while its fallback shell is being built and can ` +
        `throw E592 on resume. Keep it synchronous and move the awaits into an ` +
        `async child behind <Suspense> — see src/app/(student)/post/[id]/page.tsx.`
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
      `${rel}: the shell calls notFound(). Move it into the async body — calling ` +
        `it during the fallback-shell pass is the documented trigger in ` +
        `src/app/(student)/post/[id]/page.tsx.`
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

  it("keeps /post/[id] as the reference implementation", () => {
    const ref = pages.find((p) => p.includes("post") && p.includes("[id]"));
    expect(ref, "the route that documents E592 must still exist").toBeTruthy();
    const src = readFileSync(join(process.cwd(), ref!), "utf8");
    expect(src).toMatch(/postponed state should not be provided/);
  });
});
