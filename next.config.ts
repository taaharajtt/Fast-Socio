import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// Service worker (perf audit Phase 1).
//
// The previous configuration used next-pwa's DEFAULTS, and those defaults are
// what produced the post-deploy failure mode: "Failed to find Server Action",
// 404s on old chunks, and 7-10s bundle waits. Three separate mechanisms:
//
//  1. The precache manifest held 216 entries — every `_next/static/chunks/*`
//     file in the build, including one `page-*.js` per route. Every deploy
//     rehashes all of them, so every returning client re-downloaded the ENTIRE
//     client bundle in one burst at service-worker install. `exclude` below
//     drops them: they are content-hashed and served `immutable`, so precaching
//     buys nothing that the runtime CacheFirst rule does not already give us.
//
//  2. Navigation HTML and RSC payloads were cached (`pages`, `pages-rsc`,
//     `pages-rsc-prefetch`, all NetworkFirst). An RSC payload is only valid
//     against the build that produced it — it carries Server Action ids that
//     the next build's module map does not contain — so replaying one across a
//     deploy boundary is exactly the reported error. There is no correct way to
//     cache these, so they are NetworkOnly and no longer cached at all.
//
//  3. `cacheOnFrontEndNav` / `aggressiveFrontEndNavCaching` widened (2) by
//     having the worker opportunistically cache navigation payloads. Both off.
//
// What is still cached is only what is safe to cache: content-addressed assets
// whose URL changes when their bytes do.
const withPWA = withPWAInit({
  dest: "public",
  // See note (3) above. These are what made the worker cache navigations.
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  // BOTH of these must be off to stop the start-url document being cached, and
  // they are not redundant: `cacheStartUrl` controls whether "/" is added to
  // the PRECACHE manifest, while `dynamicStartUrl` independently unshifts a
  // NetworkFirst `start-url` RUNTIME route (next-pwa dist/index.js: the
  // `dynamicStartUrl && p.unshift(...)` branch). Leaving either on re-creates a
  // cached HTML document for "/" — which is a redirect to /home behind the auth
  // gate, so caching it is meaningless as well as unsafe across deploys.
  cacheStartUrl: false,
  dynamicStartUrl: false,
  reloadOnOnline: true,
  // Disable the service worker in dev so HMR / fast refresh stay clean.
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    // Add our Web Push handlers to the generated service worker.
    importScripts: ["/push-sw.js"],
    // Precache manifest exclusions. These are webpack `exclude` conditions and
    // are tested against the ASSET NAME (`static/chunks/...`), not the public
    // URL, so they are deliberately not anchored to a leading `/_next/`.
    //
    // Overriding this replaces next-pwa's defaults outright, so the two we
    // still want (source maps, the webpack manifest chunks) are restated here.
    exclude: [
      /\.map$/,
      /^manifest.*\.js$/,
      // (1) above — the whole reason this option is set.
      /static\/chunks\//,
      // Per-build manifests: rehashed every deploy, useless in a precache.
      /static\/[^/]+\/_(?:buildManifest|ssgManifest)\.js$/,
      // Fonts are runtime-cached (CacheFirst, 1y) instead; matches the default.
      /static\/.*(?<!\.p)\.woff2$/,
    ],
    // Replaces next-pwa's default runtimeCaching entirely.
    // `extendDefaultRuntimeCaching` is left at its default of false on purpose:
    // the defaults are what we are removing.
    //
    // Every matcher below tests `url.pathname`, never a `$`-anchored regex on
    // the full href. That is load-bearing: with `deploymentId` set (see below)
    // Next appends `?dpl=<id>` to static asset URLs, and Workbox matches a
    // RegExp `urlPattern` against `url.href` — so `/\.js$/` would silently stop
    // matching every script the moment version-skew protection was switched on.
    runtimeCaching: [
      {
        // Content-hashed and served `immutable` by Next. Safe to keep for a
        // year; the URL changes whenever the bytes do. maxEntries is sized for
        // several builds' worth of this app (~216 chunks each) so that entries
        // are not evicted out from under a page that is still open — the old
        // 64-entry cap was small enough to evict live chunks.
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && url.pathname.startsWith("/_next/static/"),
        handler: "CacheFirst",
        options: {
          cacheName: "next-static",
          expiration: { maxEntries: 400, maxAgeSeconds: 31536000 },
        },
      },
      {
        // Image derivatives from imgproxy via the Caddy /img route. Already
        // served `public, max-age=31536000, immutable` (deploy/contabo/Caddyfile)
        // and content-addressed by their transform options.
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && url.pathname.startsWith("/img/"),
        handler: "CacheFirst",
        options: {
          cacheName: "img",
          expiration: { maxEntries: 200, maxAgeSeconds: 2592000 },
        },
      },
      {
        urlPattern: ({ url }) =>
          /\.(?:woff2?|ttf|otf|eot)$/i.test(url.pathname),
        handler: "CacheFirst",
        options: {
          cacheName: "fonts",
          expiration: { maxEntries: 16, maxAgeSeconds: 31536000 },
        },
      },
      {
        // Static icons/brand/splash art out of public/. Not content-hashed, so
        // StaleWhileRevalidate rather than CacheFirst: a replaced logo must be
        // able to propagate without waiting out a long TTL.
        urlPattern: ({ url }) =>
          /\.(?:png|jpg|jpeg|webp|avif|gif|svg|ico)$/i.test(url.pathname),
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "static-image-assets",
          expiration: { maxEntries: 128, maxAgeSeconds: 2592000 },
        },
      },
      {
        // (2) above. RSC payloads and Server Action responses are valid only
        // against the build that produced them. NEVER cache these.
        urlPattern: ({ request }) => request.headers.get("RSC") === "1",
        handler: "NetworkOnly",
      },
      {
        // Document navigations. Same reasoning: the HTML references this
        // build's chunk hashes, so a cached copy outlives the assets it needs.
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkOnly",
      },
      {
        // Auth, storage presigning and the health probe. Nothing here is safe
        // to answer from a cache, and the old default cached them for 24h.
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin &&
          (url.pathname.startsWith("/api/") ||
            url.pathname.startsWith("/auth/") ||
            url.pathname.startsWith("/monitoring")),
        handler: "NetworkOnly",
      },
    ],
  },
});

