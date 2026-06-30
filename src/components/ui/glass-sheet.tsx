"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

type GlassSheetProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

/**
 * Slide-up glass sheet (UI Spec §5.7): dismissible bottom sheet with a frosted
 * scrim. Used for the message-request composer and other lightweight overlays.
 */
export function GlassSheet({
  open,
  onClose,
  children,
  className,
}: GlassSheetProps) {
  return (
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
            className={cn(
              "glass-strong fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-[32px] " +
                "p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
              className
            )}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120) onClose();
            }}
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-fg/20" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
