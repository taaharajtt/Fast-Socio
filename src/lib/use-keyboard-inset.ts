"use client";

import { useEffect } from "react";

/**
 * Tracks the on-screen keyboard via the visualViewport API and exposes the
 * height it overlaps the layout viewport as a `--kb` CSS variable on <html>.
 *
 * Why: `100dvh` only shrinks when the LAYOUT viewport resizes. On Android
 * Chrome we opt into that with viewport `interactive-widget=resizes-content`,
 * so `--kb` resolves to ~0 there (no double compensation). iOS Safari never
 * resizes the layout viewport for the keyboard — it overlays it — so a
 * `100dvh` chat shell keeps its sticky composer hidden behind the keyboard.
 * There `--kb` carries the overlap, and shells sized with
 * `h-[calc(100dvh-var(--kb,0px))]` shrink exactly like a native app.
 *
 * rAF-coalesced: iOS fires a burst of resize/scroll events while the keyboard
 * animates; we write the variable at most once per frame.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const inset = Math.max(
          0,
          Math.round(window.innerHeight - vv.height - vv.offsetTop)
        );
        // Sub-50px deltas are browser chrome (URL bar) noise, not a keyboard.
        document.documentElement.style.setProperty(
          "--kb",
          `${inset > 50 ? inset : 0}px`
        );
      });
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      cancelAnimationFrame(raf);
      document.documentElement.style.setProperty("--kb", "0px");
    };
  }, []);
}
