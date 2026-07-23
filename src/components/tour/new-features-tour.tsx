"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { X, MapPinned, HandHeart, Compass, Users2, Newspaper } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Release "what's new" tour for the addons rollout (Campus Map, Help in Me,
 * smarter Discover, Society/Event OS, Daily Brief). It runs ONCE PER DEVICE via
 * a localStorage flag — existing accounts already have their first-run stamp set
 * (profiles.tour_seen_at), so a server stamp wouldn't re-trigger, and this needs
 * no migration. Home mounts it only for accounts that HAVE finished first-run,
 * so a brand-new user gets the full FirstRunTour instead of two overlapping
 * modals. Centered cards with a per-feature CTA, Back/Next, and Skip/Done; Esc
 * or the ✕ dismisses. It never blocks the app — dismissing returns you to Home.
 */

const STORAGE_KEY = "fs-tour-v2-addons";

type Step = {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Where the CTA takes you; null = a plain dismiss button ("Got it"). */
  href: string | null;
  cta: string;
};

const STEPS: Step[] = [
  {
    icon: MapPinned,
    title: "Campus Map",
    body: "Find blocks, gates, the cafe, masjid, sports spots, and parking on a searchable campus map — now in the Home header.",
    href: "/map",
    cta: "Open the map",
  },
  {
    icon: HandHeart,
    title: "Campus Help",
    body: "Discover Campus Help from Home, or open the full page. SOCIO is the campus-wide help feed; ME is where you ask, manage helpers, and keep your history.",
    href: "/help",
    cta: "Open Campus Help",
  },
  {
    icon: Compass,
    title: "Smarter Discover",
    body: "SOCIO is still the main Discover experience. New modes match you for projects, FYPs, hackathons, sports, and recruitment.",
    href: "/discover",
    cta: "Open Discover",
  },
  {
    icon: Users2,
    title: "Society & Event OS",
    body: "Societies get public pages that run events, recruitment, announcements, and check-ins — all in one place.",
    href: "/societies",
    cta: "Browse societies",
  },
  {
    icon: Newspaper,
    title: "Daily Campus Brief",
    body: "Home now pulls together today's events, society updates, matches, and help so you catch up at a glance.",
    href: null,
    cta: "Got it",
  },
];

export function NewFeaturesTour() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  // Decide once, on the client, whether this device has seen the release tour.
  // The reveal is deferred a beat (so it doesn't flash during hydration) and the
  // setState lives in the timeout callback, not the effect body.
  useEffect(() => {
    let seen = true;
    try {
      seen = Boolean(localStorage.getItem(STORAGE_KEY));
    } catch {
      return; // storage unavailable — never loop the tour
    }
    if (seen) return;
    const timer = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* best effort */
    }
    setOpen(false);
  }, []);

  // Freeze the page behind the overlay and support Esc-to-skip.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, dismiss]);

  if (!open) return null;

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const Icon = step.icon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="What's new"
      className="fixed inset-0 z-50"
    >
      <button
        type="button"
        aria-label="Skip"
        onClick={dismiss}
        className="absolute inset-0 h-full w-full cursor-default bg-black/72"
      />

      <div
        className="glass-strong absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5 shadow-2xl"
        style={{ width: "min(340px, calc(100vw - 32px))" }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
            New
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Skip tour"
            className="-mr-1 -mt-1 rounded-full p-1 text-fg-muted hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <span className="mt-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <Icon className="h-6 w-6" aria-hidden />
        </span>

        <h2 className="mt-3 text-base font-bold text-fg">{step.title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
          {step.body}
        </p>

        {/* Per-feature CTA: navigating also marks the tour seen. */}
        {step.href ? (
          <Link
            href={step.href}
            onClick={dismiss}
            className="gradient-brand mt-4 flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
          >
            {step.cta}
          </Link>
        ) : (
          <button
            type="button"
            onClick={dismiss}
            className="gradient-brand mt-4 flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
          >
            {step.cta}
          </button>
        )}

        <div className="mt-3 flex items-center justify-between">
          {/* Progress dots */}
          <div className="flex items-center gap-1" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={
                  i === index
                    ? "h-1.5 w-4 rounded-full bg-accent transition-all"
                    : "h-1.5 w-1.5 rounded-full bg-fg-muted/40 transition-all"
                }
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-fg-muted hover:text-fg"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? dismiss() : setIndex((i) => i + 1))}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-fg-muted hover:text-fg"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          Step {index + 1} of {STEPS.length}
        </p>
      </div>
    </div>
  );
}