// Baseline Content-Security-Policy (Phase 1 web hardening). connect-src permits
// Supabase REST + Realtime (wss). frame-ancestors 'none' blocks clickjacking.
//
// Pin the Supabase host to THIS project (audit P2-03) instead of a *.supabase.co
// wildcard, and add an explicit media-src so voice-note audio served from
// storage actually loads (it was falling back to default-src 'self' and being
// blocked). Falls back to the wildcard only if the env var is unset at build.
//
// 'unsafe-eval' is dev-only: React uses eval() there to rebuild server-side
// error stacks in the browser. Neither React nor Next needs it in production,
// so production drops it outright (security-hardening F10).
//
// 'unsafe-inline' stays in script-src for now, and that is a deliberate,
// documented trade rather than an oversight. Removing it requires nonces, and
// per Next's CSP guide nonces force EVERY page to render dynamically, which
// disables static optimization, ISR and CDN caching and is outright
// incompatible with PPR. That would undo the TTFB work (3s -> 0.7s) for a
// partial XSS gain. Revisit via experimental `sri` (hash-based CSP keeps static
// rendering) once it is no longer experimental.
const isDev = process.env.NODE_ENV === "development";

// Version-skew protection is MANDATORY for a container build (perf audit,
// deployment-safety pass). DOCKER_BUILD=1 is set only by deploy/contabo/Dockerfile,
// so this fires exactly for images that will serve real users, and never for
// `next dev`, `npm test`, or a local `next build`.
//
// This duplicates the `${GIT_SHA:?}` guard in docker-compose.yml on purpose.
// Compose is not the only way to invoke the Dockerfile — a bare `docker build`,
// a CI job, or a hand-run BuildKit command all bypass it — and an image built
// without a deployment id looks completely healthy right up until the next
// deploy strands live clients on chunks that no longer exist. Cheap check,
// expensive failure.
if (process.env.DOCKER_BUILD === "1" && !process.env.NEXT_DEPLOYMENT_ID?.trim()) {
  throw new Error(
    "NEXT_DEPLOYMENT_ID is empty but DOCKER_BUILD=1.\n" +
      "A production image MUST carry a deployment id: it is what makes a client " +
      "holding the previous build hard-reload instead of 404ing on its chunks " +
      "and failing on stale Server Action ids.\n" +
      'Fix: export GIT_SHA=$(git -C repo rev-parse --short HEAD) before "docker compose build app".'
  );
}
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : "*.supabase.co";
// Object storage moved to Contabo. Images and audio are now served from that
// host (or, when imgproxy is enabled, from our own origin via /img), and the
// browser PUTs uploads straight to it using a presigned URL — so it has to
// appear in connect-src as well as img-src/media-src, or every upload is
// blocked by the CSP rather than by anything meaningful.
//
// Supabase stays listed: it is still the API/Realtime host, and legacy media
// URLs may persist on old rows while both stacks run in parallel.
const storageHost = process.env.NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL
  ? new URL(process.env.NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL).host
  : "";
