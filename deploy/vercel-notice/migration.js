/**
 * Migration page behaviour for the OLD origin.
 *
 * Two jobs, both small and both defensive:
 *
 * 1. Tear down anything the old app left in this origin — service workers and
 *    caches. sw.js does the heavy lifting, but a visitor whose old worker is
 *    already broken may never trigger it, so we also unregister directly from
 *    the page. Belt and braces, because a surviving worker means the visitor
 *    keeps seeing a stale app instead of this notice.
 *
 * 2. Recognise when this is being opened as the OLD INSTALLED APP rather than a
 *    browser tab, and say something more useful in that case. Someone tapping a
 *    home-screen icon has a different problem from someone following a link:
 *    their installed app is the thing that has moved, and no amount of
 *    "visit our new site" explains that.
 *
 * External rather than inline so the page's CSP can stay at script-src 'self'
 * without needing 'unsafe-inline'.
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- teardown */

  // Replace/remove the old service worker. Registering sw.js first gives the
  // browser a valid script to update to; sw.js then clears caches and
  // unregisters itself.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(function () {
        // Registration can fail (private mode, unsupported, already gone).
        // Fall through to the direct unregister below regardless.
      })
      .finally(function () {
        navigator.serviceWorker
          .getRegistrations()
          .then(function (regs) {
            regs.forEach(function (r) {
              // Leave our own kill-switch alone; it unregisters itself once it
              // has finished clearing caches.
              if (!r.active || !/\/sw\.js$/.test(r.active.scriptURL || "")) {
                r.unregister();
              }
            });
          })
          .catch(function () {});
      });
  }

  // Clear caches from the page too, in case no worker ever activates.
  if (window.caches && caches.keys) {
    caches
      .keys()
      .then(function (keys) {
        keys.forEach(function (k) {
          caches.delete(k);
        });
      })
      .catch(function () {});
  }

  /* ------------------------------------------------- installed-app detection */

  /**
   * True when this is running as an installed app rather than a browser tab.
   * `display-mode: standalone` covers Android/Chromium and installed desktop
   * PWAs; navigator.standalone is iOS Safari's own flag, which predates the
   * media query and is the only signal there.
   */
  function isStandalone() {
    try {
      if (
        window.matchMedia &&
        (window.matchMedia("(display-mode: standalone)").matches ||
          window.matchMedia("(display-mode: fullscreen)").matches ||
          window.matchMedia("(display-mode: minimal-ui)").matches)
      ) {
        return true;
      }
    } catch (e) {
      /* matchMedia unsupported */
    }
    return navigator.standalone === true;
  }

  if (!isStandalone()) return;

  // Swap the copy for someone who opened the OLD INSTALLED APP.
  //
  // Deliberately honest: the old installation cannot migrate itself, and we do
  // not pretend otherwise or try to trigger an install we have no API for. We
  // say what happened and what to do about it.
  var set = function (id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  document.body.setAttribute("data-standalone", "true");
  set("headline-top", "YOUR FAST SOCIO APP");
  set("headline-accent", "HAS MOVED 🚀");
  set("lead", "You’re using the old Fast Socio app.");
  set(
    "tagline-text",
    "We’ve moved to a new home. Open the new Fast Socio and add it to your home screen for the best experience."
  );

  var cta = document.getElementById("cta");
  if (cta) cta.textContent = "Open New Fast Socio →";
})();
