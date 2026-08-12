/**
 * Self-destructing service worker for the OLD origin.
 *
 * WHY THIS FILE IS THE MOST IMPORTANT PART OF THE MIGRATION
 *
 * Anyone who installed Fast Socio from this origin still has a service worker
 * registered here with scope "/". That worker serves the old app shell from its
 * own cache, so it answers navigations WITHOUT asking the network — meaning the
 * migration page would never be seen and the stale app would keep running.
 *
 * A service worker only goes away if the browser can fetch a NEW script at the
 * same URL. If /sw.js returns HTML (as it did once this became a static site),
 * the update fails on MIME type and the old worker survives indefinitely.
 *
 * So this file must exist, must be served as JavaScript, and must be
 * uncacheable. It replaces the old worker, drops every cache it left behind,
 * unregisters itself, and reloads open windows so they land on the migration
 * page. After that the origin has no service worker at all — which is exactly
 * what we want, because this origin is now three static files.
 */

// Take over immediately instead of waiting for existing tabs to close: the
// whole point is to displace the old worker now, not on some later visit.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop everything the old app cached — app shell, pages, images, API
      // responses. Leaving any of it would let stale content resurface.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        // Cache API unavailable or already cleared — unregistering still matters.
      }

      // Claim clients first so the reload below is actually under our control
      // rather than the outgoing worker's.
      try {
        await self.clients.claim();
      } catch {
        /* not fatal */
      }

      // Remove ourselves. From here the origin is served straight from network.
      try {
        await self.registration.unregister();
      } catch {
        /* not fatal */
      }

      // Reload any open windows (including the installed app) so they re-fetch
      // from the network and see the migration page instead of cached HTML.
      try {
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of clients) {
          if ("navigate" in client) client.navigate(client.url);
        }
      } catch {
        /* not fatal */
      }
    })()
  );
});

// Never serve from cache. Everything goes to the network so the static page
// always wins, even in the brief window before unregistration completes.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
