// Custom service-worker code imported into the generated PWA service worker
// (via workboxOptions.importScripts). Handles Web Push display + click-through.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "FAST SOCIO", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "FAST SOCIO";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "/" },
  };

  // Tell any OPEN app window that something arrived, as well as painting the OS
  // notification. Without this the two disagree: the tray says "new message"
  // while the in-app inbox and badge still show whatever they last rendered.
  // It matters most on iOS, where a backgrounded PWA's realtime socket is
  // killed and this push is the only signal that survives.
  //
  // The message carries NOTHING but its type — no sender, no body, no ids, not
  // even the notification tag. The client re-reads through its own RLS-scoped
  // queries; anything we forwarded here would be private data crossing into a
  // context (an open tab that may not even be the intended recipient's) that
  // has not been re-authorised.
  const notifyClients = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: "PUSH_RECEIVED" });
      }
    })
    .catch(() => {});

  event.waitUntil(
    Promise.all([self.registration.showNotification(title, options), notifyClients])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
