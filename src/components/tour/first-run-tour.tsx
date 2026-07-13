"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { markTourSeen } from "@/app/(student)/home/actions";

/**
 * First-run guided tour. Shown once per ACCOUNT the first time a student lands
 * on Home after finishing onboarding — the page only mounts this component
 * while profiles.tour_seen_at is null, and finishing/skipping stamps it via a
 * server action. A dimmed backdrop with a spotlight cutout walks through the
 * composer, the Activity bell, and each bottom-nav tab; every step is a small
 * card with Back / Next / Skip.
 *
 * Anchors are located by [data-tour="…"] attributes so the tour degrades
 * gracefully: steps whose target isn't in the DOM (feature-flagged tabs,
 * streamed content that hasn't arrived) are silently skipped. A localStorage
 * flag doubles as a device-level backstop in case the stamp write fails.
 */

const STORAGE_KEY = "fs-tour-v1";

type Step = {
  /** [data-tour] value to spotlight; null renders a centered card. */
  target: string | null;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    target: null,
    title: "Welcome to FAST SOCIO 👋",
    body: "Your campus, in one app. Here's a 30-second tour of the essentials — you can skip at any time.",
  },
  {
    target: "composer",
    title: "Share with campus",
    body: "This is your feed. Tap here to post a thought or a photo — everyone on campus sees it.",
  },
  {
    target: "activity",
    title: "Your activity",
    body: "Likes, comments, and new followers land here. A badge appears when something's waiting for you.",
  },
  {
    target: "nav:/discover",
    title: "Discover people",
    body: "Swipe through student profiles to meet new people. Like someone and, if they like you back, you match.",
  },
  {
    target: "nav:/leaderboard",
    title: "Ranks",
    body: "Earn aura points by being active. See where you and your department stand on the weekly leaderboard.",
  },
  {
    target: "nav:/events",
    title: "Campus events",
    body: "Everything happening on campus — talks, socials, competitions. A badge shows when new events are posted.",
  },
  {
    target: "nav:/chat",
    title: "Chat & communities",
    body: "Message your matches and friends 1-on-1, or join community rooms. Message requests from new people show up here too.",
  },
  {
    target: "nav:/profile",
    title: "This is you",
    body: "Your profile, your posts, and Settings (theme, notifications, privacy) all live under the Me tab.",
  },
  {
    target: null,
    title: "You're all set ✨",
    body: "That's the tour. Say hi to campus with your first post!",
  },
];

/** Padding around the spotlighted element, in px. */
const SPOT_PAD = 6;
const CARD_W = 300;
const GAP = 12;

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(step: Step): HTMLElement | null {
  if (!step.target) return null;
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

export function FirstRunTour() {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // Decide once whether to run: never seen on this device, and only after the
  // streamed dock has had a moment to mount so nav targets are measurable.
  useEffect(() => {
    let cancelled = false;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      return; // storage unavailable — never loop the tour
    }
    const timer = setTimeout(() => {
      if (cancelled) return;
      const available = STEPS.filter((s) => !s.target || findTarget(s));
      // Require at least one anchored step; otherwise nothing to point at.
      if (available.some((s) => s.target)) setSteps(available);
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const step = steps?.[index] ?? null;

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* best effort */
    }
    // Per-account stamp — fire-and-forget; on failure the tour just offers
    // itself again next visit (and localStorage covers this device meanwhile).
    void markTourSeen().catch(() => {});
    setSteps(null);
  }, []);

  // Measure (and re-measure on resize/scroll) the current step's target.
  useEffect(() => {
    if (!step) return;
    const measure = () => {
      const el = findTarget(step);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const el = findTarget(step);
    el?.scrollIntoView({ block: "nearest" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // Freeze the page behind the overlay and support Esc-to-skip.
  useEffect(() => {
    if (!steps) return;
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
  }, [steps, dismiss]);

  // Card position: centered when there's no target, otherwise above or below
  // the spotlight (above when the target sits in the lower half — the dock).
  const cardStyle = useMemo<React.CSSProperties>(() => {
    if (!step?.target || !rect) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: `min(${CARD_W}px, calc(100vw - 32px))`,
      };
    }
    const vw = window.innerWidth;
    const width = Math.min(CARD_W, vw - 24);
    const cx = rect.left + rect.width / 2;
    const left = Math.min(Math.max(cx - width / 2, 12), vw - width - 12);
    const below = rect.top + rect.height / 2 < window.innerHeight * 0.55;
    return below
      ? { top: rect.top + rect.height + SPOT_PAD + GAP, left, width }
      : {
          bottom: window.innerHeight - rect.top + SPOT_PAD + GAP,
          left,
          width,
        };
  }, [step, rect]);

  if (!steps || !step) return null;

  const isLast = index === steps.length - 1;
  const spotlight = step.target && rect;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App tour"
      className="fixed inset-0 z-50"
    >
      {/* Backdrop. With a target, the cutout div below paints the dimming via
          a giant box-shadow; without one, dim the whole screen. */}
      {spotlight ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-2xl ring-2 ring-accent/80 transition-all duration-300 ease-out"
          style={{
            top: rect.top - SPOT_PAD,
            left: rect.left - SPOT_PAD,
            width: rect.width + SPOT_PAD * 2,
            height: rect.height + SPOT_PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/72" />
      )}

      {/* Step card */}
      <div
        className="glass-strong absolute rounded-2xl p-4 shadow-2xl"
        style={cardStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-bold text-fg">{step.title}</h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Skip tour"
            className="-mr-1 -mt-1 rounded-full p-1 text-fg-muted hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
          {step.body}
        </p>

        <div className="mt-3 flex items-center justify-between">
          {/* Progress dots */}
          <div className="flex items-center gap-1" aria-hidden>
            {steps.map((_, i) => (
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
          <div className="flex items-center gap-2">
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
              className="gradient-brand rounded-full px-4 py-1.5 text-xs font-bold text-white"
            >
              {isLast ? "Let's go" : index === 0 ? "Start tour" : "Next"}
            </button>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          Step {index + 1} of {steps.length}
        </p>
      </div>
    </div>
  );
}
