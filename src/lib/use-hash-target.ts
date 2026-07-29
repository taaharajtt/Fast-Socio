"use client";

import { useEffect } from "react";

const HIGHLIGHT_MS = 2000;
const RETRY_MS = 300;

/**
 * On mount, scrolls the element referenced by the current URL fragment
 * (e.g. "#comment-<id>") into view and briefly highlights it via the
 * `hash-target` CSS class. Retries once after a short delay in case the
 * target hasn't rendered yet (e.g. comments still streaming in). No-op
 * during SSR.
 */
export function useHashTarget() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let removeTimer: ReturnType<typeof setTimeout> | undefined;

    function highlight(el: HTMLElement) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("hash-target");
      removeTimer = setTimeout(() => {
        el.classList.remove("hash-target");
      }, HIGHLIGHT_MS);
    }

    function tryScroll() {
      const hash = window.location.hash;
      if (!hash) return;
      const id = hash.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (el) {
        highlight(el);
      } else {
        retryTimer = setTimeout(() => {
          const retried = document.getElementById(id);
          if (retried) highlight(retried);
        }, RETRY_MS);
      }
    }

    tryScroll();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (removeTimer) clearTimeout(removeTimer);
    };
  }, []);
}
