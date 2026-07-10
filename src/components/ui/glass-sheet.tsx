"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { cn } from "@/lib/utils";

type GlassSheetProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Accessible name for the dialog (falls back to a generic label). */
  label?: string;
};

/**
 * Slide-up glass sheet (UI Spec §5.7): dismissible bottom sheet with a frosted
 * scrim. Accessible dialog (P6-01): role="dialog" + aria-modal, Escape to close,
 * focus moved in on open, focus trapped within, and focus restored to the
 * previously-focused element on close.
 */
export function GlassSheet({
  open,
  onClose,
  children,
  className,
  label = "Dialog",
}: GlassSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // Drag-to-dismiss (UAT-001): the grab handle always starts a drag, and so does
  // a downward pull anywhere on the sheet — EXCEPT on interactive controls, and
  // except when the finger is inside a scroll area that isn't at the top (there,
  // the gesture scrolls the content instead of dragging the sheet). This is the
  // Instagram bottom-sheet feel; before, only the tiny handle worked, so people
  // resorted to the Back button.
  const dragControls = useDragControls();

  function maybeStartDrag(e: React.PointerEvent) {
    if (e.button !== 0) return;
    let node = e.target as HTMLElement | null;
    while (node && node !== panelRef.current) {
      if (
        node.matches(
          "button, a, input, textarea, select, [role='button'], [data-no-drag]"
        )
      )
        return;
      if (node.scrollHeight > node.clientHeight + 1 && node.scrollTop > 0) return;
      node = node.parentElement;
    }
    dragControls.start(e);
  }
  // Portal target (document.body) is only available after mount on the client.
  // Rendering into body escapes any transformed/filtered ancestor, which would
  // otherwise become the containing block for our position:fixed panel and make
  // the sheet span from the post's edge instead of the app's bottom.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape-to-close + focus trap while open.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the sheet (first focusable, else the panel itself).
    const panel = panelRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
    );
    (focusables && focusables.length ? focusables[0] : panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = panel.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to whatever opened the sheet.
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              "glass-strong fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-[32px] " +
                "p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] focus:outline-none",
              className
            )}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onPointerDown={maybeStartDrag}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            {/* Grab handle — the obvious drag affordance; the whole sheet also
                drags now (maybeStartDrag on the panel). */}
            <div
              className="mx-auto mb-4 flex w-full cursor-grab justify-center py-1 active:cursor-grabbing"
              aria-hidden
            >
              <div className="h-1.5 w-10 rounded-full bg-fg/20" />
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
