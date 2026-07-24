"use client";

import { Plus } from "lucide-react";
import { GlassSheet } from "@/components/ui";
import { MODE_META, POST_MODES, type PostMode } from "@/lib/smart-match/modes";

/**
 * "Post Intent" — the single entry point for putting anything on the feed.
 * Rather than one giant form, it first asks WHAT you're posting; the chosen
 * kind then opens its own short, type-specific form. SOCIO is offered here too
 * but routes to the existing swipe/profile experience instead of creating a
 * duplicate intent record.
 */
export function PostIntentButton({
  open,
  onOpen,
  onClose,
  onPick,
  onPickSocio,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick: (kind: PostMode) => void;
  onPickSocio: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-95"
      >
        <Plus className="h-4 w-4" aria-hidden /> Post Intent
      </button>

      <GlassSheet open={open} onClose={onClose} label="Post Intent">
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">What are you posting?</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              Pick one — you&apos;ll only be asked for what that needs.
            </p>
          </div>

          <div className="space-y-2">
            <IntentRow
              icon={<span aria-hidden>💜</span>}
              label="SOCIO intro"
              tagline="Meet people on campus — swipe and match."
              onClick={onPickSocio}
            />
            {POST_MODES.map((kind) => {
              const meta = MODE_META[kind];
              return (
                <IntentRow
                  key={kind}
                  icon={<meta.icon className="h-4 w-4 text-aura" aria-hidden />}
                  label={meta.label}
                  tagline={meta.tagline}
                  onClick={() => onPick(kind)}
                />
              );
            })}
          </div>
        </div>
      </GlassSheet>
    </>
  );
}

function IntentRow({
  icon,
  label,
  tagline,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tagline: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[14px] bg-card px-3.5 py-3 text-left active:scale-[0.99]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-elevated">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="block truncate text-[11px] text-fg-muted">{tagline}</span>
      </span>
    </button>
  );
}
