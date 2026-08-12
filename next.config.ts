import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  // Disable the service worker in dev so HMR / fast refresh stay clean.
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    // Add our Web Push handlers to the generated service worker.
    importScripts: ["/push-sw.js"],
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
    // Strip Sentry's internal logger calls from the browser bundle.
    disableLogger: true,
    // Tree-shake the SDK's debug logging out of the client bundle.
    webpack: { treeshake: { removeDebugLogging: true } },
    // Upload source maps for the client bundle's dynamic imports too.
    widenClientFileUpload: true,
  })
);
