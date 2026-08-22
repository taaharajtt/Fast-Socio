import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const withPWA = withPWAInit({
  dest: "public",
  reloadOnOnline: true,
  // Disable the service worker in dev so HMR / fast refresh stay clean.
  disable: process.env.NODE_ENV === "development",

  // PERF/PRIVACY (audit F4) — `cacheOnFrontEndNav` and
  // `aggressiveFrontEndNavCaching` were BOTH true here and are now both off.
  //
  // That preset is written for public, non-personalized sites. On this app it
  // generated four NetworkFirst routes that stored per-user content in Cache
  // Storage for 24 hours (verified by decompiling the deployed sw.js):
  //
  //   pages-rsc-prefetch   any same-origin GET with Next-Router-Prefetch: 1
  //   pages-rsc            any same-origin GET with RSC: 1
  //   pages                any same-origin non-/api GET  (authenticated HTML)
  //   cross-origin         EVERY cross-origin GET — i.e. Supabase PostgREST
  //                        reads — with networkTimeoutSeconds: 10
  //
  // An RSC payload for this app contains the viewer's feed, their unread
  // counts and their profile. NetworkFirst falls back to cache on any network
  // failure, Cache Storage is origin-scoped, and nothing cleared it on sign-out
  // — so a payload rendered for one session could be replayed into another.
  // The `cross-origin` rule additionally meant a slow Supabase read blocked the
  // browser for a full ten seconds before falling back to a cache that, capped
  // at 32 entries shared with every image, usually did not have the answer.
  //
  // The list below is therefore EXPLICIT and allow-list shaped: only immutable,
  // non-personalized, content-addressed assets are cached. Anything not matched
  // by a rule is simply not handled by the service worker and goes to the
  // network as normal, which is exactly the desired behaviour for documents,
  // RSC payloads and API reads.
  //
  // `/` is left entirely alone, and that takes BOTH flags below — they are
  // independent, and only one of them is the obvious one:
  //
  //   cacheStartUrl: false    keeps `/` out of the PRECACHE manifest.
  //   dynamicStartUrl: false  removes the RUNTIME `start-url` route, which is
  //                           added purely on this flag and ignores the one
  //                           above (verified in the plugin source: the route
  //                           is unshifted under `options.dynamicStartUrl`).
  //
  // The runtime route is the one that actually mattered. It is NetworkFirst
  // over `/`, and its `cacheWillUpdate` rewrites an opaque redirect into a
  // cached `200`. On this app `/` ALWAYS redirects — to /login or /home
  // depending on whether you have a session — so that rule cached a routing
  // decision. Setting only `cacheStartUrl: false` leaves it in place; the
  // generated sw.js still contained `cacheName:"start-url"` until both were off.
  cacheStartUrl: false,
  dynamicStartUrl: false,

  // PERF (Phase 1) — keep route-specific heavy assets OUT of the precache.
  //
  // next-pwa globs `public/**/*` into the precache manifest, so EVERY first
  // visitor was downloading the whole folder in the background whether or not
  // they ever opened the screen that uses it. Measured on production
  // 2026-08-22: 212 precache entries totalling 10.7 MB, of which
  //
  //   public/map.webp   4,081,774 bytes  — the campus map, used ONLY by /map
  //                                        (was map.png at 6,327,805 bytes; see
  //                                        campus-map-viewer.tsx for why it is
  //                                        lossless rather than resized)
  //   public/splash/*  ~2,900,000 bytes  — 18 iOS launch images, of which any
  //                                        given device uses exactly one, and
  //                                        only once it installs the PWA
  //
  // ...is ~9.2 MB that competes with the user's actual navigation on mobile
  // data, and is re-fetched after every deploy that changes the build id.
  //
  // Nothing breaks: both are still cached on FIRST USE by the runtime routes
  // below (`static-image-assets` matches any .png), so a student who opens the
  // map gets it cached from then on, including offline. What changes is that
  // the ~95% who never open it no longer pay for it.
  //
  // Patterns are globs relative to public/ and MUST be `!`-prefixed — the
  // plugin appends them to its own glob list (see publicExcludes in the
  // package's PluginOptions). A pattern without `!` would INCLUDE, not exclude.
  publicExcludes: ["!map.webp", "!splash/**/*"],

  // `extendDefaultRuntimeCaching` is deliberately NOT set (defaults to false),
  // so this list REPLACES all 18 defaults rather than merging with them. That
  // is the point: the defaults are what cached personalized responses. Dropping
  // the Google-fonts rules costs nothing — `Inter` is self-hosted by
  // next/font/google at build time and `font-src 'self' data:` in the CSP above
  // would block a runtime fetch from Google anyway.
  //
  // NOTE ON OFFLINE. Removing the page/RSC caches means the app no longer
  // renders anything useful with no network. It never really did: there is no
  // app/~offline page, and every screen in this product is personalized and
  // realtime, so a cached copy of someone's feed is a stale privacy liability
  // rather than a feature. The shell (JS/CSS/images) is still cached, so an
  // installed PWA still launches instantly; it just needs a connection for
  // content, which is honest for a social app.
  //
  // ORDER MATTERS — workbox takes the FIRST matching route.
  workboxOptions: {
    disableDevLogs: true,
    // Add our Web Push handlers to the generated service worker.
    importScripts: ["/push-sw.js"],
    runtimeCaching: [
      {
        // Content-hashed by the build; safe to cache indefinitely.
        // 157 chunks in the current build, with headroom for growth. The
        // default's maxEntries: 64 guaranteed thrashing — entries evicted
        // before they were ever reused.
        urlPattern: /\/_next\/static\/.+\.js$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "next-static-js-assets",
          expiration: { maxEntries: 256, maxAgeSeconds: 31536000 },
        },
      },
      {
        urlPattern: /\/_next\/static\/.+\.css$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-style-assets",
          expiration: { maxEntries: 32, maxAgeSeconds: 31536000 },
        },
      },
      {
        // Self-hosted next/font files, also content-hashed.
        urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-font-assets",
          expiration: { maxEntries: 16, maxAgeSeconds: 31536000 },
        },
      },
      {
        // next/image renders of LOCAL assets (the brand logo, badges).
        urlPattern: /\/_next\/image\?url=.+$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "next-image",
          expiration: { maxEntries: 128, maxAgeSeconds: 2592000 },
        },
      },
      {
        // Images by extension. This also catches our imgproxy renders, since
        // /img/…/plain/<encoded-source>.jpg ends in an image extension, and the
        // 4 MB campus map now that it is no longer precached.
        //
        // CacheFirst, not the default StaleWhileRevalidate. SWR fires a
        // background revalidation for EVERY cached image on EVERY view, which
        // is pure waste here: imgproxy URLs are content-addressed by their
        // transform options over objects that are written once and never
        // overwritten, and Caddy already serves them `immutable` (see
        // deploy/contabo/Caddyfile). There is nothing to revalidate.
        urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp|avif)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-image-assets",
          expiration: { maxEntries: 512, maxAgeSeconds: 2592000 },
          // Opaque cross-origin responses have status 0; without this they are
          // never stored. Legacy Supabase-hosted media still exists on old rows.
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        // Voice notes. rangeRequests is REQUIRED for audio: without it, seeking
        // in a cached clip fails because the browser's Range request cannot be
        // satisfied from a whole-body cache entry.
        //
        // These are presigned chat-media URLs, so the signature is part of the
        // cache key and an expired entry simply misses. That is correct — it
        // must not be possible to replay a presigned URL out of the cache after
        // the grant behind it has lapsed, so the TTL is kept short.
        urlPattern: /\.(?:mp3|wav|ogg|m4a|webm)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-audio-assets",
          rangeRequests: true,
          expiration: { maxEntries: 32, maxAgeSeconds: 3600 },
          cacheableResponse: { statuses: [0, 200, 206] },
        },
      },
      {
        urlPattern: /\.(?:mp4)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-video-assets",
          rangeRequests: true,
          expiration: { maxEntries: 8, maxAgeSeconds: 3600 },
          cacheableResponse: { statuses: [0, 200, 206] },
        },
      },
      // NOTHING ELSE. Documents, RSC payloads, /api/* and every cross-origin
      // request (Supabase REST and Realtime) are intentionally unhandled and
      // therefore go straight to the network, uncached. Do not add a catch-all
      // rule here — see the note above the `cacheStartUrl` line for what that
      // cost last time.
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
  cacheComponents: true,
  // Self-hosted (Contabo) builds only. `standalone` emits a minimal server plus
  // a pruned node_modules, which is what makes the container image small and
  // reproducible. It is gated behind a build arg rather than set outright so
  // that Vercel production builds stay byte-for-byte what they are today — this
  // migration must not be able to change the deployment that serves real users.
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
  experimental: {
    // Next DevTools → "Instant Navs": freeze the UI at the static shell to see
    // exactly what a tab switch paints before any data arrives.
    instantNavigationDevToolsToggle: true,

    /**
     * PERF (audit F12) — let the client router reuse a dynamic route's payload
     * for 30 seconds.
     *
     * Next 15 changed this default from 30s to 0s, and the app never opted back
     * in. Every student route is request-scoped, so EVERY route is "dynamic"
     * and every tab switch was a full RSC round trip — including switching back
     * to a tab you left ten seconds ago. The PPR shell made that feel
     * responsive (the chrome paints instantly) which is exactly why it went
     * unnoticed: what was slow was the content settling, every single time.
     *
     * WHY 30s IS SAFE HERE, DESPITE BEING A STALENESS BUDGET
     * The things a user would notice going stale are all kept fresh by other
     * means, so this window only ever elides a redundant fetch:
     *
     *   - Under Cache Components, Next keeps recently-visited routes mounted
     *     via <Activity>, so client state survives a tab switch. A post you
     *     just wrote is prepended by <HomeFeed/> in client state and is still
     *     there when you come back, cached payload or not.
     *   - The chat inbox and the dock badge are realtime-driven
     *     (<DockRealtime/>, InboxList) and update themselves without a
     *     navigation.
     *   - Likes and similar are optimistic client state for the same reason.
     *
     * What it does cost: a post made by SOMEONE ELSE may not appear on /home
     * for up to 30s if you tab away and back. For a campus feed that is well
     * inside the noise floor.
     *
     * Only `dynamic` is set. `static` is deliberately left alone — per Next's
     * cacheLife docs, changing it also changes the `stale` value of the default
     * `use cache` profile, which would silently retune getMaintenanceState()
     * (lib/flags.ts) as a side effect.
     */
    staleTimes: {
      dynamic: 30,
    },
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
        // Temporary VPS origin, needed to smoke-test the container before DNS
        // moves. Remove once the domain is live.
        "169-58-149-230.sslip.io",
        "localhost:3000",
      ],
    },
  },
  // next-pwa injects a webpack config; an empty turbopack config lets `next dev`
  // run on Turbopack without conflict (the SW is disabled in dev anyway).
  turbopack: {},

  /**
   * PERF (Phase 1) — drop Sentry's browser tracing from the CLIENT bundle only.
   *
   * The problem, measured on production 2026-08-22: chunk 5273 is 485,761 bytes
   * raw / 149,192 gzipped and contains nothing but the Sentry browser SDK. Total
   * script transfer on /login is 325,736 bytes, so Sentry alone is 46% of the
   * JavaScript on every page — including the login screen, before a student has
   * an account. Browser tracing is the bulk of it and this app does not use the
   * data: Sentry is here for error reporting (LR-05).
   *
   * WHY THIS IS NOT `withSentryConfig({ webpack: { treeshake: { removeTracing }}})`
   * — that option exists in @sentry/nextjs 10.65 and does exactly the right
   * thing, but it is applied UNCONDITIONALLY to every compilation (see
   * setupTreeshakingFromConfig in the SDK's config/webpack.js: the call site is
   * not gated on `isServer`). It would therefore also strip SERVER tracing,
   * which is the only server-side timing signal this app has and which the perf
   * audit explicitly wants kept. Setting the flag ourselves behind `!isServer`
   * gives the bundle win without paying for it in observability.
   *
   * `__SENTRY_TRACING__` is the SDK's own tree-shaking flag: its client entry
   * guards `browserTracingIntegration()` with
   * `typeof __SENTRY_TRACING__ === "undefined" || __SENTRY_TRACING__`, so
   * defining it as `false` makes that branch statically dead and webpack drops
   * the import. `captureRouterTransitionStart` is exported outside the guard,
   * so `onRouterTransitionStart` in instrumentation-client.ts stays valid.
   *
   * This hook composes with the ones next-pwa and Sentry add — Next chains them
   * all — and only matters for `next build --webpack`, which is what this
   * project builds with (see package.json). Under Turbopack the flag would need
   * the SDK's own option instead, and the server caveat above would apply.
   */
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.plugins.push(
        new webpack.DefinePlugin({ __SENTRY_TRACING__: false })
      );
    }
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
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
    // Tree-shake the SDK's debug logging out of the bundle. `disableLogger`
    // used to be set alongside this and was removed in the Phase 2 perf pass:
    // the SDK now emits "DEPRECATION WARNING: disableLogger is deprecated ...
    // Use webpack.treeshake.removeDebugLogging instead" on every build, and the
    // two did the same job.
    webpack: { treeshake: { removeDebugLogging: true } },
    // Upload source maps for the client bundle's dynamic imports too.
    widenClientFileUpload: true,
  })
);
