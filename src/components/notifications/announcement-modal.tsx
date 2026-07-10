"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Megaphone, X } from "lucide-react";
import { dismissAnnouncements } from "@/app/(student)/activity/actions";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  url: string | null;
};

/**
 * Once per app open. A broadcast is worth interrupting for, but only at a
 * natural boundary — sessionStorage means a client-side navigation later in the
 * same session never pops the modal mid-task.
 */
const SESSION_KEY = "fs.announcements.shown";

/** sessionStorage as an external store. Nothing mutates it behind our back, so
 *  the subscribe callback has no work to do. */
const noopSubscribe = () => () => {};
const readShownFlag = () => sessionStorage.getItem(SESSION_KEY) !== null;
/** On the server, assume "already shown": the modal must never appear in SSR HTML. */
const serverShownFlag = () => true;

/**
 * Admin broadcasts as a centred overlay on first load (UAT-012). They used to
 * land as an ordinary row in Activity, where they read as just another
 * notification and were routinely missed; Activity now filters them out
 * entirely and this is their only surface.
 */
export function AnnouncementModal({
  announcements,
}: {
  announcements: Announcement[];
}) {
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);

  const alreadyShown = useSyncExternalStore(
    noopSubscribe,
    readShownFlag,
    serverShownFlag
  );
  const open = !alreadyShown && !dismissed && announcements.length > 0;

  // Claim the session as soon as we commit to showing. Writing to an external
  // system is exactly what an effect is for; nothing re-reads the flag, so this
  // does not feed back into render.
  useEffect(() => {
    if (open) sessionStorage.setItem(SESSION_KEY, "1");
  }, [open]);

  // Escape closes, matching GlassSheet's behaviour.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setDismissed(true);
      void dismissAnnouncements(announcements.map((a) => a.id));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, announcements]);

  function close() {
    setDismissed(true);
    // Fire-and-forget: a failed dismiss just means it shows again next open,
    // which is the safe direction to fail in.
    void dismissAnnouncements(announcements.map((a) => a.id));
  }

  function next() {
    if (index < announcements.length - 1) setIndex((i) => i + 1);
    else close();
  }

  if (announcements.length === 0 || alreadyShown) return null;

  const current = announcements[index];
  const isLast = index === announcements.length - 1;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
          />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="announcement-title"
              className="glass-strong pointer-events-auto w-full max-w-[340px] overflow-hidden rounded-[20px]"
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
            >
              <div className="gradient-brand relative flex flex-col items-center px-6 py-6 text-white">
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={close}
                  className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/25"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20">
                  <Megaphone className="h-6 w-6" aria-hidden />
                </span>
                <h2
                  id="announcement-title"
                  className="mt-3 text-center text-[17px] font-bold leading-snug"
                >
                  {current.title}
                </h2>
              </div>

              <div className="px-6 py-5">
                <p className="whitespace-pre-line text-center text-[15px] leading-relaxed text-fg">
                  {current.body}
                </p>

                {announcements.length > 1 && (
                  <p className="mt-3 text-center text-xs text-fg-disabled">
                    {index + 1} of {announcements.length}
                  </p>
                )}

                <div className="mt-5 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={next}
                    className="gradient-brand w-full rounded-full py-3 text-sm font-semibold text-white active:scale-[0.98]"
                  >
                    {isLast ? "Got it" : "Next"}
                  </button>
                  {current.url && current.url !== "/activity" && (
                    <Link
                      href={current.url}
                      onClick={close}
                      className="w-full rounded-full bg-card py-3 text-center text-sm font-medium text-fg-muted"
                    >
                      Take a look
                    </Link>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