const storageSrc = storageHost ? ` https://${storageHost}` : "";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  `img-src 'self' blob: data: https://${supabaseHost}${storageSrc}`,
  `media-src 'self' blob: https://${supabaseHost}${storageSrc}`,
  "font-src 'self' data:",
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost}${storageSrc}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Cache headers for files served out of `public/` (caching plan, Phase 0).
//
// THE PROBLEM. Next cannot content-hash `public/` files, so it serves every one
// of them with `Cache-Control: public, max-age=0`. Verified in production:
//
//     /icons/icon-192.png   public, max-age=0
//     /map.png              public, max-age=0     <- 6,327,805 bytes
//
// So every PWA icon, splash screen and brand image is revalidated on each load,
// and the campus map — the single largest asset in the app — is re-downloaded
// in full by any client whose service worker has not already cached it. One
// user waited 36.7s for it in a 24h window.
//
// WHY NOT `immutable`. These filenames are stable, not content-addressed, so an
// updated logo or map has to be able to propagate. `stale-while-revalidate`
// gives the best of both: served instantly from cache, refreshed in the
// background, and a changed file reaches everyone within a day of their next
// visit rather than being pinned for a year.
//
// WHAT IS DELIBERATELY EXCLUDED, and why it must stay excluded:
//
//   * `sw.js`, `push-sw.js`, `workbox-*.js` — service worker scripts. Caching a
//     service worker is how you permanently lose the ability to ship an update.
//     `push-sw.js` is the sharp one: it is pulled in via `importScripts` (see
//     workboxOptions above), which DOES consult the HTTP cache, unlike the
//     top-level worker fetch that browsers revalidate on their own.
//   * `manifest.webmanifest` — left at `must-revalidate`. Its revalidations are
//     cheap 304s, and the PWA install funnel reads it; not worth the risk for
//     the bytes involved.
const PUBLIC_ASSET_CACHE =
  "public, max-age=604800, stale-while-revalidate=86400";
const assetCacheHeaders = [
  "/icons/:file*",
  "/splash/:file*",
  "/brand/:file*",
  "/apple-touch-icon.png",
  // Still a 6.3MB uncompressed PNG. Caching it is the immediate fix; routing it
  // through imgproxy like every other image in the app is the real one.
  "/map.png",
].map((source) => ({
  source,
  headers: [{ key: "Cache-Control", value: PUBLIC_ASSET_CACHE }],
}));

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Isolate our browsing context group so a cross-origin opener can't reach
  // into window.opener (F10 headers pass). Safe here: auth is magic-link, so
  // there is no OAuth popup relying on an opener handle.
  //
  // Deliberately NOT adding Cross-Origin-Embedder-Policy: require-corp -- it
  // would block every Supabase-hosted avatar, post image and voice note unless
  // storage returns Cross-Origin-Resource-Policy, which it does not guarantee.
  // COEP buys cross-origin isolation we have no use for (no SharedArrayBuffer).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Version-skew protection (perf audit Phase 1). Set to the deploying commit
  // SHA by docker-compose.yml; unset locally and in tests, where it is a no-op.
  //
  // With this set, Next appends `?dpl=<id>` to static asset URLs, sends
  // `x-deployment-id` on client navigations, returns `x-nextjs-deployment-id`
  // on navigation responses, and — the part that matters — triggers a HARD
  // navigation instead of a client-side transition when the two disagree.
  //
  // That is what converts the current post-deploy failures into a single page
  // reload. Deploys replace the container in place (see the cutover runbook),
  // so the old build's `.next/static` tree disappears the instant the new one
  // binds; without a deployment id a client that was mid-session simply 404s on
  // its chunks and fails on Server Action ids the new build has never heard of.
  //
  // MUST be a build arg, not a runtime env var: the value is inlined into the
  // client bundle and into asset URLs at build time. Setting it only at runtime
  // leaves the client half of the mechanism disabled.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID,
  // next/image srcset widths. The defaults run up to 3840px, which for a
  // mobile-first PWA means imgproxy was being asked to render desktop-retina
  // sizes nothing ever displays: 3840px transforms alone measured p50 3.7s /
  // max 30s on the origin, and 1920px was the single largest image cost. The
  // widest thing we lay out is a full-bleed cover on a large phone, so 1080
  // is the real ceiling; imageSizes covers avatars and thumbnails.
  images: {
    // CAPPED AT 828 (perf audit Phase 6). 1080 was dropped, and it was the
    // single largest source of mobile bytes in the app: measured on the
    // production access log, 6,022 of 13,631 avatar renders were requested at
    // 1080 — 44% of ALL image traffic — because `sizes="(max-width:448px)
    // 100vw, 448px"` on a 393px phone at DPR 2.75 resolves to 1080, which is
    // arithmetically correct and a waste of a student's data plan.
    //
    // Measured on the same avatar through imgproxy at q=70 (WebP):
    //
    //     640px   30,186 bytes
    //     750px   40,238 bytes
    //     828px   47,782 bytes
    //    1080px   75,146 bytes     <- dropped
    //
    // So the cap saves ~36% on every full-width image, and more on a feed page
    // that loads several.
    //
    // WHY 828 IS ENOUGH HERE, specifically. This app is a phone-shaped PWA:
    // `max-w-md` (448px) appears in 77 places and the widest `sizes` anywhere
    // in the codebase is `(max-width: 448px) 100vw, 448px`. Nothing is ever
    // displayed wider than 448 CSS px, so 828 still serves ~1.9x DPR at the
    // widest slot and ~2.1x on a typical 393px phone. Beyond ~2x, extra pixels
    // in a lossy photograph are not perceptible at arm's length, but they are
    // fully paid for in bytes and in imgproxy CPU.
    //
    // The one place full resolution still matters is the full-screen photo
    // viewer, where people pinch-zoom. That is deliberately unaffected:
    // `components/ui/photo-viewer.tsx` renders a plain <img> with the original
    // (or signed) URL and never goes through next/image or this list.
    deviceSizes: [640, 750, 828],
    imageSizes: [32, 48, 64, 96, 128, 256, 384],
  },
  // Cache Components (Next 16) — dynamic-by-default with PPR: every route emits
  // a prerendered static shell immediately and streams the request-scoped parts
  // in behind their Suspense boundaries. This is what makes a dock tab switch
  // paint instantly instead of waiting on the layout's auth + flag round trips.
  //
  // On `unstable_instant`: routes deliberately do NOT export it. That export
  // adds build-time VALIDATION only — prefetching is static by default either
  // way — and the validation currently fails on every student route with:
  //
  //   accessed header "sentry-trace" which is not defined in the `samples`
  //
  // which comes from @sentry/nextjs continuing an incoming distributed trace on
  // each server render, above any boundary we control. The two ways to satisfy
  // it are worse than the problem: `prefetch: "runtime"` with header samples
  // makes every prefetch do real per-user server work (a request storm against
  // Supabase), and switching off server-side tracing gives up error/perf
  // monitoring the launch audit requires (LR-05). The shells are verified
  // instead by the build output — every route reports ◐ (Partial Prerender).
  // Revisit if the instant API gains a way to declare an ambient header read.
  // React Compiler (Next 16 `reactCompiler`, backed by babel-plugin-react-compiler).
  //
  // It auto-memoizes component render output and hook results, which is the
  // same thing hand-written `memo`/`useMemo`/`useCallback` does — but applied
  // everywhere rather than only where somebody remembered.
  //
  // WHY IT IS ON. `chat-thread.tsx` is 2,122 lines with 34 `useState` hooks,
  // renders every message inline, and contains ZERO memoization, so any state
  // change — a typing indicator arriving, a sheet opening, a reaction landing —
  // re-rendered every message row in the thread. The alternative was extracting
  // and hand-memoizing a ~300-line row with 19 parent-scope dependencies, on
  // the app's most critical surface, with no component-test safety net. The
  // compiler does the same job for that file AND for swipe-deck, community-chat
  // and everything else, and it BAILS on any component it cannot prove safe
  // rather than miscompiling it.
  //
  // Three source comments already claimed the compiler was "enabled in this
  // repo" (use-realtime-channel.ts, use-push-signal.ts, chat-thread.ts). It was
  // not — no config, no package, no lint rule. Those files were nonetheless
  // written to its rules, which is part of why turning it on is low risk.
  reactCompiler: true,
  cacheComponents: true,
  // Self-hosted (Contabo) builds only. `standalone` emits a minimal server plus
  // a pruned node_modules, which is what makes the container image small and
  // reproducible. It is gated behind a build arg rather than set outright so
  // that Vercel production builds stay byte-for-byte what they are today — this
  // migration must not be able to change the deployment that serves real users.
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
  experimental: {
    // Client Cache TTL (caching plan, Phase 1). THE single change aimed at
    // "tab switching is slow".
    //
    // Unset, `dynamic` defaults to 0 (staleTimes.md version history: changed
    // from 30s to 0s in v15) — so the router treats every dynamic page segment
    // as stale the instant it lands, and bouncing between the six dock tabs
    // refetches the RSC payload from Frankfurt every single time, even if you
    // left the tab three seconds ago. Measured: real RSC navigations are p50
    // 639ms / p95 1,944ms server-side, before the ~280ms round trip a student
    // in Pakistan pays on top.
    //
    // `static` is deliberately left at its 5-minute default: PPR shells and
    // loading boundaries are already handled by it, and this app's shells are
    // identical for every student by construction.
    //
    // WHY 30s IS SAFE HERE, given staleness has been a complaint before:
    //
    //  1. WRITES CLEAR IT ENTIRELY. Per cacheLife.md, calling revalidateTag /
    //     revalidatePath / updateTag / refresh from a Server Action clears the
    //     WHOLE client cache immediately, bypassing the stale time. This repo
    //     has 146 such calls across 26 files, so any action a student takes
    //     resets the window rather than reading through it.
    //  2. THE LIVE DATA DOES NOT COME THROUGH THIS CACHE. The DM inbox, the
    //     chat badge and the thread are fed by the layout-level realtime island
    //     (components/chat/chat-realtime.tsx) and its module stores, which
    //     re-read on subscribe, resubscribe, focus, visibilitychange, `online`
    //     and a polling fallback — all independent of navigation. That
    //     architecture did not exist when this knob was last considered, and it
    //     is precisely the safety net that makes a stale window affordable.
    //  3. It does not change back/forward behaviour (staleTimes.md), which is
    //     already reuse-based, so nothing regresses there.
    //
    // Start at 30. Raise only with a measurement, and lower it immediately if
    // stale-inbox reports return.
    staleTimes: {
      dynamic: 30,
    },
    // Next DevTools → "Instant Navs": freeze the UI at the static shell to see
    // exactly what a tab switch paints before any data arrives.
    instantNavigationDevToolsToggle: true,
    // Server Actions compare the request's Origin against the Host it believes
    // it is serving. Behind Caddy the app sees the INTERNAL host (app:3000),
    // so every action — all 33 "use server" modules, i.e. every write in the
    // product — would be rejected as a cross-origin attempt. Listing the real
    // public origins is what keeps writes working once we are behind a proxy.
    //
    // This is an allow-list guarding against CSRF-style cross-origin action
    // invocation, so it must stay an explicit list: no wildcards, and nothing
    // added here that we do not actually serve.
    serverActions: {
      allowedOrigins: [
        "fastsocio.online",
        "www.fastsocio.online",
        // The temporary sslip.io VPS origin was removed here in perf audit 6.2,
        // together with its Caddy site block. Both had to go at once: leaving
        // this entry behind would keep accepting Server Action POSTs claiming an
        // Origin we no longer serve, which is precisely the cross-origin case
        // this allow-list exists to reject.
        "localhost:3000",
      ],
    },
  },
  // next-pwa injects a webpack config; an empty turbopack config lets `next dev`
  // run on Turbopack without conflict (the SW is disabled in dev anyway).
  turbopack: {},
  async headers() {
    // Order matters: "the last header key will override the first" for two rules
    // matching the same path and the same key (headers.md). The asset rules run
    // second so their Cache-Control wins, and they set no key that the security
    // headers also set, so nothing above is weakened.
    return [{ source: "/:path*", headers: securityHeaders }, ...assetCacheHeaders];
  },
  async redirects() {
    // The Notifications panel was rebranded to Activity (UAT-002). Keep old
    // bookmarks and previously-dispatched push deep links working.
    return [{ source: "/notifications", destination: "/activity", permanent: true }];
  },
};

// Wrap with Sentry LAST (outermost) so its build-time source-map upload and the
// `/monitoring` tunnel rewrite compose over the PWA-augmented config.
//
// The tunnel routes browser error events through our own origin, so (a) the
// strict CSP above needs no sentry.io entry and (b) student ad-blockers that
// block sentry.io can't silently drop error reports. Source-map upload only
// runs when SENTRY_AUTH_TOKEN is present (CI/prod); otherwise it's skipped and
// the build still succeeds.
export default withBundleAnalyzer(
  withSentryConfig(withPWA(nextConfig), {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    // Quiet the plugin unless we're in CI where the log is useful.
    silent: !process.env.CI,
    // Same-origin tunnel for browser events (see note above).
    tunnelRoute: "/monitoring",
    // Strip Sentry's internal logger calls from the browser bundle.
    disableLogger: true,
    // Tree-shake the SDK's debug logging out of the client bundle.
    webpack: { treeshake: { removeDebugLogging: true } },
    // Upload source maps for the client bundle's dynamic imports too.
    widenClientFileUpload: true,
  })
);
